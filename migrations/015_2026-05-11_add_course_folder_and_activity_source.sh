#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/db.sh"

db_exec <<'SQL'
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS google_folder_url TEXT NULL AFTER class_id,
  ADD COLUMN IF NOT EXISTS google_folder_id VARCHAR(255) NULL AFTER google_folder_url,
  ADD COLUMN IF NOT EXISTS google_folder_name VARCHAR(255) NULL AFTER google_folder_id,
  ADD COLUMN IF NOT EXISTS google_folder_verified_at DATETIME NULL AFTER google_folder_name,
  ADD COLUMN IF NOT EXISTS google_folder_status VARCHAR(32) NULL AFTER google_folder_verified_at;

ALTER TABLE pogil_activities
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(16) NOT NULL DEFAULT 'external' AFTER is_test;
SQL
