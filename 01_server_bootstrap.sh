#!/usr/bin/env bash
set -Eeuo pipefail

LOG_PREFIX="[colearn-bootstrap]"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${1:-${SCRIPT_DIR}/install.conf}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"

DEFAULT_APP_USER="${SUDO_USER:-}"
APP_USER="${APP_USER:-$DEFAULT_APP_USER}"
CREATE_APP_USER="${CREATE_APP_USER:-0}"
DOMAIN="${DOMAIN:-}"
WWW_DOMAIN="${WWW_DOMAIN:-}"
APP_DIR="${APP_DIR:-/opt/coLearn-AI}"
DB_NAME="${DB_NAME:-colearn_db}"
DB_USER="${DB_USER:-colearn_user}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-}"
SET_DB_ROOT_PASSWORD="${SET_DB_ROOT_PASSWORD:-ask}"
PORT="${PORT:-4000}"
SITE_NAME="${SITE_NAME:-colearn-ai}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ENABLE_CERTBOT="${ENABLE_CERTBOT:-ask}"
ENABLE_DOCKER="${ENABLE_DOCKER:-1}"
ENABLE_CXX_RUNNER_PROXY="${ENABLE_CXX_RUNNER_PROXY:-ask}"
CXX_RUNNER_PORT="${CXX_RUNNER_PORT:-5055}"
NODE_MAJOR="${NODE_MAJOR:-20}"

PKG_MANAGER=""
OS_FAMILY="unknown"
ADMIN_GROUP="sudo"

MYSQL_AUTH_FILE=""
MARIADB_ROOT_SOCKET_OK=0
MARIADB_ROOT_PASSWORD_OK=0
DB_ROOT_AUTH_MODE="socket"
SITE_CONF=""
SITE_LINK=""
CERT_FULLCHAIN=""
CERT_PRIVKEY=""
ENABLE_CXX_RUNNER_PROXY_FINAL=0

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

detect_platform() {
  if command_exists apt-get; then
    PKG_MANAGER="apt"
    OS_FAMILY="debian"
    ADMIN_GROUP="sudo"
  elif command_exists dnf; then
    PKG_MANAGER="dnf"
    OS_FAMILY="rhel"
    ADMIN_GROUP="wheel"
  elif command_exists yum; then
    PKG_MANAGER="yum"
    OS_FAMILY="rhel"
    ADMIN_GROUP="wheel"
  else
    die "Unsupported package manager. Expected apt-get, dnf, or yum."
  fi
}

pkg_update() {
  case "$PKG_MANAGER" in
    apt) apt-get update -y ;;
    dnf) dnf makecache -y ;;
    yum) yum makecache -y ;;
    *) die "pkg_update called before platform detection" ;;
  esac
}

pkg_install() {
  case "$PKG_MANAGER" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
    *) die "pkg_install called before platform detection" ;;
  esac
}

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
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    return 0
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
    if [[ "$NONINTERACTIVE" == "1" ]]; then
      die "APP_USER must be set explicitly or script must be run with sudo from the intended app user."
    fi
    prompt_default APP_USER "Application owner user" "${SUDO_USER:-}"
  else
    prompt_default APP_USER "Application owner user" "$APP_USER"
  fi
  [[ -n "$APP_USER" && "$APP_USER" != "root" ]] || die "APP_USER cannot be blank or root."

  prompt_default DOMAIN "Primary domain" "colearn.example.edu"
  if [[ -z "$WWW_DOMAIN" ]]; then
    WWW_DOMAIN="www.${DOMAIN}"
  fi
  prompt_default WWW_DOMAIN "Alias / www domain" "$WWW_DOMAIN"
  prompt_default APP_DIR "Application directory" "$APP_DIR"
  prompt_default PORT "Node/Express port" "$PORT"
  prompt_default DB_NAME "Application database name" "$DB_NAME"
  prompt_default DB_USER "Application database user" "$DB_USER"
  if [[ -z "$DB_PASSWORD" ]]; then
    DB_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
  fi
  prompt_secret_keep DB_PASSWORD "Application database password"
  prompt_default SITE_NAME "nginx site config name" "$SITE_NAME"
  prompt_default NODE_MAJOR "Node major version" "$NODE_MAJOR"
  prompt_default CXX_RUNNER_PORT "C++ runner port" "$CXX_RUNNER_PORT"

  if [[ "$OS_FAMILY" == "rhel" ]]; then
    SITE_CONF="/etc/nginx/conf.d/${SITE_NAME}.conf"
    SITE_LINK="$SITE_CONF"
  else
    SITE_CONF="/etc/nginx/sites-available/${SITE_NAME}.conf"
    SITE_LINK="/etc/nginx/sites-enabled/${SITE_NAME}.conf"
  fi
  CERT_FULLCHAIN="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  CERT_PRIVKEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
}

