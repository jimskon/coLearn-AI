#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

# A Test Run opens one sandbox instance per author and is supposed to reuse it.
# It found the existing one by active_student_id, which is not an identity: the
# rotation clears it to NULL when the author leaves. Every Test Run after that
# missed and inserted another row, so a single activity collected dozens of
# empty sandbox instances that showed on the roster as groups with no members.
#
# sandbox_owner_id records who the sandbox belongs to and is never rewritten by
# the rotation, so the lookup can be stable.

echo "Adding sandbox_owner_id to activity_instances..."

db_exec <<'SQL'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS sandbox_owner_id INT(11) DEFAULT NULL;

ALTER TABLE activity_instances
  ADD INDEX IF NOT EXISTS idx_ai_sandbox_owner (activity_id, course_id, sandbox_owner_id);

-- Adopt the sandboxes that still know who opened them, so an author who has
-- one open keeps it instead of silently getting a new one after this deploys.
UPDATE activity_instances
   SET sandbox_owner_id = active_student_id
 WHERE active_rotation_mode = 'sandbox'
   AND sandbox_owner_id IS NULL
   AND active_student_id IS NOT NULL;
SQL

echo "Migration completed successfully."
