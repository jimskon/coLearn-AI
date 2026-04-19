#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/db.sh"

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

echo "Running migration 007_2026-02-17_normalize_is_test..."
echo "------------------------------------------------------"

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<'EOF'

-- 0) Confirm column exists before doing any work (idempotent)
SET @col_exists := (
  SELECT COUNT(1)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'activity_instances'
    AND COLUMN_NAME = 'is_test'
);

-- If no is_test column, we are already migrated; still ensure index exists.
SELECT IF(@col_exists > 0,
  'activity_instances.is_test exists: proceeding with normalization',
  'activity_instances.is_test not present: skipping drop/backfill, ensuring indexes'
) AS status;

-- 1) Backfill instance.is_test from pogil_activities.is_test (only if column exists)
SET @sql_backfill := IF(@col_exists > 0,
  'UPDATE activity_instances ai
   JOIN pogil_activities pa ON pa.id = ai.activity_id
   SET ai.is_test = pa.is_test
   WHERE ai.is_test <> pa.is_test',
  'SELECT "skip backfill (no is_test column)"'
);
PREPARE stmt_bf FROM @sql_backfill; EXECUTE stmt_bf; DEALLOCATE PREPARE stmt_bf;

-- 2) Create replacement index FIRST (needed for FK on course_id and common queries)
SET @idx_ca_exists := (
  SELECT COUNT(1)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'activity_instances'
    AND INDEX_NAME = 'idx_ai_course_activity'
);

SET @sql_create_ca := IF(@idx_ca_exists = 0,
  'CREATE INDEX idx_ai_course_activity ON activity_instances(course_id, activity_id)',
  'SELECT "idx_ai_course_activity already present"'
);
PREPARE stmt_ci FROM @sql_create_ca; EXECUTE stmt_ci; DEALLOCATE PREPARE stmt_ci;

-- 3) Drop old index that includes is_test (only if it exists)
SET @idx_old_exists := (
  SELECT COUNT(1)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'activity_instances'
    AND INDEX_NAME = 'idx_ai_course_activity_test'
);

SET @sql_drop_old := IF(@idx_old_exists > 0,
  'ALTER TABLE activity_instances DROP INDEX idx_ai_course_activity_test',
  'SELECT "idx_ai_course_activity_test not present"'
);
PREPARE stmt_do FROM @sql_drop_old; EXECUTE stmt_do; DEALLOCATE PREPARE stmt_do;

-- 4) Drop column is_test (only if it exists)
SET @sql_drop_col := IF(@col_exists > 0,
  'ALTER TABLE activity_instances DROP COLUMN is_test',
  'SELECT "activity_instances.is_test already dropped"'
);
PREPARE stmt_dc FROM @sql_drop_col; EXECUTE stmt_dc; DEALLOCATE PREPARE stmt_dc;

EOF

echo "✅ Migration complete: normalized is_test (canonical in pogil_activities)"