ensure_base_packages() {
  info "Updating package metadata"
  pkg_update
  info "Installing system packages"
  if [[ "$OS_FAMILY" == "rhel" ]]; then
    pkg_install \
      ca-certificates curl gnupg2 git gcc gcc-c++ make jq openssl \
      nginx mariadb-server mariadb
  else
    pkg_install \
      ca-certificates curl gnupg git build-essential ufw jq openssl \
      nginx mariadb-server mariadb-client
  fi
}

ensure_node() {
  local need_install=0
  if ! command_exists node; then
    need_install=1
  else
    local current_major
    current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    [[ "$current_major" -lt "$NODE_MAJOR" ]] && need_install=1
  fi
  if [[ "$need_install" -eq 1 ]]; then
    info "Installing Node.js ${NODE_MAJOR}.x"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    pkg_install nodejs
  else
    info "Node.js already installed: $(node -v)"
  fi
  info "Installing PM2"
  npm install -g pm2
}

ensure_app_user() {
  if id -u "$APP_USER" >/dev/null 2>&1; then
    info "Application owner ${APP_USER} already exists"
  else
    if [[ "$CREATE_APP_USER" != "1" ]]; then
      die "User ${APP_USER} does not exist. Create it first or rerun with CREATE_APP_USER=1."
    fi
    info "Creating application owner user ${APP_USER}"
    if [[ "$OS_FAMILY" == "rhel" ]]; then
      useradd -m "$APP_USER"
    else
      adduser --disabled-password --gecos "" "$APP_USER"
    fi
    usermod -aG "$ADMIN_GROUP" "$APP_USER"
  fi
  mkdir -p "$APP_DIR"
  chown "$APP_USER:$APP_USER" "$APP_DIR"
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
    die "MariaDB root auth not established."
  fi
}
ensure_mariadb() {
  info "Ensuring MariaDB is enabled and running"
  systemctl enable mariadb
  systemctl start mariadb
  local bind_cfg=""
  if [[ -f /etc/mysql/mariadb.conf.d/50-server.cnf ]]; then
    bind_cfg="/etc/mysql/mariadb.conf.d/50-server.cnf"
  elif [[ -f /etc/my.cnf.d/mariadb-server.cnf ]]; then
    bind_cfg="/etc/my.cnf.d/mariadb-server.cnf"
  elif [[ -f /etc/my.cnf.d/server.cnf ]]; then
    bind_cfg="/etc/my.cnf.d/server.cnf"
  fi
  if [[ -n "$bind_cfg" ]]; then
    sed -i 's/^\s*bind-address\s*=.*/bind-address = 127.0.0.1/' "$bind_cfg" || true
    systemctl restart mariadb
  fi
  if mysql_try_socket_root; then
    MARIADB_ROOT_SOCKET_OK=1
    DB_ROOT_AUTH_MODE="socket"
    info "MariaDB root access via unix_socket is available"
    return 0
  fi
  while true; do
    if [[ -z "$DB_ROOT_PASSWORD" ]]; then
      [[ "$NONINTERACTIVE" == "1" ]] && die "DB_ROOT_PASSWORD is required when socket auth is unavailable."
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
      return 0
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
      fi ;;
    *) die "SET_DB_ROOT_PASSWORD must be ask, 1, or 0" ;;
  esac
  [[ "$should_set" -eq 1 ]] || return 0
  if [[ -z "$DB_ROOT_PASSWORD" ]]; then
    [[ "$NONINTERACTIVE" == "1" ]] && die "DB_ROOT_PASSWORD must be set when SET_DB_ROOT_PASSWORD=1 in noninteractive mode."
    local confirm=""
    while true; do
      read -r -s -p "New MariaDB root password: " DB_ROOT_PASSWORD; echo
      read -r -s -p "Confirm MariaDB root password: " confirm; echo
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

setup_database() {
  local pw_esc
  pw_esc="$(sql_escape "$DB_PASSWORD")"
  info "Ensuring application database and database user exist"
  mysql_exec_root "
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${pw_esc}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${pw_esc}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;"
}

