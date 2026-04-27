#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/opt/POGIL-ITS"
ENV_FILE="$PROJECT_ROOT/server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Could not find $ENV_FILE"
  exit 1
fi

export $(grep -E '^(DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME)=' "$ENV_FILE" | xargs)

: "${DB_HOST:?DB_HOST not set in server/.env}"
: "${DB_USER:?DB_USER not set in server/.env}"
: "${DB_PASSWORD:?DB_PASSWORD not set in server/.env}"
: "${DB_NAME:?DB_NAME not set in server/.env}"
DB_PORT="${DB_PORT:-3306}"

read -rp "Enter activity instance ID: " INSTANCE_ID

if ! [[ "$INSTANCE_ID" =~ ^[0-9]+$ ]]; then
  echo "ERROR: instance ID must be a number"
  exit 1
fi

echo ""
echo "What do you want to view?"
echo "1) responses (submit history)"
echo "2) response_drafts (current state)"
echo "3) both"
read -rp "Choose (1/2/3): " CHOICE

echo ""

if [[ "$CHOICE" == "1" || "$CHOICE" == "3" ]]; then
  echo "===== RESPONSES (submit history) ====="
  mysql -t -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "-p${DB_PASSWORD}" "$DB_NAME" <<SQL
SELECT
  id,
  submit_id,
  question_id,
  response_type,
  answered_by_user_id,
  LEFT(REPLACE(REPLACE(COALESCE(response, ''), '\r', ' '), '\n', ' '), 120) AS response_preview
FROM responses
WHERE activity_instance_id = ${INSTANCE_ID}
ORDER BY submit_id, id;
SQL
  echo ""
fi

if [[ "$CHOICE" == "2" || "$CHOICE" == "3" ]]; then
  echo "===== RESPONSE_DRAFTS (current state) ====="
  mysql -t -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "-p${DB_PASSWORD}" "$DB_NAME" <<SQL
SELECT
  id,
  question_id,
  response_type,
  answered_by_user_id,
  updated_at,
  LEFT(REPLACE(REPLACE(COALESCE(response, ''), '\r', ' '), '\n', ' '), 120) AS response_preview
FROM response_drafts
WHERE activity_instance_id = ${INSTANCE_ID}
ORDER BY question_id;
SQL
  echo ""
fi