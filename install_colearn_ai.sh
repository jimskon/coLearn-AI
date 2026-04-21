#!/usr/bin/env bash
set -Eeuo pipefail

# coLearn-AI full installer for Ubuntu 24.04+
#
# Intent:
# - bring a new or existing Ubuntu system to a working coLearn-AI deployment
# - be safe to rerun
# - create/update the coLearn-AI root application user
# - use or install MariaDB and nginx as needed
# - support existing MariaDB installs by prompting for root credentials when needed
# - build the cxx-runner from git instead of relying on a downloaded copy
# - optionally request TLS with certbot when DNS is ready
#
# Notes:
# - This script assumes the app repo contains server/, client/, and a schema.sql.
# - It writes server/.env if missing and updates key values if it already exists.
# - It does NOT force-drop an existing database.
# - It keeps MariaDB bound to localhost.

LOG_PREFIX="[colearn-installer]"
SCRIPT_NAME="$(basename "$0")"

DOMAIN="${DOMAIN:-}"
WWW_DOMAIN="${WWW_DOMAIN:-}"
APP_USER="${APP_USER:-colearn}"
APP_DIR="${APP_DIR:-/opt/coLearn-AI}"
REPO_URL="${REPO_URL:-}"
REPO_BRANCH="${REPO_BRANCH:-main}"
SERVER_ENTRY="${SERVER_ENTRY:-server/index.js}"
PORT="${PORT:-4000}"

ENV_FILE="${ENV_FILE:-${APP_DIR}/server/.env}"
SCHEMA_FILE="${SCHEMA_FILE:-}"

NODE_MAJOR="${NODE_MAJOR:-20}"
CLIENT_ORIGIN="${CLIENT_ORIGIN:-}"
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_EMAIL:-pogil-sheets-reader@colearn-ai.iam.gserviceaccount.com}"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-colearn_db}"
DB_USER="${DB_USER:-colearn_user}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 24 | tr -d '\n')}"

APP_ROOT_NAME="${APP_ROOT_NAME:-}"
APP_ROOT_EMAIL="${APP_ROOT_EMAIL:-}"
APP_ROOT_PASSWORD="${APP_ROOT_PASSWORD:-}"
BOOTSTRAP_APP_ROOT="${BOOTSTRAP_APP_ROOT:-1}"

SET_DB_ROOT_PASSWORD="${SET_DB_ROOT_PASSWORD:-ask}"   # ask | 1 | 0
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-}"
DB_ROOT_AUTH_MODE="socket"                             # socket | password
MYSQL_AUTH_FILE=""

ENABLE_CERTBOT="${ENABLE_CERTBOT:-ask}"               # ask | 1 | 0
ADMIN_EMAIL="${ADMIN_EMAIL:-}"

ENABLE_CXX_RUNNER="${ENABLE_CXX_RUNNER:-ask}"         # ask | 1 | 0
CXX_RUNNER_REPO_URL="${CXX_RUNNER_REPO_URL:-}"
CXX_RUNNER_DIR="${CXX_RUNNER_DIR:-/opt/cxx-runner}"
CXX_RUNNER_BRANCH="${CXX_RUNNER_BRANCH:-main}"
CXX_RUNNER_PORT="${CXX_RUNNER_PORT:-5055}"

NONINTERACTIVE="${NONINTERACTIVE:-0}"

SITE_NAME="${SITE_NAME:-colearn-ai}"
SITE_CONF=""
SITE_LINK=""
CERT_FULLCHAIN=""
CERT_PRIVKEY=""

MARIADB_INSTALLED_BEFORE=0
MARIADB_ROOT_SOCKET_OK=0
MARIADB_ROOT_PASSWORD_OK=0

info() {
  echo "${LOG_PREFIX} $*"
}

warn() {
  echo "${LOG_PREFIX} WARNING: $*" >&2
}

