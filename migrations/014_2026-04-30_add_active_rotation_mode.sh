#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/db.sh"

db_exec <<'SQL'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS active_rotation_mode VARCHAR(16) NOT NULL DEFAULT 'submit' AFTER progress_status;
SQL
