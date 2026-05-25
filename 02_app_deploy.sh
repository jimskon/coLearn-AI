#!/usr/bin/env bash
set -Eeuo pipefail

LOG_PREFIX="[colearn-deploy]"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${1:-${SCRIPT_DIR}/deploy.conf}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"

REPO_URL="${REPO_URL:-}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_USER="${APP_USER:-${USER}}"
APP_DIR="${APP_DIR:-/opt/coLearn-AI}"
PORT="${PORT:-4000}"
DOMAIN="${DOMAIN:-}"
WWW_DOMAIN="${WWW_DOMAIN:-}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-colearn_db}"
DB_USER="${DB_USER:-colearn_user}"
DB_PASSWORD="${DB_PASSWORD:-}"
CLIENT_ORIGIN="${CLIENT_ORIGIN:-}"
SESSION_SECRET="${SESSION_SECRET:-}"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_EMAIL:-pogil-sheets-reader@colearn-ai.iam.gserviceaccount.com}"
APP_ROOT_NAME="${APP_ROOT_NAME:-Administrator}"
APP_ROOT_EMAIL="${APP_ROOT_EMAIL:-}"
APP_ROOT_PASSWORD="${APP_ROOT_PASSWORD:-}"
BOOTSTRAP_APP_ROOT="${BOOTSTRAP_APP_ROOT:-1}"
SERVER_ENTRY="${SERVER_ENTRY:-server/index.js}"
ENABLE_CXX_RUNNER="${ENABLE_CXX_RUNNER:-0}"
CXX_RUNNER_REPO_URL="${CXX_RUNNER_REPO_URL:-}"
CXX_RUNNER_DIR="${CXX_RUNNER_DIR:-/opt/cxx-runner}"
CXX_RUNNER_BRANCH="${CXX_RUNNER_BRANCH:-main}"
CXX_RUNNER_PORT="${CXX_RUNNER_PORT:-5055}"
ENV_FILE="${ENV_FILE:-}"
SCHEMA_FILE="${SCHEMA_FILE:-}"

info() { echo "${LOG_PREFIX} $*"; }
warn() { echo "${LOG_PREFIX} WARNING: $*" >&2; }
die() { echo "${LOG_PREFIX} ERROR: $*" >&2; exit 1; }
trap 'echo "${LOG_PREFIX} ERROR: command failed at line ${LINENO}" >&2' ERR

prompt_default() {
  local var_name="$1"
  local prompt_text="$2"
  local default_value="$3"
  local current_value="${!var_name:-$default_value}"
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    printf -v "$var_name" '%s' "$current_value"
    return 0
  fi
  local response
  read -r -p "${prompt_text} [${current_value}]: " response
  printf -v "$var_name" '%s' "${response:-$current_value}"
}

prompt_secret_keep() {
  local var_name="$1"
  local prompt_text="$2"
  local existing_value="${!var_name:-}"
  if [[ "$NONINTERACTIVE" == "1" ]]; then return 0; fi
  local response=""
  if [[ -n "$existing_value" ]]; then
    read -r -s -p "${prompt_text} [leave blank to keep current]: " response
  else
    read -r -s -p "${prompt_text}: " response
  fi
  echo
  if [[ -n "$response" ]]; then
    printf -v "$var_name" '%s' "$response"
  fi
}

sql_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\'\'}"
  printf '%s' "$value"
}

write_key_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

load_config() {
  [[ -f "$CONFIG_FILE" ]] || die "Config file not found: $CONFIG_FILE"
  info "Loading deploy configuration from $CONFIG_FILE"
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
}

validate_user_context() {
  [[ "$USER" == "$APP_USER" ]] || die "Run this script as ${APP_USER}. Current user is ${USER}."
  [[ -n "$APP_USER" && "$APP_USER" != "root" ]] || die "APP_USER cannot be blank or root."
}

