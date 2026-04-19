#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT="$REPO_ROOT/client"
WWW="/var/www/html/its"

# ---- options/overrides -------------------------------------------------------
SITE_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site) SITE_OVERRIDE="${2:-}"; shift 2;;
    *) echo "Unknown arg: $1"; exit 2;;
  esac
done

need_root() {
  if [[ $EUID -ne 0 ]]; then
    echo "Please run as root: sudo $0 [--site /etc/nginx/sites-available/whatever]"
    exit 1
  fi
}

ensure_vite_base() {
  if grep -Eq "base:\s*['\"]/its/['\"]" "$CLIENT"/vite.config*.{js,ts} 2>/dev/null; then
    echo "vite.config base OK: /its/"
  else
    echo "NOTE: Set Vite base to '/its/' so assets resolve behind /its/"
    echo "Example in vite.config.js: export default { base: '/its/', /* ... */ }"
  fi
}

ensure_node_deps() {
  cd "$CLIENT"
  # Ensure terminal deps if your app uses a terminal
  npm pkg get dependencies.xterm | grep -q null && npm pkg set dependencies.xterm="^5.5.0" || true
  npm pkg get dependencies["xterm-addon-fit"] | grep -q null && npm pkg set dependencies["xterm-addon-fit"]="^0.9.0" || true
  npm ci
}

build_and_install() {
  cd "$CLIENT"
  npm run build
  install -d "$WWW"
  rsync -a --delete "$CLIENT/dist/" "$WWW/"
}

detect_site_file() {
  # Priority: explicit override → matching server_name → single https vhost
  if [[ -n "$SITE_OVERRIDE" ]]; then
    echo "$SITE_OVERRIDE"
    return
  fi

  local FQDN="${ITS_SERVER_NAME:-$(hostname -f)}"
  local CANDIDATES
  mapfile -t CANDIDATES < <(grep -l "server_name\s\+.*$FQDN" /etc/nginx/sites-available/* 2>/dev/null || true)
  if [[ ${#CANDIDATES[@]} -eq 1 ]]; then
    echo "${CANDIDATES[0]}"
    return
  fi

  # Fallback: pick the only HTTPS vhost if there is just one
  mapfile -t CANDIDATES < <(grep -l "listen\s\+443" /etc/nginx/sites-available/* 2>/dev/null || true)
  if [[ ${#CANDIDATES[@]} -eq 1 ]]; then
    echo "${CANDIDATES[0]}"
    return
  fi

  # Last resort: empty → caller will warn
  echo ""
}

patch_spa_block() {
  local SITE="$1"
  if [[ -z "$SITE" || ! -f "$SITE" ]]; then
    echo "WARN: Could not locate an nginx vhost to patch. Use --site /etc/nginx/sites-available/<file>"
    return 0
  fi

  cp -f "$SITE" "$SITE.bak.$(date +%s)" || true

  # Insert/replace a location /its/ block inside the *matching* HTTPS server
  # If one exists, replace it; otherwise insert it before the generic `location / {`
  awk -v want_server_name="${ITS_SERVER_NAME:-$(hostname -f)}" '
    BEGIN{in_srv=0; in_https=0; replaced=0}
    /^\s*server\s*\{/ {srv_depth=1; in_srv=1; in_https=0}
    in_srv && /\{/ { if ($0 !~ /^\s*server\s*\{/) srv_depth++ }
    in_srv && /\}/ { srv_depth--; if (srv_depth==0) {in_srv=0; in_https=0} }

    in_srv && /listen[^;]*443/ { in_https=1 }
    in_srv && /server_name/ && want_server_name != "" {
      if ($0 ~ want_server_name) in_https=1
    }

    in_https && /^\s*location\s+\/its\/\s*\{/ {
      # replace the whole existing /its/ block with our one-liner; skip until its closing brace
      print "  location /its/ { try_files $uri $uri/ /its/index.html; }"; 
      replaced=1
      skip=1; next
    }
    skip {
      if ($0 ~ /\}/) { skip=0 } 
      next
    }

    in_https && !replaced && /^\s*location\s+\/\s*\{/ {
      print "  location /its/ { try_files $uri $uri/ /its/index.html; }";
      replaced=1
    }

    {print}
  ' "$SITE" > "$SITE.tmp" && mv "$SITE.tmp" "$SITE"

  nginx -t
  systemctl reload nginx
  echo "Patched SPA fallback in: $SITE"
}

main() {
  need_root
  ensure_vite_base
  ensure_node_deps
  build_and_install
  local SITE_FILE; SITE_FILE="$(detect_site_file)"
  patch_spa_block "$SITE_FILE"
  echo "==> Frontend deployed to $WWW"
  echo "Try: https://$(hostname -f)/its/"
}

main "$@"
