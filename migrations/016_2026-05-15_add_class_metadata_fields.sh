#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Adding class metadata fields to pogil_classes..."

mysql_exec "
ALTER TABLE pogil_classes
  ADD COLUMN IF NOT EXISTS level VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS topic_domain VARCHAR(255) DEFAULT NULL;
"

echo "Migration completed successfully."
