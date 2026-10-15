#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Creating group_activity_slices (research activity timeline)..."

# One row per student per 10-second slice in which they did something. Each
# kind column is 1 if that activity happened in the slice. Never content.
# Idle time writes nothing.
db_exec <<'SQL'
CREATE TABLE IF NOT EXISTS group_activity_slices (
  activity_instance_id INT NOT NULL,
  slice_start DATETIME NOT NULL COMMENT '10-second bucket, UTC',
  user_id INT NOT NULL,
  edits    TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'active student edit saves',
  runs     TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'code runs',
  submits  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'group submits',
  sandbox  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Local Sandbox signals (no content)',
  ai_waits TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'AI evaluation in progress',
  PRIMARY KEY (activity_instance_id, slice_start, user_id),
  CONSTRAINT fk_slices_instance FOREIGN KEY (activity_instance_id)
    REFERENCES activity_instances(id) ON DELETE CASCADE,
  CONSTRAINT fk_slices_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL

echo "Migration completed successfully."
