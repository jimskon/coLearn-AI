#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/db.sh"

# migrations/20251210_add_progress_cache_columns.sh
# Adds cached progress + test score columns to activity_instances.
# Uses DB_* credentials from server/.env.

set -euo pipefail

# Go to project root (assuming this script lives in migrations/)
cd "$(dirname "$0")/.."

ENV_FILE="server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Could not find $ENV_FILE"
  exit 1
fi

# Export DB vars from .env
# Adjust the variable names if your .env uses different keys.
export $(grep -E '^(DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME)=' "$ENV_FILE" | xargs)

: "${DB_HOST:?DB_HOST not set in server/.env}"
: "${DB_USER:?DB_USER not set in server/.env}"
: "${DB_PASSWORD:?DB_PASSWORD not set in server/.env}"
: "${DB_NAME:?DB_NAME not set in server/.env}"
DB_PORT="${DB_PORT:-3306}"

echo "Running migration on ${DB_NAME} at ${DB_HOST}:${DB_PORT} ..."

MYSQL_CMD=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "-p${DB_PASSWORD}" "$DB_NAME")

"${MYSQL_CMD[@]}" <<'SQL'
-- Add cached progress/test columns to activity_instances.
-- All statements are idempotent via IF NOT EXISTS.

ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS is_test TINYINT(1) NOT NULL DEFAULT 0 AFTER activity_id,
  ADD COLUMN IF NOT EXISTS total_groups INT NULL AFTER is_test,
  ADD COLUMN IF NOT EXISTS completed_groups INT NOT NULL DEFAULT 0 AFTER total_groups,
  ADD COLUMN IF NOT EXISTS progress_status ENUM('not_started','in_progress','completed')
    NOT NULL DEFAULT 'not_started'
    AFTER completed_groups,
  ADD COLUMN IF NOT EXISTS points_earned INT NULL AFTER progress_status,
  ADD COLUMN IF NOT EXISTS points_possible INT NULL AFTER points_earned;

-- Helpful indexes for progress/test queries (also idempotent in MariaDB 10.11+)
ALTER TABLE activity_instances
  ADD INDEX IF NOT EXISTS idx_ai_course_activity_test (course_id, activity_id, is_test),
  ADD INDEX IF NOT EXISTS idx_ai_progress_status (progress_status);
SQL

echo "Migration completed successfully."