die() {
  echo "${LOG_PREFIX} ERROR: $*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$MYSQL_AUTH_FILE" && -f "$MYSQL_AUTH_FILE" ]]; then
    rm -f "$MYSQL_AUTH_FILE"
  fi
}
trap cleanup EXIT
trap 'echo "${LOG_PREFIX} ERROR: command failed at line ${LINENO}" >&2' ERR

require_root() {
  [[ "$EUID" -eq 0 ]] || die "Please run with sudo or as root."
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

package_installed() {
  dpkg -s "$1" >/dev/null 2>&1
}

prompt_default() {
  local var_name="$1"
  local prompt_text="$2"
  local default_value="$3"
  local current_value="${!var_name:-$default_value}"

  if [[ "$NONINTERACTIVE" == "1" ]]; then
    printf -v "$var_name" '%s' "$current_value"
    return
  fi

  local response
  read -r -p "${prompt_text} [${current_value}]: " response
  if [[ -n "$response" ]]; then
    printf -v "$var_name" '%s' "$response"
  else
    printf -v "$var_name" '%s' "$current_value"
  fi
}

prompt_secret_keep() {
  local var_name="$1"
  local prompt_text="$2"
  local existing_value="${!var_name:-}"

  if [[ "$NONINTERACTIVE" == "1" ]]; then
    return
  fi

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

prompt_yes_no() {
  local prompt_text="$1"
  local default_answer="$2"
  local reply

  if [[ "$NONINTERACTIVE" == "1" ]]; then
    [[ "$default_answer" == "y" ]]
    return
  fi

  local suffix="[y/N]"
  [[ "$default_answer" == "y" ]] && suffix="[Y/n]"
  read -r -p "${prompt_text} ${suffix}: " reply
  reply="${reply:-$default_answer}"
  [[ "$reply" =~ ^[Yy]$ ]]
}

sql_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\'\'}"
  printf '%s' "$value"
}

write_env_value() {
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

mysql_try_socket_root() {
  mariadb -u root -e 'SELECT 1' >/dev/null 2>&1
}

mysql_try_password_root() {
  [[ -n "$MYSQL_AUTH_FILE" && -f "$MYSQL_AUTH_FILE" ]] || return 1
  mariadb --defaults-extra-file="$MYSQL_AUTH_FILE" -e 'SELECT 1' >/dev/null 2>&1
}

mysql_exec_root() {
  local sql="$1"
  if [[ "$MARIADB_ROOT_SOCKET_OK" == "1" ]]; then
    mariadb -u root -e "$sql"
  elif [[ "$MARIADB_ROOT_PASSWORD_OK" == "1" ]]; then
    mariadb --defaults-extra-file="$MYSQL_AUTH_FILE" -e "$sql"
  else
    die "MariaDB root authentication has not been established."
  fi
}

mysql_query_root() {
  local sql="$1"
  if [[ "$MARIADB_ROOT_SOCKET_OK" == "1" ]]; then
    mariadb -N -B -u root -e "$sql"
  elif [[ "$MARIADB_ROOT_PASSWORD_OK" == "1" ]]; then
    mariadb --defaults-extra-file="$MYSQL_AUTH_FILE" -N -B -e "$sql"
  else
    die "MariaDB root authentication has not been established."
  fi
}

ensure_apt_packages() {
  info "Updating apt package lists"
  apt-get update -y

  info "Installing required system packages"
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl gnupg git build-essential ufw jq openssl \
    nginx mariadb-server mariadb-client
}

ensure_user() {
  if id -u "$APP_USER" >/dev/null 2>&1; then
    info "Application user ${APP_USER} already exists"
  else
    info "Creating application user ${APP_USER}"
    adduser --disabled-password --gecos "" "$APP_USER"
    usermod -aG sudo "$APP_USER"
  fi
}

ensure_node() {
  local need_install=0
  if ! command_exists node; then
    need_install=1
  else
    local current_major
    current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [[ "$current_major" -lt "$NODE_MAJOR" ]]; then
      need_install=1
    fi
  fi

  if [[ "$need_install" -eq 1 ]]; then
    info "Installing Node.js ${NODE_MAJOR}.x"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  else
    info "Node.js already installed: $(node -v)"
  fi

  info "Installing PM2"
  npm install -g pm2
}

ensure_nginx() {
  info "Ensuring nginx is installed and running"
  systemctl enable nginx
  systemctl start nginx
}

ensure_mariadb() {
  if package_installed mariadb-server; then
    MARIADB_INSTALLED_BEFORE=1
  fi

  info "Ensuring MariaDB is installed and running"
  systemctl enable mariadb
  systemctl start mariadb

  if [[ -f /etc/mysql/mariadb.conf.d/50-server.cnf ]]; then
    sed -i 's/^\s*bind-address\s*=.*/bind-address = 127.0.0.1/' /etc/mysql/mariadb.conf.d/50-server.cnf || true
    systemctl restart mariadb
  fi

  if mysql_try_socket_root; then
    MARIADB_ROOT_SOCKET_OK=1
    DB_ROOT_AUTH_MODE="socket"
    info "MariaDB root access via unix_socket is available"
    return
  fi

  if [[ "$NONINTERACTIVE" == "1" ]]; then
    [[ -n "$DB_ROOT_PASSWORD" ]] || die "DB_ROOT_PASSWORD must be provided when root socket auth is unavailable in noninteractive mode."
  fi

  while true; do
    if [[ -z "$DB_ROOT_PASSWORD" ]]; then
      read -r -s -p "Existing MariaDB root password: " DB_ROOT_PASSWORD
      echo
    fi
    [[ -n "$DB_ROOT_PASSWORD" ]] || { warn "Password cannot be blank"; continue; }

    MYSQL_AUTH_FILE="$(mktemp)"
    chmod 600 "$MYSQL_AUTH_FILE"
    cat > "$MYSQL_AUTH_FILE" <<AUTH
[client]
user=root
password=${DB_ROOT_PASSWORD}
AUTH

    if mysql_try_password_root; then
      MARIADB_ROOT_PASSWORD_OK=1
      DB_ROOT_AUTH_MODE="password"
      info "MariaDB root password accepted"
      return
    fi

    rm -f "$MYSQL_AUTH_FILE"
    MYSQL_AUTH_FILE=""
    DB_ROOT_PASSWORD=""
    warn "MariaDB root authentication failed. Try again."
  done
}

maybe_set_mariadb_root_password() {
  local should_set=0

  case "$SET_DB_ROOT_PASSWORD" in
    1) should_set=1 ;;
    0) should_set=0 ;;
    ask)
      if [[ -n "$DB_ROOT_PASSWORD" && "$DB_ROOT_AUTH_MODE" == "password" ]]; then
        should_set=0
      elif prompt_yes_no "Do you want to set or reset an actual MariaDB root password for root@localhost?" "y"; then
        should_set=1
      fi
      ;;
    *) die "SET_DB_ROOT_PASSWORD must be ask, 1, or 0" ;;
  esac

  [[ "$should_set" -eq 1 ]] || return 0
  
  if [[ -z "$DB_ROOT_PASSWORD" ]]; then
    if [[ "$NONINTERACTIVE" == "1" ]]; then
      die "DB_ROOT_PASSWORD must be set when SET_DB_ROOT_PASSWORD=1 in noninteractive mode."
    fi
    local confirm=""
    while true; do
      read -r -s -p "New MariaDB root password: " DB_ROOT_PASSWORD
      echo
      read -r -s -p "Confirm MariaDB root password: " confirm
      echo
      [[ -n "$DB_ROOT_PASSWORD" && "$DB_ROOT_PASSWORD" == "$confirm" ]] && break
      warn "Passwords did not match. Try again."
    done
  fi

  local pw_esc
  pw_esc="$(sql_escape "$DB_ROOT_PASSWORD")"

  info "Setting MariaDB root password on root@localhost"
  mysql_exec_root "ALTER USER 'root'@'localhost' IDENTIFIED BY '${pw_esc}'; FLUSH PRIVILEGES;"

  MARIADB_ROOT_SOCKET_OK=0
  MARIADB_ROOT_PASSWORD_OK=0
  rm -f "$MYSQL_AUTH_FILE"
  MYSQL_AUTH_FILE="$(mktemp)"
  chmod 600 "$MYSQL_AUTH_FILE"
  cat > "$MYSQL_AUTH_FILE" <<AUTH