setup_nginx_http() {
  mkdir -p /var/www/html
  cat > "$SITE_CONF" <<EOFHTTP
server {
    listen 80;
    listen [::]:80;
    server_name ${WWW_DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 http://${DOMAIN}\$request_uri; }
}
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    root ${APP_DIR}/client/dist;
    index index.html;
    location /.well-known/acme-challenge/ { root /var/www/html; }
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
  if [[ "$ENABLE_CXX_RUNNER_PROXY_FINAL" == "1" ]]; then
    cat >> "$SITE_CONF" <<EOFCXX
    location /cxx-run/ {
        proxy_pass http://127.0.0.1:${CXX_RUNNER_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
EOFCXX
  fi
  cat >> "$SITE_CONF" <<EOFFOOT
    location / { try_files \$uri \$uri/ /index.html; }
    client_max_body_size 25m;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;
}
EOFFOOT
}

setup_nginx_https() {
  cat > "$SITE_CONF" <<EOFHTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ${WWW_DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://${DOMAIN}\$request_uri; }
}
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://${DOMAIN}\$request_uri; }
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
  if [[ "$ENABLE_CXX_RUNNER_PROXY_FINAL" == "1" ]]; then
    cat >> "$SITE_CONF" <<EOFCXX2
    location /cxx-run/ {
        proxy_pass http://127.0.0.1:${CXX_RUNNER_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
EOFCXX2
  fi
  cat >> "$SITE_CONF" <<EOFFOOT2
    location / { try_files \$uri \$uri/ /index.html; }
    client_max_body_size 25m;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;
}
EOFFOOT2
}

install_or_refresh_nginx_config() {
  if [[ -f "$CERT_FULLCHAIN" && -f "$CERT_PRIVKEY" ]]; then
    info "Writing HTTPS nginx config"
    setup_nginx_https
  else
    info "Writing HTTP nginx config"
    setup_nginx_http
  fi
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  if [[ "$SITE_CONF" != "$SITE_LINK" ]]; then
    ln -sf "$SITE_CONF" "$SITE_LINK"
  fi
  nginx -t
  systemctl reload nginx
}

maybe_install_cert() {
  local should_request=0
  if [[ -f "$CERT_FULLCHAIN" && -f "$CERT_PRIVKEY" ]]; then
    info "TLS certificate already present for ${DOMAIN}"
    install_or_refresh_nginx_config
    return 0
  fi
  case "$ENABLE_CERTBOT" in
    1) should_request=1 ;;
    0) should_request=0 ;;
    ask)
      if prompt_yes_no "No TLS certificate found for ${DOMAIN}. Request one now with Certbot?" "y"; then
        should_request=1
      fi ;;
    *) die "ENABLE_CERTBOT must be ask, 1, or 0" ;;
  esac
  if [[ "$should_request" -eq 0 ]]; then
    warn "Leaving nginx on HTTP only. You can run certbot later once DNS is ready."
    install_or_refresh_nginx_config
    return 0
  fi
  [[ -n "$ADMIN_EMAIL" ]] || prompt_default ADMIN_EMAIL "Certbot contact email" "admin@${DOMAIN}"
  if [[ "$OS_FAMILY" == "rhel" ]]; then
    pkg_install epel-release || true
  fi
  pkg_install certbot python3-certbot-nginx
  install_or_refresh_nginx_config
  certbot --nginx --non-interactive --agree-tos --redirect -m "$ADMIN_EMAIL" -d "$DOMAIN" -d "$WWW_DOMAIN"
  [[ -f "$CERT_FULLCHAIN" && -f "$CERT_PRIVKEY" ]] || die "Certbot did not create the expected certificate files."
  install_or_refresh_nginx_config
}

setup_firewall() {
  if command_exists ufw; then
    info "Configuring UFW"
    ufw allow OpenSSH || true
    ufw allow 'Nginx Full' || true
    ufw --force enable || true
  elif command_exists firewall-cmd; then
    info "Configuring firewalld"
    systemctl enable firewalld || true
    systemctl start firewalld || true
    firewall-cmd --permanent --add-service=ssh || true
    firewall-cmd --permanent --add-service=http || true
    firewall-cmd --permanent --add-service=https || true
    firewall-cmd --reload || true
  else
    warn "No supported firewall tool found; skipping firewall configuration"
  fi
}

maybe_install_docker() {
  if [[ "$ENABLE_DOCKER" != "1" ]]; then
    return 0
  fi
  info "Ensuring Docker is installed"
  if [[ "$OS_FAMILY" == "rhel" ]]; then
    pkg_install dnf-plugins-core || true
    pkg_install docker docker-compose-plugin || pkg_install docker docker-compose
  else
    pkg_install docker.io docker-compose-v2 || pkg_install docker.io docker-compose
  fi
  systemctl enable docker
  systemctl start docker
  usermod -aG docker "$APP_USER" || true
}

