#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/coLearn-AI}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-$APP_DIR/scripts/deploy-production.sh}"

echo "Updating $APP_DIR from origin/main..."
cd "$APP_DIR"
git fetch origin
git reset --hard origin/main

echo "Installing server dependencies..."
cd "$APP_DIR/server"
npm install

echo "Running server tests..."
npm test

echo "Running deploy..."
cd "$APP_DIR"
SKIP_UPDATE=1 \
SKIP_SERVER_INSTALL=1 \
SKIP_SERVER_TESTS=1 \
  "$DEPLOY_SCRIPT"

echo "Update and deploy complete."
