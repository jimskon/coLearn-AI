#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/db.sh"

# migrations/006_add_hidden_to_activity_instances.sh
# Add hidden flag to activity_instances to allow hiding activities from students

set -e

ENV_FILE="$(dirname "$0")/../server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ERROR: server/.env not found"
  exit 1
fi

# Load DB credentials
export $(grep -v '^#' "$ENV_FILE" | xargs)

if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_NAME" ]; then
  echo "❌ ERROR: Missing DB credentials in server/.env"
  exit 1
fi

echo "Running migration 006_add_hidden_to_activity_instances..."
echo "------------------------------------------------------"

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<'EOF'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS hidden TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'If 1, students cannot Start or Review this activity instance';
EOF

echo "✅ Migration complete: activity_instances.hidden added"