[client]
user=root
password=${DB_ROOT_PASSWORD}
AUTH

  mysql_try_password_root || die "MariaDB root password was set, but password authentication test failed."
  MARIADB_ROOT_PASSWORD_OK=1
  DB_ROOT_AUTH_MODE="password"
}

load_existing_env_if_present() {
  if [[ -f "$ENV_FILE" ]]; then
    info "Loading existing environment from $ENV_FILE"
    set -o allexport
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +o allexport
  fi
}

resolve_paths() {
  if [[ -z "$DOMAIN" ]]; then
    prompt_default DOMAIN "Primary domain" "colearn.example.edu"
  else
    prompt_default DOMAIN "Primary domain" "$DOMAIN"
  fi

  if [[ -z "$WWW_DOMAIN" ]]; then
    WWW_DOMAIN="www.${DOMAIN}"
  fi
  prompt_default WWW_DOMAIN "WWW/alias domain" "$WWW_DOMAIN"
  prompt_default APP_USER "Application user" "$APP_USER"
  prompt_default APP_DIR "Application directory" "$APP_DIR"
  prompt_default REPO_URL "Application git repo URL" "$REPO_URL"
  prompt_default REPO_BRANCH "Application git branch" "$REPO_BRANCH"
  prompt_default PORT "Node/Express port" "$PORT"
  prompt_default DB_NAME "Database name" "$DB_NAME"
  prompt_default DB_USER "Database user" "$DB_USER"
  prompt_secret_keep DB_PASSWORD "Database password"

  SITE_CONF="/etc/nginx/sites-available/${SITE_NAME}.conf"
  SITE_LINK="/etc/nginx/sites-enabled/${SITE_NAME}.conf"
  CERT_FULLCHAIN="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  CERT_PRIVKEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
}

