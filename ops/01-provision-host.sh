#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-all}"   # all | --nginx-only

need_root() {
  if [[ $EUID -ne 0 ]]; then
    echo "Please run as root: sudo $0 ${MODE}"
    exit 1
  fi
}

ensure_tools() {
  apt-get update
  apt-get install -y curl ca-certificates gnupg lsb-release jq rsync
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    echo "Docker already installed."
  else
    echo "==> Installing Docker..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" >/etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
  fi
  usermod -aG docker "${SUDO_USER:-$USER}" || true
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    echo "Node already installed: $(node -v)"
  else
    echo "==> Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  npm -v || true
}

install_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    echo "Nginx already installed."
  else
    echo "==> Installing Nginx..."
    apt-get install -y nginx
  fi
}

pm2_logrotate() {
  if command -v pm2 >/dev/null 2>&1; then
    sudo -u "${SUDO_USER:-$USER}" pm2 install pm2-logrotate || true
    sudo -u "${SUDO_USER:-$USER}" pm2 set pm2-logrotate:max_size 10M || true
    sudo -u "${SUDO_USER:-$USER}" pm2 set pm2-logrotate:retain 5 || true
    sudo -u "${SUDO_USER:-$USER}" pm2 set pm2-logrotate:compress true || true
    sudo -u "${SUDO_USER:-$USER}" pm2 save || true
  fi
}

write_nginx_snippet() {
  echo "==> Writing /etc/nginx/snippets/cxx-run.conf"
  install -d /etc/nginx/snippets
  cat >/etc/nginx/snippets/cxx-run.conf <<'NGINX'
location /cxx-run/ {
  proxy_pass         http://127.0.0.1:5055/;
  proxy_http_version 1.1;

  proxy_set_header   Upgrade $http_upgrade;
  proxy_set_header   Connection "upgrade";

  proxy_set_header   Host $host;
  proxy_set_header   X-Forwarded-Proto $scheme;
  proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;

  proxy_buffering off;
  proxy_read_timeout 600s;
  proxy_send_timeout 600s;

  client_max_body_size 256k;
  add_header X-Content-Type-Options nosniff always;
}
NGINX
}

ensure_include_in_tls_vhost() {
  local SITE="/etc/nginx/sites-available/jimskon.com"
  local INCLUDE='include /etc/nginx/snippets/cxx-run.conf;'
  if [[ ! -f "$SITE" ]]; then
    echo "WARN: $SITE not found. Skipping auto-include; ensure your TLS vhost is named that."
    return 0
  fi

  # Clean up stray backups that can break parsing
  rm -f /etc/nginx/sites-enabled/*~ /etc/nginx/sites-enabled/#*# /etc/nginx/sites-available/*~ /etc/nginx/sites-available/#*# 2>/dev/null || true

  if ! grep -qF "$INCLUDE" "$SITE"; then
    echo "==> Adding snippet include to $SITE (inside 443 server block)"
    awk -v inc="$INCLUDE" '
      BEGIN{in_tls=0}
      /server\s*\{/ { blk++ }
      /server_name[^\n]*jimskon\.com/ { in_server=1 }
      /listen 443/ && /ssl/ { in_tls=1 }
      { print_line=$0 }
      in_server && in_tls && /index index\.html;/ && !added { print_line=$0 RS "  " inc; added=1 }
      { print print_line }
    ' "$SITE" > "$SITE.tmp" && mv "$SITE.tmp" "$SITE"
  else
    echo "Include already present in $SITE"
  fi

  nginx -t
  systemctl reload nginx
}

main() {
  need_root
  ensure_tools
  install_nginx
  write_nginx_snippet
  ensure_include_in_tls_vhost

  if [[ "$MODE" != "--nginx-only" ]]; then
    install_docker
    install_node
    pm2_logrotate
  fi

  echo "==> Provision complete."
  echo "NOTE: if you were just added to the docker group, open a new shell or run: newgrp docker"
}

main "$@"
