#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Adding test_access_code to activity_instances..."

db_exec <<'SQL'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS test_access_code VARCHAR(6) DEFAULT NULL
  COMMENT '6-char code students must enter to start a test; NULL means no code required';
SQL

echo "Migration completed successfully."