ensure_repo() {
  [[ -n "$REPO_URL" ]] || die "REPO_URL is required."
  mkdir -p "$(dirname "$APP_DIR")"

  if [[ -d "$APP_DIR" ]]; then
    chown -R "$APP_USER:$APP_USER" "$APP_DIR" || true
    sudo -u "$APP_USER" git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
  fi

  if [[ -d "$APP_DIR/.git" ]]; then
    info "Updating existing app repo in $APP_DIR"
    sudo -u "$APP_USER" git -C "$APP_DIR" fetch --all --prune
    sudo -u "$APP_USER" git -C "$APP_DIR" checkout "$REPO_BRANCH"
    sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only origin "$REPO_BRANCH"
  elif [[ -d "$APP_DIR" && -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 2>/dev/null)" ]]; then
    die "APP_DIR exists and is not an empty git repo: $APP_DIR"
  else
    info "Cloning app repo into $APP_DIR"
    rm -rf "$APP_DIR"
    sudo -u "$APP_USER" git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    sudo -u "$APP_USER" git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
  fi

  chown -R "$APP_USER:$APP_USER" "$APP_DIR"

  if [[ -z "$SCHEMA_FILE" ]]; then
    SCHEMA_FILE="$(find "$APP_DIR" -maxdepth 4 -type f -iname 'schema.sql' | head -n1 || true)"
  fi
  [[ -n "$SCHEMA_FILE" && -f "$SCHEMA_FILE" ]] || die "Could not find schema.sql in the repo."
  [[ -f "$APP_DIR/$SERVER_ENTRY" ]] || die "Server entry not found: $APP_DIR/$SERVER_ENTRY"
}

create_or_update_env() {
  CLIENT_ORIGIN="${CLIENT_ORIGIN:-https://${DOMAIN}}"

  info "Writing server environment to $ENV_FILE"
  write_env_value PORT "$PORT" "$ENV_FILE"
  write_env_value NODE_ENV "production" "$ENV_FILE"
  write_env_value DB_HOST "$DB_HOST" "$ENV_FILE"
  write_env_value DB_PORT "$DB_PORT" "$ENV_FILE"
  write_env_value DB_NAME "$DB_NAME" "$ENV_FILE"
  write_env_value DB_USER "$DB_USER" "$ENV_FILE"
  write_env_value DB_PASSWORD "$DB_PASSWORD" "$ENV_FILE"
  write_env_value SESSION_SECRET "$SESSION_SECRET" "$ENV_FILE"
  write_env_value CLIENT_ORIGIN "$CLIENT_ORIGIN" "$ENV_FILE"
  write_env_value SERVICE_ACCOUNT_EMAIL "$SERVICE_ACCOUNT_EMAIL" "$ENV_FILE"

  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  local client_env="$APP_DIR/client/.env"
  info "Writing client environment to $client_env"
  write_env_value VITE_API_BASE_URL "https://${DOMAIN}" "$client_env"
  chown "$APP_USER:$APP_USER" "$client_env"
}

install_app_deps_and_build() {
  [[ -d "$APP_DIR/server" ]] || die "Missing server directory in $APP_DIR"
  [[ -d "$APP_DIR/client" ]] || die "Missing client directory in $APP_DIR"

  if [[ -f "$APP_DIR/server/package-lock.json" ]]; then
    info "Installing server dependencies with npm ci"
    sudo -u "$APP_USER" bash -lc "cd '$APP_DIR/server' && npm ci"
  else
    info "Installing server dependencies with npm install"
    sudo -u "$APP_USER" bash -lc "cd '$APP_DIR/server' && npm install"
  fi

  if [[ -f "$APP_DIR/client/package-lock.json" ]]; then
    info "Installing client dependencies with npm ci"
    sudo -u "$APP_USER" bash -lc "cd '$APP_DIR/client' && npm ci"
  else
    info "Installing client dependencies with npm install"
    sudo -u "$APP_USER" bash -lc "cd '$APP_DIR/client' && npm install"
  fi

  info "Building client"
  sudo -u "$APP_USER" bash -lc "cd '$APP_DIR/client' && npm run build"
}

setup_database() {
  [[ -f "$SCHEMA_FILE" ]] || die "Schema file not found: $SCHEMA_FILE"

  info "Ensuring application database and database user exist"
  local pw_esc
  pw_esc="$(sql_escape "$DB_PASSWORD")"
  mysql_exec_root "
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${pw_esc}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${pw_esc}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;"

  local table_count
  table_count="$(mysql_query_root "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}';")"
  table_count="${table_count:-0}"

  if [[ "$table_count" -eq 0 ]]; then
    info "Database is empty; importing schema from $SCHEMA_FILE"
    mariadb -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$SCHEMA_FILE"
  else
    info "Database already contains ${table_count} tables; schema import skipped"
  fi
}

