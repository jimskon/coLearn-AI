#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/db.sh"

db_exec <<'SQL'
ALTER TABLE pogil_activities
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(16) NOT NULL DEFAULT 'remote' AFTER sheet_url,
  ADD COLUMN IF NOT EXISTS content_text LONGTEXT NULL AFTER source_type;
SQL
