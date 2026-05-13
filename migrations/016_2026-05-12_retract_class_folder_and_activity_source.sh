#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/db.sh"

db_exec <<'SQL'
ALTER TABLE pogil_classes
  DROP COLUMN IF EXISTS google_folder_status,
  DROP COLUMN IF EXISTS google_folder_verified_at,
  DROP COLUMN IF EXISTS google_folder_name,
  DROP COLUMN IF EXISTS google_folder_id,
  DROP COLUMN IF EXISTS google_folder_url;

ALTER TABLE pogil_activities
  DROP COLUMN IF EXISTS source_type;
SQL