resolve_cxx_proxy_setting() {
  case "$ENABLE_CXX_RUNNER_PROXY" in
    1) ENABLE_CXX_RUNNER_PROXY_FINAL=1 ;;
    0) ENABLE_CXX_RUNNER_PROXY_FINAL=0 ;;
    ask)
      if prompt_yes_no "Configure nginx proxy location for /cxx-run/?" "y"; then
        ENABLE_CXX_RUNNER_PROXY_FINAL=1
      else
        ENABLE_CXX_RUNNER_PROXY_FINAL=0
      fi ;;
    *) die "ENABLE_CXX_RUNNER_PROXY must be ask, 1, or 0" ;;
  esac
}

write_stage2_template() {
  local template_file="${APP_DIR}/deploy.conf.template"
  info "Writing stage-2 config template to $template_file"
  cat > "$template_file" <<EOFCONF
REPO_URL=https://github.com/jimskon/coLearn-AI.git
REPO_BRANCH=main
APP_USER=${APP_USER}
APP_DIR=${APP_DIR}
PORT=${PORT}
DOMAIN=${DOMAIN}
WWW_DOMAIN=${WWW_DOMAIN}
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
CLIENT_ORIGIN=https://${DOMAIN}
SESSION_SECRET=
SERVICE_ACCOUNT_EMAIL=pogil-sheets-reader@colearn-ai.iam.gserviceaccount.com
APP_ROOT_NAME=Administrator
APP_ROOT_EMAIL=admin@${DOMAIN}
APP_ROOT_PASSWORD=
BOOTSTRAP_APP_ROOT=1
SERVER_ENTRY=server/index.js
ENABLE_CXX_RUNNER=0
CXX_RUNNER_REPO_URL=
CXX_RUNNER_DIR=/opt/cxx-runner
CXX_RUNNER_BRANCH=main
CXX_RUNNER_PORT=${CXX_RUNNER_PORT}
EOFCONF
  chown "$APP_USER:$APP_USER" "$template_file"
  chmod 600 "$template_file"
}

write_summary() {
  local summary_file="${APP_DIR}/bootstrap-summary.txt"
  cat > "$summary_file" <<EOFSUM
coLearn-AI stage 1 bootstrap complete
Domain: ${DOMAIN}
WWW domain: ${WWW_DOMAIN}
Application user: ${APP_USER}
Application directory: ${APP_DIR}
Node port: ${PORT}
Database: ${DB_NAME}
Database user: ${DB_USER}
Database password: ${DB_PASSWORD}
MariaDB root auth mode: ${DB_ROOT_AUTH_MODE}
nginx site config: ${SITE_CONF}
Stage-2 template: ${APP_DIR}/deploy.conf.template
EOFSUM
  chown "$APP_USER:$APP_USER" "$summary_file"
}

print_summary() {
  echo
  echo "===================================================="
  echo "coLearn-AI stage 1 bootstrap complete"
  echo "Domain:                    ${DOMAIN}"
  echo "WWW domain:                ${WWW_DOMAIN}"
  if [[ -f "$CERT_FULLCHAIN" ]]; then
    echo "Public URL:                https://${DOMAIN}"
  else
    echo "Public URL:                http://${DOMAIN}"
  fi
  echo "Application user:          ${APP_USER}"
  echo "Application directory:     ${APP_DIR}"
  echo "Node port:                 ${PORT}"
  echo "App DB name/user:          ${DB_NAME} / ${DB_USER}"
  echo "App DB password:           ${DB_PASSWORD}"
  echo "MariaDB root auth mode:    ${DB_ROOT_AUTH_MODE}"
  echo "nginx site config:         ${SITE_CONF}"
  echo "Stage-2 template:          ${APP_DIR}/deploy.conf.template"
  echo "Summary file:              ${APP_DIR}/bootstrap-summary.txt"
  echo "===================================================="
}

main() {
  require_root
  detect_platform
  load_config_if_present
  resolve_settings
  ensure_base_packages
  ensure_node
  ensure_app_user
  ensure_mariadb
  maybe_set_mariadb_root_password
  setup_database
  resolve_cxx_proxy_setting
  maybe_install_docker
  install_or_refresh_nginx_config
  maybe_install_cert
  setup_firewall
  write_stage2_template
  write_summary
  print_summary
}

main "$@"
