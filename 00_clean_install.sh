#!/usr/bin/env bash
set -Eeuo pipefail

LOG_PREFIX="[colearn-clean]"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${1:-${SCRIPT_DIR}/install.conf}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"

DEFAULT_APP_USER="${SUDO_USER:-}"
APP_USER="${APP_USER:-$DEFAULT_APP_USER}"
APP_DIR="${APP_DIR:-/opt/coLearn-AI}"
SITE_NAME="${SITE_NAME:-colearn-ai}"
DOMAIN="${DOMAIN:-}"
WWW_DOMAIN="${WWW_DOMAIN:-}"
DB_NAME="${DB_NAME:-colearn_db}"
DB_USER="${DB_USER:-colearn_user}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-}"
SET_DB_ROOT_PASSWORD="${SET_DB_ROOT_PASSWORD:-ask}"
CXX_RUNNER_DIR="${CXX_RUNNER_DIR:-/opt/cxx-runner}"
PY_RUNNER_DIR="${PY_RUNNER_DIR:-/opt/py-runner}"
REMOVE_DB="${REMOVE_DB:-1}"
REMOVE_DB_USER="${REMOVE_DB_USER:-1}"
REMOVE_CXX_RUNNER="${REMOVE_CXX_RUNNER:-1}"
REMOVE_PY_RUNNER="${REMOVE_PY_RUNNER:-1}"
REMOVE_ENV_FILES="${REMOVE_ENV_FILES:-1}"
REMOVE_NODE_MODULES="${REMOVE_NODE_MODULES:-1}"
REMOVE_BUILD_ARTIFACTS="${REMOVE_BUILD_ARTIFACTS:-1}"
REMOVE_CERTS="${REMOVE_CERTS:-0}"
REMOVE_DEPLOY_CONFIGS="${REMOVE_DEPLOY_CONFIGS:-0}"

PKG_MANAGER=""
OS_FAMILY="unknown"
MYSQL_AUTH_FILE=""
MARIADB_ROOT_SOCKET_OK=0
MARIADB_ROOT_PASSWORD_OK=0
DB_ROOT_AUTH_MODE="socket"
SITE_CONF=""
SITE_LINK=""
CERT_DIR=""

info() { echo "${LOG_PREFIX} $*"; }
warn() { echo "${LOG_PREFIX} WARNING: $*" >&2; }
die() { echo "${LOG_PREFIX} ERROR: $*" >&2; exit 1; }
cleanup() {
  if [[ -n "$MYSQL_AUTH_FILE" && -f "$MYSQL_AUTH_FILE" ]]; then
    rm -f "$MYSQL_AUTH_FILE"
  fi
  return 0
}
trap cleanup EXIT
trap 'echo "${LOG_PREFIX} ERROR: command failed at line ${LINENO}" >&2' ERR

require_root() { [[ "$EUID" -eq 0 ]] || die "Run with sudo or as root."; }
command_exists() { command -v "$1" >/dev/null 2>&1; }

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

prompt_yes_no() {
  local prompt_text="$1"
  local default_answer="$2"
  local reply
  local suffix="[y/N]"
  [[ "$default_answer" == "y" ]] && suffix="[Y/n]"
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    [[ "$default_answer" == "y" ]]
    return
  fi
  read -r -p "${prompt_text} ${suffix}: " reply
  reply="${reply:-$default_answer}"
  [[ "$reply" =~ ^[Yy]$ ]]
}

detect_platform() {
  if command_exists apt-get; then
    PKG_MANAGER="apt"
    OS_FAMILY="debian"
  elif command_exists dnf; then
    PKG_MANAGER="dnf"
    OS_FAMILY="rhel"
  elif command_exists yum; then
    PKG_MANAGER="yum"
    OS_FAMILY="rhel"
  else
    die "Unsupported package manager. Expected apt-get, dnf, or yum."
  fi
}

load_config_if_present() {
  if [[ -f "$CONFIG_FILE" ]]; then
    info "Loading configuration from $CONFIG_FILE"
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
  else
    warn "Config file not found: $CONFIG_FILE. Interactive prompts will be used."
  fi
}

resolve_settings() {
  if [[ -z "$APP_USER" || "$APP_USER" == "root" ]]; then
    prompt_default APP_USER "Application owner user" "${SUDO_USER:-}"
  else
    prompt_default APP_USER "Application owner user" "$APP_USER"
  fi
  prompt_default APP_DIR "Application directory" "$APP_DIR"
  prompt_default SITE_NAME "nginx site config name" "$SITE_NAME"
  prompt_default DB_NAME "Application database name" "$DB_NAME"
  prompt_default DB_USER "Application database user" "$DB_USER"
  prompt_default CXX_RUNNER_DIR "C++ runner directory" "$CXX_RUNNER_DIR"
  prompt_default DOMAIN "Primary domain" "$DOMAIN"
  prompt_default WWW_DOMAIN "Alias / www domain" "$WWW_DOMAIN"

  if [[ "$OS_FAMILY" == "rhel" ]]; then
    SITE_CONF="/etc/nginx/conf.d/${SITE_NAME}.conf"
    SITE_LINK="$SITE_CONF"
  else
    SITE_CONF="/etc/nginx/sites-available/${SITE_NAME}.conf"
    SITE_LINK="/etc/nginx/sites-enabled/${SITE_NAME}.conf"
  fi
  if [[ -n "$DOMAIN" ]]; then
    CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
  fi
}