bootstrap_app_root() {
  [[ "$BOOTSTRAP_APP_ROOT" == "1" ]] || return

  local has_users_table
  has_users_table="$(mysql_query_root "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}' AND table_name='users';")"
  [[ "$has_users_table" == "1" ]] || { warn "users table not found; skipping application root bootstrap"; return; }

  if [[ -z "$APP_ROOT_NAME" ]]; then
    prompt_default APP_ROOT_NAME "coLearn-AI root user's display name" "Administrator"
  fi
  if [[ -z "$APP_ROOT_EMAIL" ]]; then
    prompt_default APP_ROOT_EMAIL "coLearn-AI root user's email" "admin@${DOMAIN}"
  fi

  if [[ -z "$APP_ROOT_PASSWORD" ]]; then
    if [[ "$NONINTERACTIVE" == "1" ]]; then
      die "APP_ROOT_PASSWORD is required in noninteractive mode when BOOTSTRAP_APP_ROOT=1"
    fi
    local confirm=""
    while true; do
      read -r -s -p "coLearn-AI root user's password: " APP_ROOT_PASSWORD
      echo
      read -r -s -p "Confirm coLearn-AI root user's password: " confirm
      echo
      [[ -n "$APP_ROOT_PASSWORD" && "$APP_ROOT_PASSWORD" == "$confirm" ]] && break
      warn "Passwords did not match. Try again."
    done
  fi

  info "Hashing application root password"
  local hashed_password
  hashed_password="$(printf '%s' "$APP_ROOT_PASSWORD" | sudo -u "$APP_USER" bash -lc "cd '$APP_DIR/server' && node -e \"const bcrypt=require('bcryptjs');const fs=require('fs');const pw=fs.readFileSync(0,'utf8');process.stdout.write(bcrypt.hashSync(pw,10));\"")"

  local name_esc email_esc hash_esc
  name_esc="$(sql_escape "$APP_ROOT_NAME")"
  email_esc="$(sql_escape "$APP_ROOT_EMAIL")"
  hash_esc="$(sql_escape "$hashed_password")"

  info "Creating or updating coLearn-AI root user ${APP_ROOT_EMAIL}"
  mariadb -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<SQL
