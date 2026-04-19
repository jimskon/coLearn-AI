#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/db.sh"

# migrations/update_schema_sql.sh
# Regenerate schema.sql from the current database schema (no data)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/server/.env"
OUTPUT_FILE="$PROJECT_ROOT/schema.sql"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ERROR: server/.env not found"
  exit 1
fi

# Load DB credentials
export $(grep -v '^#' "$ENV_FILE" | xargs)

if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_NAME" ]; then
  echo "❌ ERROR: Missing DB credentials in server/.env"
  exit 1
fi

echo "🔄 Updating schema.sql from database..."
echo "------------------------------------"
echo "Database: $DB_NAME"
echo "Output:   $OUTPUT_FILE"
echo

mysqldump \
  -h "$DB_HOST" \
  -u "$DB_USER" \
  -p"$DB_PASSWORD" \
  --no-data \
  --routines=false \
  --events=false \
  --triggers=false \
  --single-transaction \
  --skip-comments \
  "$DB_NAME" > "$OUTPUT_FILE"

echo "✅ schema.sql updated successfully"