ensure_mysql_auth_file() {
  MYSQL_AUTH_FILE="$(mktemp)"
  chmod 600 "$MYSQL_AUTH_FILE"
  cat > "$MYSQL_AUTH_FILE" <<EOFMYSQL
[client]
user=root
password=${DB_ROOT_PASSWORD}
EOFMYSQL
}

mysql_try_socket_root() { mariadb -u root -e 'SELECT 1' >/dev/null 2>&1; }
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
    die "MariaDB root access is not available."
  fi
}

prepare_db_root_access() {
  if mysql_try_socket_root; then
    MARIADB_ROOT_SOCKET_OK=1
    DB_ROOT_AUTH_MODE="socket"
    info "MariaDB root socket authentication works"
    return
  fi

  case "$SET_DB_ROOT_PASSWORD" in
    ask)
      if [[ "$NONINTERACTIVE" == "1" ]]; then
        die "Need MariaDB root password for cleanup, but NONINTERACTIVE=1 and socket auth failed."
      fi
      read -r -s -p "MariaDB root password (leave blank to skip DB cleanup): " DB_ROOT_PASSWORD
      echo
      ;;
    1)
      [[ -n "$DB_ROOT_PASSWORD" ]] || die "SET_DB_ROOT_PASSWORD=1 requires DB_ROOT_PASSWORD"
      ;;
    0)
      warn "MariaDB root password is disabled by config; database cleanup will be skipped if socket auth is unavailable."
      ;;
    *)
      die "SET_DB_ROOT_PASSWORD must be ask, 1, or 0"
      ;;
  esac

  if [[ -n "$DB_ROOT_PASSWORD" ]]; then
    ensure_mysql_auth_file
    if mysql_try_password_root; then
      MARIADB_ROOT_PASSWORD_OK=1
      DB_ROOT_AUTH_MODE="password"
      info "MariaDB root password authentication works"
      return
    fi
  fi

  warn "Could not authenticate as MariaDB root; DB cleanup will be skipped."
}

stop_pm2_process() {
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    warn "App user ${APP_USER} does not exist; skipping PM2 cleanup"
    return
  fi
  if ! command_exists sudo; then
    warn "sudo not available; skipping PM2 cleanup"
    return
  fi
  info "Stopping PM2 app for ${APP_USER}"
  sudo -u "$APP_USER" env PM2_HOME="/home/${APP_USER}/.pm2" pm2 delete colearn-ai >/dev/null 2>&1 || true
  sudo -u "$APP_USER" env PM2_HOME="/home/${APP_USER}/.pm2" pm2 save >/dev/null 2>&1 || true
}

stop_cxx_runner() {
  [[ "$REMOVE_CXX_RUNNER" == "1" ]] || return 0
  [[ -d "$CXX_RUNNER_DIR" ]] || return 0
  info "Stopping C++ runner in $CXX_RUNNER_DIR"
  if [[ -f "$CXX_RUNNER_DIR/docker-compose.yml" ]]; then
    if command_exists docker; then
      if docker compose version >/dev/null 2>&1; then
        (cd "$CXX_RUNNER_DIR" && docker compose down) || true
      elif command_exists docker-compose; then
        (cd "$CXX_RUNNER_DIR" && docker-compose down) || true
      fi
    fi
  fi
  info "Removing C++ runner directory"
  rm -rf "$CXX_RUNNER_DIR"
}

stop_py_runner() {
  [[ "$REMOVE_PY_RUNNER" == "1" ]] || return 0
  [[ -d "$PY_RUNNER_DIR" ]] || return 0
  info "Stopping Python runner in $PY_RUNNER_DIR"
  if [[ -f "$PY_RUNNER_DIR/docker-compose.yml" ]]; then
    if command_exists docker; then
      if docker compose version >/dev/null 2>&1; then
        (cd "$PY_RUNNER_DIR" && docker compose down) || true
      elif command_exists docker-compose; then
        (cd "$PY_RUNNER_DIR" && docker-compose down) || true
      fi
    fi
  fi
  info "Removing Python runner directory"
  rm -rf "$PY_RUNNER_DIR"
}

