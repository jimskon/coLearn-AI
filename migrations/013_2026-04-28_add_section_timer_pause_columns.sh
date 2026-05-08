#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/db.sh"

db_exec <<'SQL'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS section_timer_paused TINYINT(1) NOT NULL DEFAULT 0 AFTER section_timer_started_at,
  ADD COLUMN IF NOT EXISTS section_timer_paused_at DATETIME NULL AFTER section_timer_paused;
SQL
