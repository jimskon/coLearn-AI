#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Adding activity_instances.ended_at (Ended - incomplete)..."

# A group activity run whose students have all been away for 15 minutes before
# finishing is ended: students can still review it and try code locally, but
# can no longer answer, submit, or use AI help. An instructor can reopen it
# (ended_at back to NULL). Set by server/research/autoEnd.js.
db_exec <<'SQL'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS ended_at DATETIME NULL DEFAULT NULL
    COMMENT 'Ended - incomplete: all students away 15+ min before finishing (NULL = open)';
SQL

echo "Migration completed successfully."
