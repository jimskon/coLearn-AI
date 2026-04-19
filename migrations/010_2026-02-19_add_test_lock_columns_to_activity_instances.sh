#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/db.sh"

# migrations/010_2026-02-19_add_test_lock_columns_to_activity_instances.sh
# Add locked_before_start and locked_after_end to activity_instances
# Used to lock timed tests before the window opens / after it closes.

ENV_FILE="$(dirname "$0")/../server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ERROR: server/.env not found"
  exit 1
fi

# Load DB credentials
export $(grep -v '^#' "$ENV_FILE" | xargs)

if [ -z "${DB_HOST:-}" ] || [ -z "${DB_USER:-}" ] || [ -z "${DB_PASSWORD:-}" ] || [ -z "${DB_NAME:-}" ]; then
  echo "❌ ERROR: Missing DB credentials in server/.env"
  exit 1
fi

echo "Running migration 010_add_test_lock_columns_to_activity_instances..."
echo "-------------------------------------------------------------------"

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<'EOF'

ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS locked_before_start TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'If 1, students cannot open the test before test_start_at',
  ADD COLUMN IF NOT EXISTS locked_after_end TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'If 1, students cannot open the test after the window closes (end or reopen_until)';

EOF

echo "✅ Migration complete: activity_instances.locked_before_start / locked_after_end added"
