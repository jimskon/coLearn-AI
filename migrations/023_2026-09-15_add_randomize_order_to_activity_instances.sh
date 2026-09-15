#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Adding randomize_order to activity_instances..."

db_exec <<'SQL'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS randomize_order TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'If 1, MC answer choices are shuffled per student at render time';
SQL

echo "Migration completed successfully."
