#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Adding demo_mode to pogil_classes..."

db_exec <<'SQL'
ALTER TABLE pogil_classes
  ADD COLUMN IF NOT EXISTS demo_mode TINYINT(1) NOT NULL DEFAULT 0;
SQL

echo "Migration completed successfully."
