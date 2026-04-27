#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/db.sh"

db_exec <<'SQL'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS section_timer_key VARCHAR(64) NULL AFTER progress_status,
  ADD COLUMN IF NOT EXISTS section_timer_duration_minutes INT NULL AFTER section_timer_key,
  ADD COLUMN IF NOT EXISTS section_timer_started_at DATETIME NULL AFTER section_timer_duration_minutes;
SQL