INSERT INTO users (name, email, password_hash, role)
VALUES ('${name_esc}', '${email_esc}', '${hash_esc}', 'root')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  password_hash = VALUES(password_hash),
  role = 'root';
SQL
}

setup_firewall() {
  info "Configuring UFW"
  ufw allow OpenSSH || true
  ufw allow 'Nginx Full' || true
  ufw --force enable || true
}

ensure_docker() {
  if ! command_exists docker; then
    info "Installing Docker"
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 || \
      DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose
  fi
  systemctl enable docker
  systemctl start docker
}

setup_cxx_runner() {
  local enable=0
  case "$ENABLE_CXX_RUNNER" in
    1) enable=1 ;;
    0) enable=0 ;;
    ask)
      if prompt_yes_no "Build and install the cxx-runner from git?" "y"; then
        enable=1
      fi
      ;;
    *) die "ENABLE_CXX_RUNNER must be ask, 1, or 0" ;;
  esac

  [[ "$enable" -eq 1 ]] || { ENABLE_CXX_RUNNER=0; info "Skipping cxx-runner"; return; }
  ENABLE_CXX_RUNNER=1

  prompt_default CXX_RUNNER_REPO_URL "C++ runner git repo URL" "$CXX_RUNNER_REPO_URL"
  prompt_default CXX_RUNNER_DIR "C++ runner directory" "$CXX_RUNNER_DIR"
  prompt_default CXX_RUNNER_BRANCH "C++ runner branch" "$CXX_RUNNER_BRANCH"
  prompt_default CXX_RUNNER_PORT "C++ runner port" "$CXX_RUNNER_PORT"

  [[ -n "$CXX_RUNNER_REPO_URL" ]] || die "CXX_RUNNER_REPO_URL is required when cxx-runner is enabled."

  ensure_docker
  mkdir -p "$(dirname "$CXX_RUNNER_DIR")"

  if [[ -d "$CXX_RUNNER_DIR/.git" ]]; then
    info "Updating cxx-runner repo"
    sudo -u "$APP_USER" git -C "$CXX_RUNNER_DIR" fetch --all --prune
    sudo -u "$APP_USER" git -C "$CXX_RUNNER_DIR" checkout "$CXX_RUNNER_BRANCH"
    sudo -u "$APP_USER" git -C "$CXX_RUNNER_DIR" pull --ff-only origin "$CXX_RUNNER_BRANCH"
  else
    info "Cloning cxx-runner repo"
    rm -rf "$CXX_RUNNER_DIR"
    sudo -u "$APP_USER" git clone --branch "$CXX_RUNNER_BRANCH" "$CXX_RUNNER_REPO_URL" "$CXX_RUNNER_DIR"
  fi

  [[ -f "$CXX_RUNNER_DIR/docker-compose.yml" ]] || die "docker-compose.yml not found in $CXX_RUNNER_DIR"
  chown -R "$APP_USER:$APP_USER" "$CXX_RUNNER_DIR"

  info "Building and starting cxx-runner"
  if docker compose version >/dev/null 2>&1; then
    (cd "$CXX_RUNNER_DIR" && docker compose up -d --build)
  else
    (cd "$CXX_RUNNER_DIR" && docker-compose up -d --build)
  fi

  local started=0
  for _ in {1..30}; do
    if ss -ltn | awk '{print $4}' | grep -q ":${CXX_RUNNER_PORT}$"; then
      started=1
      break
    fi
    sleep 1
  done
  [[ "$started" -eq 1 ]] || die "cxx-runner did not start on port ${CXX_RUNNER_PORT}"
}

