#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${CONTAINER_IMAGE:-cxx-runner:stable}"
RUNNER_NAME="${CONTAINER_NAME:-cxx-runner}"
REDIS_NAME="${REDIS_NAME:-redis}"
NET_NAME="${NET_NAME:-cxx-net}"
HOST_PORT="${HOST_PORT:-5055}"
INTERNAL_PORT="${INTERNAL_PORT:-8000}"

log()  { printf '\n[INFO] %s\n' "$*"; }
warn() { printf '\n[WARN] %s\n' "$*"; }

docker_cmd() {
  if command -v docker >/dev/null 2>&1; then
    echo "docker"
  else
    echo ""
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

D="$(docker_cmd)"
[[ -n "$D" ]] || { echo "[ERROR] Docker not found."; exit 1; }

log "Ensuring Docker network ${NET_NAME}"
sudo $D network create "${NET_NAME}" >/dev/null 2>&1 || true

# Redis
if sudo $D ps --format '{{.Names}}' | grep -q "^${REDIS_NAME}\$"; then
  log "Redis (${REDIS_NAME}) is running."
else
  if sudo $D ps -a --format '{{.Names}}' | grep -q "^${REDIS_NAME}\$"; then
    log "Starting existing Redis container ${REDIS_NAME}"
    sudo $D start "${REDIS_NAME}"
  else
    log "Creating Redis container ${REDIS_NAME}"
    sudo $D run -d --restart=always \
      --name "${REDIS_NAME}" \
      --network "${NET_NAME}" \
      redis:7
  fi
fi

# Runner
if sudo $D ps --format '{{.Names}}' | grep -q "^${RUNNER_NAME}\$"; then
  log "C++ runner (${RUNNER_NAME}) is running."
else
  if ! sudo $D images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${IMAGE_NAME}\$"; then
    warn "Image ${IMAGE_NAME} not found. Rebuild with ops/02-deploy-cxx-runner.sh."
    exit 1
  fi

  if sudo $D ps -a --format '{{.Names}}' | grep -q "^${RUNNER_NAME}\$"; then
    log "Removing stopped runner container ${RUNNER_NAME}"
    sudo $D rm -f "${RUNNER_NAME}" >/dev/null 2>&1 || true
  fi

  log "Starting C++ runner container ${RUNNER_NAME} on ${HOST_PORT}->${INTERNAL_PORT}"
  sudo $D run -d --restart=always \
    --name "${RUNNER_NAME}" \
    --network "${NET_NAME}" \
    -p "${HOST_PORT}:${INTERNAL_PORT}" \
    "${IMAGE_NAME}"
fi

if wait_http "http://127.0.0.1:${HOST_PORT}/health" 30; then
  log "Runner healthy at http://127.0.0.1:${HOST_PORT}/health"
else
  warn "Runner did not respond to health check; check: sudo docker logs ${RUNNER_NAME}"
fi

log "Current containers:"
sudo $D ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
