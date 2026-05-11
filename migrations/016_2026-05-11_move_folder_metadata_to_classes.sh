#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-pogil}"
MYSQL=(mysql "-u${DB_USER:-root}" "-p${DB_PASSWORD:-}" "$DB_NAME")

"${MYSQL[@]}" <<'SQL'
ALTER TABLE pogil_classes
  ADD COLUMN IF NOT EXISTS google_folder_url TEXT NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS google_folder_id VARCHAR(255) NULL AFTER google_folder_url,
  ADD COLUMN IF NOT EXISTS google_folder_name VARCHAR(255) NULL AFTER google_folder_id,
  ADD COLUMN IF NOT EXISTS google_folder_verified_at DATETIME NULL AFTER google_folder_name,
  ADD COLUMN IF NOT EXISTS google_folder_status VARCHAR(32) NULL AFTER google_folder_verified_at;
SQL
