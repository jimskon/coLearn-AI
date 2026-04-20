#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/coLearn-AI}"

cd "$APP_DIR"

if [[ "${SKIP_UPDATE:-0}" != "1" ]]; then
  git pull
fi

cd server
if [[ "${SKIP_SERVER_INSTALL:-0}" != "1" ]]; then
  npm install
fi
if [[ "${SKIP_SERVER_TESTS:-0}" != "1" ]]; then
  npm run test:ci
fi

cd ../client
npm ci
npm run build

cd ..
pm2 restart colearn-ai --update-env
pm2 save

sudo nginx -t
sudo systemctl reload nginx