resolve_settings() {
  prompt_default REPO_URL "Application git repo URL" "$REPO_URL"
  prompt_default REPO_BRANCH "Application git branch" "$REPO_BRANCH"
  prompt_default APP_DIR "Application directory" "$APP_DIR"
  prompt_default DOMAIN "Primary domain" "$DOMAIN"
  if [[ -z "$WWW_DOMAIN" ]]; then WWW_DOMAIN="www.${DOMAIN}"; fi
  prompt_default WWW_DOMAIN "Alias / www domain" "$WWW_DOMAIN"
  prompt_default PORT "Node/Express port" "$PORT"
  prompt_default DB_HOST "Database host" "$DB_HOST"
  prompt_default DB_PORT "Database port" "$DB_PORT"
  prompt_default DB_NAME "Database name" "$DB_NAME"
  prompt_default DB_USER "Database user" "$DB_USER"
  prompt_secret_keep DB_PASSWORD "Database password"
  if [[ -z "$CLIENT_ORIGIN" ]]; then CLIENT_ORIGIN="https://${DOMAIN}"; fi
  prompt_default CLIENT_ORIGIN "Client origin" "$CLIENT_ORIGIN"
  if [[ -z "$SESSION_SECRET" ]]; then SESSION_SECRET="$(openssl rand -hex 32)"; fi
  prompt_secret_keep SESSION_SECRET "Session secret"
  if [[ -z "$APP_ROOT_EMAIL" ]]; then APP_ROOT_EMAIL="admin@${DOMAIN}"; fi
  prompt_default APP_ROOT_NAME "coLearn-AI root display name" "$APP_ROOT_NAME"
  prompt_default APP_ROOT_EMAIL "coLearn-AI root email" "$APP_ROOT_EMAIL"
  if [[ -z "$ENV_FILE" ]]; then ENV_FILE="${APP_DIR}/server/.env"; fi
}

ensure_repo() {
  [[ -n "$REPO_URL" ]] || die "REPO_URL is required."
  mkdir -p "$(dirname "$APP_DIR")"
  if [[ -d "$APP_DIR/.git" ]]; then
    info "Updating existing app repo in $APP_DIR"
    git -C "$APP_DIR" config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
    git -C "$APP_DIR" remote set-url origin "$REPO_URL" || true
    git -C "$APP_DIR" fetch --all --prune
    git -C "$APP_DIR" checkout "$REPO_BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$REPO_BRANCH"
  elif [[ -d "$APP_DIR" && -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 2>/dev/null)" ]]; then
    die "APP_DIR exists and is not an empty git repo: $APP_DIR"
  else
    info "Cloning app repo into $APP_DIR"
    rm -rf "$APP_DIR"
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
    git -C "$APP_DIR" config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
  fi
  [[ -f "$APP_DIR/$SERVER_ENTRY" ]] || die "Server entry not found: $APP_DIR/$SERVER_ENTRY"
  if [[ -z "$SCHEMA_FILE" ]]; then
    SCHEMA_FILE="$(find "$APP_DIR" -maxdepth 4 -type f -iname 'schema.sql' | head -n1 || true)"
  fi
}

ensure_database_schema_if_empty() {
  [[ -n "$SCHEMA_FILE" && -f "$SCHEMA_FILE" ]] || die "Could not find schema.sql in the repo."
  local table_count
  table_count="$(mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}';" 2>/dev/null || echo 0)"
  table_count="${table_count:-0}"
  if [[ "$table_count" -eq 0 ]]; then
    info "Database is empty; importing schema from $SCHEMA_FILE"
    mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$SCHEMA_FILE"
  else
    info "Database already contains ${table_count} tables; schema import skipped"
  fi
}

run_repo_migrations() {
  local migrations_script="${APP_DIR}/migrations/run-all.sh"
  if [[ -x "$migrations_script" ]]; then
    info "Running repository migrations"
    (cd "$APP_DIR" && bash "$migrations_script")
  elif [[ -f "$migrations_script" ]]; then
    info "Running repository migrations"
    (cd "$APP_DIR" && bash "$migrations_script")
  else
    warn "No migrations/run-all.sh found; skipping migrations"
  fi
}

