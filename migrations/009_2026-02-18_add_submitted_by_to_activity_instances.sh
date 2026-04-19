#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/db.sh"

# migrations/009_2026-02-18_add_submitted_by_to_activity_instances.sh
# Add submitted_by_user_id to activity_instances
# This stores the student who submitted a test instance.

set -e

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

echo "Running migration 009_add_submitted_by_to_activity_instances..."
echo "----------------------------------------------------------------"

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<'EOF'

ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS submitted_by_user_id INT NULL
  COMMENT 'User who submitted this test instance';

-- Add index for lookup
ALTER TABLE activity_instances
  ADD INDEX IF NOT EXISTS idx_ai_submitted_by_user (submitted_by_user_id);

-- Add foreign key (guarded manually; MySQL has no IF NOT EXISTS for FKs)
SET @fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'activity_instances'
    AND CONSTRAINT_NAME = 'fk_ai_submitted_by_user'
);

SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE activity_instances
     ADD CONSTRAINT fk_ai_submitted_by_user
     FOREIGN KEY (submitted_by_user_id)
     REFERENCES users(id)
     ON DELETE SET NULL',
  'SELECT "fk already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

EOF

echo "✅ Migration complete: activity_instances.submitted_by_user_id added"
