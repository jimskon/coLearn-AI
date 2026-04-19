#!/usr/bin/env bash
set -euo pipefail

# Load DB config from server/.env (relative to migrations/)
MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$MIGRATIONS_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/server/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing env file: $ENV_FILE" >&2
  exit 1
fi

# Load .env safely (supports lines like KEY=VALUE, ignores comments/blank)
set -a
# shellcheck disable=SC1090
source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sed 's/\r$//')
set +a

# Normalize common variable names (adjust if your .env differs)
DB_HOST="${DB_HOST:-${MYSQL_HOST:-localhost}}"
DB_PORT="${DB_PORT:-${MYSQL_PORT:-3306}}"
DB_USER="${DB_USER:-${MYSQL_USER:-root}}"
DB_PASSWORD="${DB_PASSWORD:-${MYSQL_PASSWORD:-}}"
DB_NAME="${DB_NAME:-${MYSQL_DATABASE:-${MYSQL_DB:-}}}"

if [[ -z "${DB_NAME:-}" ]]; then
  echo "ERROR: DB_NAME not found in $ENV_FILE (expected DB_NAME or MYSQL_DATABASE)" >&2
  exit 1
fi

# Prefer mariadb/mysql CLI; pick whichever exists
DB_CLI="${DB_CLI:-}"
if [[ -z "$DB_CLI" ]]; then
  if command -v mariadb >/dev/null 2>&1; then
    DB_CLI="mariadb"
  else
    DB_CLI="mysql"
  fi
fi

# Run SQL passed via stdin:
db_exec() {
  # Avoid showing password in process list by using MYSQL_PWD env
  MYSQL_PWD="$DB_PASSWORD" \
  "$DB_CLI" \
    --protocol=tcp \
    -h "$DB_HOST" \
    -P "$DB_PORT" \
    -u "$DB_USER" \
    "$DB_NAME"
}

# Run a .sql file:
db_exec_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: SQL file not found: $file" >&2
    exit 1
  fi
  db_exec < "$file"
}
