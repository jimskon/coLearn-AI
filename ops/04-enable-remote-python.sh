#!/usr/bin/env bash
set -Eeuo pipefail

LOG_PREFIX="[colearn-upgrade-py]"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${1:-/opt/coLearn-AI/deploy.conf}"
APP_DEPLOY="${REPO_ROOT}/02_app_deploy.sh"
POST_CHECK="${REPO_ROOT}/03_post_install_check.sh"

info() { echo "${LOG_PREFIX} $*"; }
warn() { echo "${LOG_PREFIX} WARNING: $*" >&2; }
die() { echo "${LOG_PREFIX} ERROR: $*" >&2; exit 1; }

cleanup() {
  [[ -n "${TMP_CONFIG:-}" && -f "${TMP_CONFIG:-}" ]] && rm -f "$TMP_CONFIG"
}
trap cleanup EXIT

[[ -f "$CONFIG_FILE" ]] || die "Config file not found: $CONFIG_FILE"
[[ -x "$APP_DEPLOY" ]] || die "Missing deploy script: $APP_DEPLOY"
[[ -x "$POST_CHECK" ]] || die "Missing post-install check script: $POST_CHECK"

TMP_CONFIG="$(mktemp /tmp/colearn-py-upgrade.XXXXXX)"
cp "$CONFIG_FILE" "$TMP_CONFIG"
cat >> "$TMP_CONFIG" <<EOF

# Added by ops/04-enable-remote-python.sh
ENABLE_PY_RUNNER=1
PY_RUNNER_DIR=/opt/py-runner
PY_RUNNER_PORT=5056
ENABLE_PY_RUNNER_PROXY=1
EOF

info "Using config file: $CONFIG_FILE"
info "Temporary upgrade config: $TMP_CONFIG"
info "Running app deploy with remote Python enabled"
bash "$APP_DEPLOY" "$TMP_CONFIG"

info "Refreshing nginx config with /py-run/ enabled"
sudo bash "$POST_CHECK" "$TMP_CONFIG"

info "Remote Python upgrade complete."
