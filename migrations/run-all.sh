#!/usr/bin/env bash
set -euo pipefail

echo "Running all migrations..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load server/.env once for the whole run (so scripts can rely on it)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/db.sh" >/dev/null

for script in $(ls -1 [0-9][0-9][0-9]_*.sh | sort); do
  echo "----------------------------------------"
  echo "Running: $script"
  bash "./$script"
done

echo "----------------------------------------"
echo "All migrations completed successfully."
