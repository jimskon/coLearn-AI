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

echo "Running migration 008_2026-02-17_make_pogil_activities_is_test_nullable..."
echo "------------------------------------------------------"

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<'EOF'

-- Idempotent guard: only modify if column exists and is currently NOT NULL
SET @col_exists := (
  SELECT COUNT(1)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pogil_activities'
    AND COLUMN_NAME = 'is_test'
);

SET @is_nullable := (
  SELECT CASE WHEN IS_NULLABLE = 'YES' THEN 1 ELSE 0 END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pogil_activities'
    AND COLUMN_NAME = 'is_test'
);

SELECT IF(@col_exists = 0,
  'pogil_activities.is_test not found (skipping)',
  IF(@is_nullable = 1,
     'pogil_activities.is_test already nullable (no-op)',
     'pogil_activities.is_test is NOT NULL -> making it nullable'
  )
) AS status;

SET @sql := IF(@col_exists = 1 AND @is_nullable = 0,
  'ALTER TABLE pogil_activities MODIFY COLUMN is_test TINYINT(1) NULL DEFAULT NULL',
  'SELECT "No schema change needed"'
);

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

EOF

echo "✅ Migration complete: pogil_activities.is_test now supports NULL (unknown/unparsed)"