write_nginx_http_config() {
  mkdir -p /var/www/html
  cat > "$SITE_CONF" <<EOFHTTP
server {
    listen 80;
    listen [::]:80;
    server_name ${WWW_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 http://${DOMAIN}\$request_uri;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    root ${APP_DIR}/client/dist;
    index index.html;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location ^~ /socket.io/ {
        proxy_pass http://127.0.0.1:${PORT}/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 600s;
    }
EOFHTTP

  if [[ "$ENABLE_CXX_RUNNER" == "1" ]]; then
    cat >> "$SITE_CONF" <<EOFCXX

    location /cxx-run/ {
        proxy_pass http://127.0.0.1:${CXX_RUNNER_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
    }
EOFCXX
  fi

  cat >> "$SITE_CONF" <<EOFFOOT

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    client_max_body_size 25m;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;
}
EOFFOOT
}

write_nginx_https_config() {
  cat > "$SITE_CONF" <<EOFHTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ${WWW_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://${DOMAIN}\$request_uri;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://${DOMAIN}\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${WWW_DOMAIN};

    ssl_certificate ${CERT_FULLCHAIN};
    ssl_certificate_key ${CERT_PRIVKEY};
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    return 301 https://${DOMAIN}\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate ${CERT_FULLCHAIN};
    ssl_certificate_key ${CERT_PRIVKEY};
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root ${APP_DIR}/client/dist;
    index index.html;

    location ^~ /socket.io/ {
        proxy_pass http://127.0.0.1:${PORT}/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 600s;
    }
EOFHTTPS

  if [[ "$ENABLE_CXX_RUNNER" == "1" ]]; then
    cat >> "$SITE_CONF" <<EOFCXX2

    location /cxx-run/ {
        proxy_pass http://127.0.0.1:${CXX_RUNNER_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
    }
EOFCXX2
  fi

  cat >> "$SITE_CONF" <<EOFFOOT2

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    client_max_body_size 25m;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;
}
EOFFOOT2
}

install_or_refresh_nginx_config() {
  mkdir -p /var/www/html
  if [[ -f "$CERT_FULLCHAIN" && -f "$CERT_PRIVKEY" ]]; then
    info "Writing HTTPS nginx config"
    write_nginx_https_config
  else
    info "Writing HTTP nginx config"
    write_nginx_http_config
  fi

  rm -f /etc/nginx/sites-enabled/default
  ln -sf "$SITE_CONF" "$SITE_LINK"
  nginx -t
  systemctl reload nginx
}

maybe_install_cert() {
  local should_request=0

  if [[ -f "$CERT_FULLCHAIN" && -f "$CERT_PRIVKEY" ]]; then
    info "TLS certificate already present for ${DOMAIN}"
    install_or_refresh_nginx_config
    return
  fi

  case "$ENABLE_CERTBOT" in
    1) should_request=1 ;;
    0) should_request=0 ;;
    ask)
      if prompt_yes_no "No TLS certificate found for ${DOMAIN}. Request one now with Certbot?" "y"; then
        should_request=1
      fi
      ;;
    *) die "ENABLE_CERTBOT must be ask, 1, or 0" ;;
  esac

  if [[ "$should_request" -eq 0 ]]; then
    warn "Leaving nginx on HTTP only. You can run certbot later once DNS is ready."
    install_or_refresh_nginx_config
    return
  fi

  if [[ -z "$ADMIN_EMAIL" ]]; then
    prompt_default ADMIN_EMAIL "Certbot contact email" "admin@${DOMAIN}"
  fi

  info "Installing Certbot"
  DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx

  install_or_refresh_nginx_config

  info "Requesting TLS certificate"
  certbot --nginx --non-interactive --agree-tos --redirect \
    -m "$ADMIN_EMAIL" \
    -d "$DOMAIN" -d "$WWW_DOMAIN"

  [[ -f "$CERT_FULLCHAIN" && -f "$CERT_PRIVKEY" ]] || die "Certbot did not create the expected certificate files."
  install_or_refresh_nginx_config
}

