#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/server" && pwd)"
ENV_FILE="$SERVER_DIR/.env"

echo "Using server dir: $SERVER_DIR"
echo "Looking for env file: $ENV_FILE"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ ERROR: .env file not found at $ENV_FILE"
  echo "Make sure you run this from the project root and that server/.env exists."
  exit 1
fi

# --- Load DB credentials from .env ---
echo "Loading DB credentials from .env..."

# shellcheck disable=SC2046
set -o allexport
grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" > /tmp/.env.effective.$$
source /tmp/.env.effective.$$
rm /tmp/.env.effective.$$ || true
set +o allexport

# Expected env vars
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-pogil_db}"

echo "DB_HOST = $DB_HOST"
echo "DB_PORT = $DB_PORT"
echo "DB_USER = $DB_USER"
echo "DB_NAME = $DB_NAME"

if [[ -z "$DB_NAME" ]]; then
  echo "❌ ERROR: DB_NAME is empty. Check your server/.env file."
  exit 1
fi

# --- Build MySQL command correctly ---
MYSQL_CMD=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME")
if [[ -n "$DB_PASSWORD" ]]; then
  # -pPASSWORD must be part of the mysql invocation, not before it
  MYSQL_CMD=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "-p$DB_PASSWORD" "$DB_NAME")
fi

# --- Test MySQL connection ---
echo "Testing MySQL connection..."
if ! echo "SELECT 1;" | "${MYSQL_CMD[@]}" &>/dev/null; then
  echo "❌ ERROR: Unable to connect to MySQL with provided credentials."
  echo "Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME in server/.env"
  exit 1
fi
echo "✅ MySQL connection OK."

# --- Schema fixes ---
SQL=$(cat <<'EOSQL'
-- Ensure pogil_activities.is_test exists
ALTER TABLE pogil_activities
  ADD COLUMN IF NOT EXISTS is_test TINYINT(1) NOT NULL DEFAULT 0;

-- Ensure activity_instances.total_groups exists (used by group progress)
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS total_groups INT NOT NULL DEFAULT 1;
EOSQL
)

echo "Applying schema fixes..."
echo "$SQL" | "${MYSQL_CMD[@]}"

echo "✅ Schema fix completed successfully."
