#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Adding ai_guidance to pogil_classes..."

db_exec <<'SQL'
ALTER TABLE pogil_classes
  ADD COLUMN IF NOT EXISTS ai_guidance TEXT DEFAULT NULL;
SQL

echo "Migration completed successfully."
