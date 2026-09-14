#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

# Sandbox instances used to take the next free group number. Hiding them from
# the roster stopped them being *seen* as groups, but they were still counted
# as groups by three things:
#
#   - the setup gate refuses to create groups when number 1 already exists, so
#     a sandbox sitting on 1 blocked group setup for the whole activity and
#     reported "Groups already exist" for an activity with none
#   - new groups are numbered MAX+1, so the first real group on a
#     much-previewed activity came out as Group 13
#   - smart-add looks for a group with space, and an empty sandbox looks
#     roomier than any of them
#
# New sandboxes are created with group_number 0 -- the existing convention for
# "not a group". This moves the ones already in the database.

echo "Moving sandbox instances off real group numbers..."

db_exec <<'SQL'
UPDATE activity_instances
   SET group_number = 0
 WHERE active_rotation_mode = 'sandbox'
   AND COALESCE(group_number, 0) <> 0;
SQL

echo "Migration completed successfully."
