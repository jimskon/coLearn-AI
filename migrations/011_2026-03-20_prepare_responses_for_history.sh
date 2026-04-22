#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

# Enable append-only response history and add draft storage.
# Do not rewrite this migration once it has been applied to production.

cd "$(dirname "$0")/.."

ENV_FILE="server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Could not find $ENV_FILE"
  exit 1
fi

export $(grep -E '^(DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME)=' "$ENV_FILE" | xargs)

: "${DB_HOST:?DB_HOST not set in server/.env}"
: "${DB_USER:?DB_USER not set in server/.env}"
: "${DB_PASSWORD:?DB_PASSWORD not set in server/.env}"
: "${DB_NAME:?DB_NAME not set in server/.env}"
DB_PORT="${DB_PORT:-3306}"

echo "Running migration on ${DB_NAME} at ${DB_HOST}:${DB_PORT} ..."

MYSQL_CMD=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "-p${DB_PASSWORD}" "$DB_NAME")

"${MYSQL_CMD[@]}" <<'SQL'
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS submit_id CHAR(36) NULL AFTER question_id;

SET @db := DATABASE();

SET @drop_idx := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = @db
        AND table_name = 'responses'
        AND index_name = 'unique_response'
    ),
    'ALTER TABLE responses DROP INDEX unique_response',
    'SELECT ''responses.unique_response not present; skipping'' AS msg'
  )
);
PREPARE stmt FROM @drop_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_idx := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = @db
        AND table_name = 'responses'
        AND index_name = 'uq_responses_instance_question'
    ),
    'ALTER TABLE responses DROP INDEX uq_responses_instance_question',
    'SELECT ''responses.uq_responses_instance_question not present; skipping'' AS msg'
  )
);
PREPARE stmt FROM @drop_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_idx := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = @db
        AND table_name = 'responses'
        AND index_name = 'uniq_resp'
    ),
    'ALTER TABLE responses DROP INDEX uniq_resp',
    'SELECT ''responses.uniq_resp not present; skipping'' AS msg'
  )
);
PREPARE stmt FROM @drop_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE responses
  ADD INDEX IF NOT EXISTS idx_responses_ai_submit_id (activity_instance_id, submit_id, id),
  ADD INDEX IF NOT EXISTS idx_responses_ai_qid_id (activity_instance_id, question_id, id),
  ADD INDEX IF NOT EXISTS idx_responses_submit_id (submit_id),
  ADD INDEX IF NOT EXISTS idx_responses_ai_id (activity_instance_id, id);

CREATE TABLE IF NOT EXISTS response_drafts (
  id INT(11) NOT NULL AUTO_INCREMENT,
  activity_instance_id INT(11) NOT NULL,
  question_id VARCHAR(64) NOT NULL,
  response_type ENUM('text','code','python','cpp','run_output') NOT NULL DEFAULT 'text',
  response MEDIUMTEXT DEFAULT NULL,
  answered_by_user_id INT(11) NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_draft (activity_instance_id, question_id),
  KEY idx_draft_instance (activity_instance_id),
  KEY idx_draft_answered_by (answered_by_user_id),
  CONSTRAINT fk_response_drafts_ai
    FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
  CONSTRAINT fk_response_drafts_user
    FOREIGN KEY (answered_by_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL

echo "Migration completed successfully."
