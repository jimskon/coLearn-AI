#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Creating instructor_observations (research classroom observations)..."

# One row per observation tag an instructor gives a group in the Observation
# view of View Groups. `context` (JSON) records what the system knew at that
# moment. An undo deletes the row (a mis-tap is not data).
db_exec <<'SQL'
CREATE TABLE IF NOT EXISTS instructor_observations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_instance_id INT NOT NULL,
  observer_id INT NULL,
  label ENUM('talk','code','watch','quiet','help','frustrated','off_task','uncertain') NOT NULL,
  observed_at DATETIME(3) NOT NULL,
  context TEXT NULL COMMENT 'JSON: question group, has code, active student, seconds since last activity, AI wait in progress, last AI decision',
  KEY idx_obs_instance_time (activity_instance_id, observed_at),
  CONSTRAINT fk_obs_instance FOREIGN KEY (activity_instance_id)
    REFERENCES activity_instances(id) ON DELETE CASCADE,
  CONSTRAINT fk_obs_observer FOREIGN KEY (observer_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL

echo "Migration completed successfully."