write_env_files() {
  info "Writing server environment to $ENV_FILE"
  write_key_value PORT "$PORT" "$ENV_FILE"
  write_key_value NODE_ENV "production" "$ENV_FILE"
  write_key_value DB_HOST "$DB_HOST" "$ENV_FILE"
  write_key_value DB_PORT "$DB_PORT" "$ENV_FILE"
  write_key_value DB_NAME "$DB_NAME" "$ENV_FILE"
  write_key_value DB_USER "$DB_USER" "$ENV_FILE"
  write_key_value DB_PASSWORD "$DB_PASSWORD" "$ENV_FILE"
  write_key_value SESSION_SECRET "$SESSION_SECRET" "$ENV_FILE"
  write_key_value CLIENT_ORIGIN "$CLIENT_ORIGIN" "$ENV_FILE"
  write_key_value SERVICE_ACCOUNT_EMAIL "$SERVICE_ACCOUNT_EMAIL" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  local client_env="${APP_DIR}/client/.env"
  info "Writing client environment to $client_env"
  write_key_value VITE_API_BASE_URL "https://${DOMAIN}" "$client_env"
}

install_app_deps_and_build() {
  if [[ -f "$APP_DIR/server/package-lock.json" ]]; then
    info "Installing server dependencies with npm ci"
    (cd "$APP_DIR/server" && npm ci)
  else
    info "Installing server dependencies with npm install"
    (cd "$APP_DIR/server" && npm install)
  fi
  if [[ -f "$APP_DIR/client/package-lock.json" ]]; then
    info "Installing client dependencies with npm ci"
    (cd "$APP_DIR/client" && npm ci)
  else
    info "Installing client dependencies with npm install"
    (cd "$APP_DIR/client" && npm install)
  fi
  info "Building client"
  (cd "$APP_DIR/client" && npm run build)
}

bootstrap_app_root() {
  [[ "$BOOTSTRAP_APP_ROOT" == "1" ]] || return 0
  if [[ -z "$APP_ROOT_PASSWORD" ]]; then
    [[ "$NONINTERACTIVE" == "1" ]] && die "APP_ROOT_PASSWORD is required in noninteractive mode when BOOTSTRAP_APP_ROOT=1"
    local confirm=""
    while true; do
      read -r -s -p "coLearn-AI root user password: " APP_ROOT_PASSWORD; echo
      read -r -s -p "Confirm coLearn-AI root user password: " confirm; echo
      [[ -n "$APP_ROOT_PASSWORD" && "$APP_ROOT_PASSWORD" == "$confirm" ]] && break
      warn "Passwords did not match. Try again."
    done
  fi
  local hashed_password
  hashed_password="$(printf '%s' "$APP_ROOT_PASSWORD" | (cd "$APP_DIR/server" && node -e "const bcrypt=require('bcryptjs');const fs=require('fs');const pw=fs.readFileSync(0,'utf8');process.stdout.write(bcrypt.hashSync(pw,10));"))"
  local name_esc email_esc hash_esc
  name_esc="$(sql_escape "$APP_ROOT_NAME")"
  email_esc="$(sql_escape "$APP_ROOT_EMAIL")"
  hash_esc="$(sql_escape "$hashed_password")"
  local has_users_table
  has_users_table="$(mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}' AND table_name='users';")"
  [[ "$has_users_table" == "1" ]] || die "users table not found in ${DB_NAME}. Make sure schema.sql imported correctly."
  info "Creating or updating coLearn-AI root user in the app database"
  mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<SQL
INSERT INTO users (name, email, password_hash, role)
VALUES ('${name_esc}', '${email_esc}', '${hash_esc}', 'root')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  password_hash = VALUES(password_hash),
  role = 'root';
SQL
}