start_app_pm2() {
  info "Starting app with PM2"
  sudo -u "$APP_USER" bash -lc "pm2 delete colearn-ai >/dev/null 2>&1 || true"
  sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && pm2 start '$SERVER_ENTRY' --name colearn-ai"
  sudo -u "$APP_USER" bash -lc "pm2 save"

  local startup_line
  startup_line="$(sudo -u "$APP_USER" bash -lc "pm2 startup systemd -u '$APP_USER' --hp '/home/$APP_USER'" | tail -n 1 || true)"
  if [[ -n "$startup_line" && "$startup_line" == sudo* ]]; then
    eval "$startup_line" || true
    sudo -u "$APP_USER" bash -lc "pm2 save"
  fi
}

print_summary() {
  echo
  echo "===================================================="
  echo "coLearn-AI install complete"
  echo "Domain:                    ${DOMAIN}"
  echo "WWW domain:                ${WWW_DOMAIN}"
  if [[ -f "$CERT_FULLCHAIN" ]]; then
    echo "Public URL:                https://${DOMAIN}"
  else
    echo "Public URL:                http://${DOMAIN}"
  fi
  echo "Application user:          ${APP_USER}"
  echo "Application directory:     ${APP_DIR}"
  echo "Server env file:           ${ENV_FILE}"
  echo "Schema file:               ${SCHEMA_FILE}"
  echo "Node port:                 ${PORT}"
  echo "DB host/port:              ${DB_HOST}:${DB_PORT}"
  echo "App DB name/user:          ${DB_NAME} / ${DB_USER}"
  echo "App DB password:           ${DB_PASSWORD}"
  echo "MariaDB root auth mode:    ${DB_ROOT_AUTH_MODE}"
  if [[ "$BOOTSTRAP_APP_ROOT" == "1" ]]; then
    echo "coLearn-AI root email:     ${APP_ROOT_EMAIL}"
  fi
  if [[ "$ENABLE_CXX_RUNNER" == "1" ]]; then
    echo "C++ runner dir/port:       ${CXX_RUNNER_DIR} / ${CXX_RUNNER_PORT}"
  else
    echo "C++ runner:                disabled"
  fi
  echo "nginx site config:         ${SITE_CONF}"
  echo "PM2 process:               colearn-ai"
  echo "===================================================="
}

main() {
  require_root
  resolve_paths
  ensure_apt_packages
  ensure_user
  ensure_node
  ensure_nginx
  ensure_mariadb
  maybe_set_mariadb_root_password
  load_existing_env_if_present
  ensure_repo
  create_or_update_env
  install_app_deps_and_build
  setup_database
  bootstrap_app_root
  setup_firewall
  setup_cxx_runner
  install_or_refresh_nginx_config
  maybe_install_cert
  start_app_pm2
  print_summary
}

main "$@"

