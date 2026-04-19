#!/bin/bash
# scripts/export_schema.sh
# Export the current DB schema to server/schema.sql using credentials in server/.env

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/server/.env"
OUTPUT_FILE="$ROOT_DIR/server/schema.sql"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ERROR: $ENV_FILE not found"
  exit 1
fi

# Load DB_* variables from .env
# Assumes lines like: DB_HOST=..., DB_USER=..., etc.
export $(grep -v '^#' "$ENV_FILE" | grep -E '^(DB_HOST|DB_USER|DB_PASSWORD|DB_NAME)=' | xargs)

if [ -z "${DB_HOST:-}" ] || [ -z "${DB_USER:-}" ] || [ -z "${DB_PASSWORD:-}" ] || [ -z "${DB_NAME:-}" ]; then
  echo "❌ ERROR: Missing DB_HOST/DB_USER/DB_PASSWORD/DB_NAME in $ENV_FILE"
  exit 1
fi

echo "📦 Exporting schema for database '$DB_NAME' from $DB_HOST ..."
echo "➡ Output: $OUTPUT_FILE"

# Use mysqldump to get schema only, no data, minimal noise
# --no-data        : schema only
# --skip-comments  : drop dump header comments
# --compact        : reduces extra whitespace/comments
# We also strip DEFINER clauses so the file is portable.
mysqldump \
  -h "$DB_HOST" \
  -u "$DB_USER" \
  -p"$DB_PASSWORD" \
  --no-data \
  --skip-comments \
  --compact \
  "$DB_NAME" \
  | sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g' \
  > "$OUTPUT_FILE"

echo "✅ Schema export complete."
echo "   You can inspect it at: $OUTPUT_FILE"
