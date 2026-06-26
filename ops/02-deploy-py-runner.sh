#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${REPO_ROOT}/ops/py-runner"
DST="${DST:-/opt/py-runner}"

IMAGE_NAME="${CONTAINER_IMAGE:-py-runner:stable}"
RUNNER_NAME="${CONTAINER_NAME:-py-runner}"
REDIS_NAME="${REDIS_NAME:-py-redis}"
NET_NAME="${NET_NAME:-py-net}"

HOST_PORT="${HOST_PORT:-5056}"
INTERNAL_PORT="${INTERNAL_PORT:-8000}"

FQDN="${ITS_SERVER_NAME:-$(hostname -f)}"
PUBLIC_PREFIX="${PUBLIC_PREFIX:-/py-run/}"

log()  { printf '\n[INFO] %s\n' "$*"; }
warn() { printf '\n[WARN] %s\n' "$*"; }
die()  { printf '\n[ERROR] %s\n' "$*"; exit 1; }

docker_cmd() {
  if command -v docker >/dev/null 2>&1; then
    echo "docker"
  else
    die "Docker not found. Install Docker before running this script."
  fi
}

wait_http() {
  local url="$1" max="${2:-30}"
  for _ in $(seq 1 "$max"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

log "Syncing runner sources to ${DST}"
sudo mkdir -p "$DST"
sudo rsync -a --delete "${SRC}/" "${DST}/"

D="$(docker_cmd)"

log "Building ${IMAGE_NAME}"
cd "$DST"
sudo $D build --pull -t "${IMAGE_NAME}" .

log "Ensuring Docker network ${NET_NAME}"
sudo $D network create "${NET_NAME}" >/dev/null 2>&1 || true

log "Starting Redis container (${REDIS_NAME})"
sudo $D rm -f "${REDIS_NAME}" >/dev/null 2>&1 || true
sudo $D run -d --restart=always \
  --name "${REDIS_NAME}" \
  --network "${NET_NAME}" \
  redis:7-alpine

log "Starting Python runner container (${RUNNER_NAME}) on ${HOST_PORT}->${INTERNAL_PORT}"
sudo $D rm -f "${RUNNER_NAME}" >/dev/null 2>&1 || true
sudo $D run -d --restart=always \
  --name "${RUNNER_NAME}" \
  --network "${NET_NAME}" \
  -e REDIS_HOST="${REDIS_NAME}" \
  -e REDIS_PORT=6379 \
  -p "${HOST_PORT}:${INTERNAL_PORT}" \
  "${IMAGE_NAME}"

log "Waiting for local health check on http://127.0.0.1:${HOST_PORT}/health"
if ! wait_http "http://127.0.0.1:${HOST_PORT}/health" 60; then
  warn "Runner health check did not succeed; check: sudo docker logs ${RUNNER_NAME}"
else
  log "Runner is healthy."
fi

log "Active containers:"
sudo $D ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

cat <<EOF

[INFO] Add the following location block to your HTTPS server {} for ${FQDN}
(in /etc/nginx/sites-available/<your-site>.conf), BEFORE the generic 'location /':

    location ${PUBLIC_PREFIX} {
        proxy_pass         http://127.0.0.1:${HOST_PORT}/;
        proxy_http_version 1.1;

        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;

        proxy_buffering    off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;

        client_max_body_size 256k;
        add_header X-Content-Type-Options nosniff always;
    }

Then run:
    sudo nginx -t && sudo systemctl reload nginx

You should then be able to hit:
    https://${FQDN}${PUBLIC_PREFIX}health
    https://${FQDN}${PUBLIC_PREFIX}session/new

EOF

log "Python runner deployment complete."
