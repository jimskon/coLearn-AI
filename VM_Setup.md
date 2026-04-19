#  Setup on a VM

## What this gives you
  - Root SSH + full bash control (you asked about this specifically ✅).
  - User pogil (sudo) to own/deploy the app.
  - MariaDB local, locked to 127.0.0.1, with a dedicated DB/user.
  - Node 20 + PM2 (boot-resilient with pm2 save).
  - Nginx serving the built React app, with reverse proxy to /api/ on port 4000.
  - Let’s Encrypt TLS via Certbot (--nginx), auto-renewed.
  - UFW open for 22/80/443.

# Typical update/deploy flow
## 1) SSH in, then:
```
su pogil
cd /opt/coLearn-AI
git pull --ff-only
```

## 2) Server deps (if package.json changed)
```
sudo apt install npm
cd server && npm ci
```

## 3) Rebuild client
```
cd ../client && npm ci && npm run build
```
## 4) Restart API
```
pm2 start index.js
pm2 restart colearn-ai
pm2 save
```
## 4) Optional: CXX runner or multiple services
If you run a separate C++ runner on port 5055, the Nginx /cxx-run/ location is already set.
For more Node services, add another location /foo/ { proxy_pass http://127.0.0.1:PORT/; }.

## Install Script

```
#!/usr/bin/env bash
set -euo pipefail

########### EDIT THESE ############
DOMAIN="csits.kenyon.edu"             # must resolve to this server
APP_USER="pogil"                      # non-root user to own the app
REPO_URL="https://github.com/jimskon/coLearn-AI.git"
APP_DIR="/opt/coLearn-AI"              # will clone here
NODE_PORT="4000"                      # your Node/Express port
DB_NAME="pogil_db"
DB_USER="pogil_db_user"
DB_PASS="$(openssl rand -base64 24)"  # auto-generate; printed at end
###################################

echo "==> Updating system"
apt-get update -y
apt-get upgrade -y

echo "==> Create sudo user ${APP_USER} (if missing)"
id -u "$APP_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$APP_USER"
usermod -aG sudo "$APP_USER"

echo "==> Basic tools"
apt-get install -y curl git build-essential ufw jq

echo "==> Firewall (UFW)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
yes | ufw enable || true
ufw status || true

echo "==> Install Node LTS (20.x) + PM2"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2

echo "==> Install Nginx"
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx

echo "==> Install MariaDB"
apt-get install -y mariadb-server mariadb-client
systemctl enable mariadb
systemctl start mariadb

echo "==> Secure MariaDB (create DB/user)"
mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "==> Bind MariaDB to localhost only"
sed -i 's/^\(\s*\)\(bind-address\s*=\s*\).*/\1\2 127.0.0.1/' /etc/mysql/mariadb.conf.d/50-server.cnf || true
systemctl restart mariadb

echo "==> Prepare app directory"
mkdir -p "$APP_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> Clone (or update) app"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> Initialize database schema (if empty)"
# Find schema.sql in the repo (project root, or up to 3 levels deep)
SCHEMA_PATH="$(find "$APP_DIR" -maxdepth 3 -type f -iname 'schema.sql' | head -n1 || true)"
if [ -z "$SCHEMA_PATH" ]; then
  echo "WARNING: schema.sql not found under $APP_DIR (skipping import)"
else
  TABLE_COUNT="$(mysql -N -u root -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}';")" || TABLE_COUNT=0
  if [ "${TABLE_COUNT:-0}" -eq 0 ]; then
    echo "No tables in ${DB_NAME}; importing schema from: $SCHEMA_PATH"
    mysql -u root "${DB_NAME}" < "$SCHEMA_PATH"
    echo "Schema import complete."
  else
    echo "Database ${DB_NAME} already has ${TABLE_COUNT} table(s); skipping schema import."
  fi
fi

# (Optional) seed data if you keep one:
# SEED_PATH="$(find "$APP_DIR" -maxdepth 3 -type f \( -iname 'seed.sql' -o -iname '*.seed.sql' \) | head -n1 || true)"
# if [ -n "$SEED_PATH" ]; then
#   echo "==> Importing seed data from: $SEED_PATH"
#   mysql -u root "${DB_NAME}" < "$SEED_PATH"
# fi

echo "==> Install server deps"
cd "$APP_DIR/server"
sudo -u "$APP_USER" npm ci || sudo -u "$APP_USER" npm install

echo "==> Create server .env"
cat > "$APP_DIR/server/.env" <<ENV
# --- Server env ---
PORT=${NODE_PORT}
NODE_ENV=production

# Database (local MariaDB)
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}

# CORS / client
CLIENT_ORIGIN=https://${DOMAIN}

# Service account (adjust if needed)
SERVICE_ACCOUNT_EMAIL=pogil-sheets-reader@colearn-ai.iam.gserviceaccount.com
ENV
chown "$APP_USER":"$APP_USER" "$APP_DIR/server/.env"
chmod 600 "$APP_DIR/server/.env"

echo "==> Build client"
cd "$APP_DIR/client"
# Ensure Vite API base is the public HTTPS origin
if grep -q '^VITE_API_BASE_URL' .env 2>/dev/null; then
  sed -i "s|^VITE_API_BASE_URL=.*|VITE_API_BASE_URL=https://${DOMAIN}|g" .env
else
  echo "VITE_API_BASE_URL=https://${DOMAIN}" >> .env
fi
sudo -u "$APP_USER" npm ci || sudo -u "$APP_USER" npm install
sudo -u "$APP_USER" npm run build

echo "==> Install Certbot for Nginx"
apt-get install -y certbot python3-certbot-nginx

echo "==> Nginx config for ${DOMAIN}"
cat >/etc/nginx/sites-available/colearn-ai.conf <<NGX
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN};
  # ACME + redirect
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { return 301 https://\$host\$request_uri; }
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name ${DOMAIN};

  # SSL managed by certbot (will be inserted below)

  # ---- STATIC: client build ----
  root ${APP_DIR}/client/dist;
  index index.html;

  # SPA fallback
  location / {
    try_files \$uri \$uri/ /index.html;
  }

  # --- API reverse proxy ---
  location /api/ {
    proxy_pass         http://127.0.0.1:${NODE_PORT}/api/;
    proxy_http_version 1.1;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto \$scheme;
    proxy_set_header   Host \$host;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_read_timeout 600s;
  }

  # Example: C++ runner passthrough if you use it
  location /cxx-run/ {
    proxy_pass         http://127.0.0.1:5055/;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host \$host;
  }

  # Security / misc
  client_max_body_size 25m;
  add_header X-Frame-Options SAMEORIGIN;
  add_header X-Content-Type-Options nosniff;
  add_header Referrer-Policy strict-origin-when-cross-origin;
}
NGX

ln -sf /etc/nginx/sites-available/colearn-ai.conf /etc/nginx/sites-enabled/colearn-ai.conf
nginx -t
systemctl reload nginx

echo "==> Obtain/Install TLS cert"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}" --redirect || true
systemctl reload nginx || true

echo "==> Launch server with PM2 and set autostart"
cd "$APP_DIR/server"
sudo -u "$APP_USER" pm2 start npm --name colearn-ai -- run start
# PM2 startup for this user
sudo -u "$APP_USER" pm2 startup systemd -u "$APP_USER" --hp "/home/${APP_USER}" | tail -n1 | bash || true
sudo -u "$APP_USER" pm2 save

echo
echo "========================================="
echo " Done."
echo " Domain:           https://${DOMAIN}"
echo " DB name/user:     ${DB_NAME} / ${DB_USER}"
echo " DB password:      ${DB_PASS}"
echo " App directory:    ${APP_DIR}"
echo " Node port:        ${NODE_PORT}"
echo " Nginx site:       /etc/nginx/sites-available/colearn-ai.conf"
echo " PM2 process:      pm2 list   (as ${APP_USER})"
echo "========================================="

```
