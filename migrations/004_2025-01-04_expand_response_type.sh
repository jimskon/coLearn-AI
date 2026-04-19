#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/db.sh"

# migrations/005_expand_response_type.sh
# Expand responses.response_type to support code + run_output.

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

echo "Running migration 005_expand_response_type..."
echo "--------------"

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<'EOF'
ALTER TABLE responses
  MODIFY COLUMN response_type ENUM(
    'text',
    'code',
    'python',
    'cpp',
    'run_output'
  ) NOT NULL DEFAULT 'text';
EOF

echo "✅ Migration complete: responses.response_type now allows 'code' and 'run_output'"