remove_nginx_config() {
  info "Removing nginx site config for ${SITE_NAME}"
  rm -f "$SITE_LINK" "$SITE_CONF"
  nginx -t >/dev/null 2>&1 || true
  systemctl reload nginx >/dev/null 2>&1 || systemctl restart nginx >/dev/null 2>&1 || true
}

remove_certificates() {
  [[ "$REMOVE_CERTS" == "1" ]] || return 0
  [[ -n "$CERT_DIR" ]] || return 0
  if [[ -d "$CERT_DIR" ]]; then
    info "Removing TLS certificate directory $CERT_DIR"
    rm -rf "$CERT_DIR"
  fi
  if command_exists certbot && [[ -n "$DOMAIN" ]]; then
    certbot delete --cert-name "$DOMAIN" --non-interactive >/dev/null 2>&1 || true
  fi
}

drop_database_objects() {
  [[ "$REMOVE_DB" == "1" || "$REMOVE_DB_USER" == "1" ]] || return 0
  if [[ "$MARIADB_ROOT_SOCKET_OK" != "1" && "$MARIADB_ROOT_PASSWORD_OK" != "1" ]]; then
    warn "Skipping database cleanup because MariaDB root auth is unavailable"
    return 0
  fi

  if [[ "$REMOVE_DB" == "1" ]]; then
    info "Dropping database ${DB_NAME} if it exists"
    mysql_exec_root "DROP DATABASE IF EXISTS \`${DB_NAME}\`;"
  fi
  if [[ "$REMOVE_DB_USER" == "1" ]]; then
    info "Dropping database user ${DB_USER} for localhost and 127.0.0.1 if they exist"
    mysql_exec_root "DROP USER IF EXISTS '${DB_USER}'@'localhost'; DROP USER IF EXISTS '${DB_USER}'@'127.0.0.1'; FLUSH PRIVILEGES;"
  fi
}

remove_app_runtime_files() {
  [[ -d "$APP_DIR" ]] || return 0

  if [[ "$REMOVE_ENV_FILES" == "1" ]]; then
    info "Removing generated environment files"
    rm -f "$APP_DIR/server/.env" "$APP_DIR/client/.env"
  fi

  if [[ "$REMOVE_BUILD_ARTIFACTS" == "1" ]]; then
    info "Removing built frontend artifacts"
    rm -rf "$APP_DIR/client/dist"
  fi

  if [[ "$REMOVE_NODE_MODULES" == "1" ]]; then
    info "Removing installed node_modules"
    rm -rf "$APP_DIR/server/node_modules" "$APP_DIR/client/node_modules"
  fi

  info "Removing generated bootstrap/deploy artifacts"
  rm -f "$APP_DIR/bootstrap-summary.txt"
  if [[ "$REMOVE_DEPLOY_CONFIGS" == "1" ]]; then
    rm -f "$APP_DIR/deploy.conf" "$APP_DIR/deploy.conf.template"
  else
    rm -f "$APP_DIR/deploy.conf.template"
  fi
}

print_plan() {
  cat <<EOF
====================================================
coLearn-AI cleanup plan
Application user:          ${APP_USER}
Application directory:     ${APP_DIR}
Database name/user:        ${DB_NAME} / ${DB_USER}
nginx site config:         ${SITE_CONF}
C++ runner directory:      ${CXX_RUNNER_DIR}
Python runner directory:    ${PY_RUNNER_DIR}
Remove database:           ${REMOVE_DB}
Remove database user:      ${REMOVE_DB_USER}
Remove C++ runner:         ${REMOVE_CXX_RUNNER}
Remove Python runner:       ${REMOVE_PY_RUNNER}
Remove env files:          ${REMOVE_ENV_FILES}
Remove node_modules:       ${REMOVE_NODE_MODULES}
Remove frontend build:     ${REMOVE_BUILD_ARTIFACTS}
Remove deploy configs:     ${REMOVE_DEPLOY_CONFIGS}
Remove TLS certs:          ${REMOVE_CERTS}
====================================================
EOF
}

main() {
  require_root
  detect_platform
  load_config_if_present
  resolve_settings
  prepare_db_root_access
  print_plan

  if ! prompt_yes_no "Proceed with coLearn-AI cleanup on this machine?" "n"; then
    die "Aborted by user."
  fi

  stop_pm2_process
  stop_cxx_runner
  stop_py_runner
  remove_nginx_config
  remove_certificates
  drop_database_objects
  remove_app_runtime_files

  info "Cleanup complete."
  info "You can now rerun:"
  info "  sudo bash 01_server_bootstrap.sh ${CONFIG_FILE}"
  info "  bash 02_app_deploy.sh /path/to/deploy.conf"
  info "  sudo bash 03_post_install_check.sh /path/to/deploy.conf"
}

main "$@"