ensure_docker_access() {
  [[ "$ENABLE_CXX_RUNNER" == "1" ]] || return 0
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Run stage 1 bootstrap as root first."
  groups | grep -qw docker || die "User ${USER} is not in the docker group. Log out and back in, or add the user to docker."
}

setup_cxx_runner() {
  [[ "$ENABLE_CXX_RUNNER" == "1" ]] || return 0
  [[ -n "$CXX_RUNNER_REPO_URL" ]] || die "CXX_RUNNER_REPO_URL is required when ENABLE_CXX_RUNNER=1"
  ensure_docker_access
  mkdir -p "$(dirname "$CXX_RUNNER_DIR")"
  if [[ -d "$CXX_RUNNER_DIR/.git" ]]; then
    info "Updating cxx-runner repo"
    git -C "$CXX_RUNNER_DIR" config --global --add safe.directory "$CXX_RUNNER_DIR" >/dev/null 2>&1 || true
    git -C "$CXX_RUNNER_DIR" remote set-url origin "$CXX_RUNNER_REPO_URL" || true
    git -C "$CXX_RUNNER_DIR" fetch --all --prune
    git -C "$CXX_RUNNER_DIR" checkout "$CXX_RUNNER_BRANCH"
    git -C "$CXX_RUNNER_DIR" pull --ff-only origin "$CXX_RUNNER_BRANCH"
  else
    info "Cloning cxx-runner repo"
    rm -rf "$CXX_RUNNER_DIR"
    git clone --branch "$CXX_RUNNER_BRANCH" "$CXX_RUNNER_REPO_URL" "$CXX_RUNNER_DIR"
  fi
  [[ -f "$CXX_RUNNER_DIR/docker-compose.yml" ]] || die "docker-compose.yml not found in $CXX_RUNNER_DIR"
  info "Building and starting cxx-runner"
  if docker compose version >/dev/null 2>&1; then
    (cd "$CXX_RUNNER_DIR" && docker compose up -d --build)
  else
    (cd "$CXX_RUNNER_DIR" && docker-compose up -d --build)
  fi
}

start_app_pm2() {
  info "Starting app with PM2"
  pm2 delete colearn-ai >/dev/null 2>&1 || true
  (cd "$APP_DIR" && pm2 start "$SERVER_ENTRY" --name colearn-ai)
  pm2 save
  if command -v sudo >/dev/null 2>&1; then
    local startup_line
    startup_line="$(pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 || true)"
    if [[ -n "$startup_line" && "$startup_line" == sudo* ]]; then
      echo
      echo "Run this once as root to enable PM2 autostart for ${USER}:"
      echo "$startup_line"
      echo
    fi
  fi
}

print_summary() {
  echo
  echo "===================================================="
  echo "coLearn-AI stage 2 deploy complete"
  echo "Application user:          ${APP_USER}"
  echo "Application directory:     ${APP_DIR}"
  echo "Repo URL / branch:         ${REPO_URL} / ${REPO_BRANCH}"
  echo "Public URL:                https://${DOMAIN}"
  echo "Server env file:           ${ENV_FILE}"
  echo "Node port:                 ${PORT}"
  echo "App DB name/user:          ${DB_NAME} / ${DB_USER}"
  echo "coLearn-AI root email:     ${APP_ROOT_EMAIL}"
  if [[ "$ENABLE_CXX_RUNNER" == "1" ]]; then
    echo "C++ runner dir/port:       ${CXX_RUNNER_DIR} / ${CXX_RUNNER_PORT}"
  else
    echo "C++ runner:                disabled"
  fi
  echo "PM2 process:               colearn-ai"
  echo "===================================================="
}

main() {
  load_config
  validate_user_context
  resolve_settings
  ensure_repo
  write_env_files
  install_app_deps_and_build
  ensure_database_schema_if_empty
  run_repo_migrations
  bootstrap_app_root
  setup_cxx_runner
  start_app_pm2
  print_summary
}

main "$@"
