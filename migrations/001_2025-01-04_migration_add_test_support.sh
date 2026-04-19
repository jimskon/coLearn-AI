#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/db.sh"


echo "=== coLearn-AI: Add test-related fields ==="


db_exec <<'SQL'
SET NAMES utf8mb4;

-- ============================================================
-- 1) Mark activities that are tests (\test)
-- ============================================================
ALTER TABLE pogil_activities
  ADD COLUMN IF NOT EXISTS is_test TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 if this activity contains a \\test tag';

-- ============================================================
-- 2) Timed-test metadata on activity_instances
-- ============================================================
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS test_start_at DATETIME NULL
    COMMENT 'Scheduled start time for timed tests',
  ADD COLUMN IF NOT EXISTS test_duration_minutes INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Time limit in minutes (0 = no limit)',
  ADD COLUMN IF NOT EXISTS test_reopen_until DATETIME NULL
    COMMENT 'Optional reopen-until time for this instance',
  ADD COLUMN IF NOT EXISTS submitted_at DATETIME NULL
    COMMENT 'When the instance was finally submitted';

-- Helpful index for querying by start time
CREATE INDEX IF NOT EXISTS idx_activity_instances_test_start
  ON activity_instances (test_start_at);
SQL

MIG_STATUS=$?

if [ "$MIG_STATUS" -eq 0 ]; then
  echo "✅ Migration completed successfully."
else
  echo "❌ Migration failed with status $MIG_STATUS."
fi
