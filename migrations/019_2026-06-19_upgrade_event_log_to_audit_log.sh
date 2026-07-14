#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Upgrading event_log to audit_log..."

db_query() {
  MYSQL_PWD="$DB_PASSWORD" \
  "$DB_CLI" \
    --protocol=tcp \
    --batch \
    --skip-column-names \
    -h "$DB_HOST" \
    -P "$DB_PORT" \
    -u "$DB_USER" \
    "$DB_NAME" \
    -e "$1"
}

table_exists() {
  local table_name="$1"
  local count
  count="$(db_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '$table_name';" | tr -d '[:space:]')"
  [[ "${count:-0}" != "0" ]]
}

column_exists() {
  local table_name="$1"
  local column_name="$2"
  local count
  count="$(db_query "
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = '$table_name'
      AND column_name = '$column_name';
  " | tr -d '[:space:]')"
  [[ "${count:-0}" != "0" ]]
}

index_exists() {
  local table_name="$1"
  local index_name="$2"
  local count
  count="$(db_query "
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = '$table_name'
      AND index_name = '$index_name';
  " | tr -d '[:space:]')"
  [[ "${count:-0}" != "0" ]]
}

fk_exists() {
  local table_name="$1"
  local constraint_name="$2"
  local count
  count="$(db_query "
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = '$table_name'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = '$constraint_name';
  " | tr -d '[:space:]')"
  [[ "${count:-0}" != "0" ]]
}

drop_fk_for_column() {
  local column_name="$1"
  local fk_names
  fk_names="$(db_query "
    SELECT constraint_name
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE table_schema = DATABASE()
      AND table_name = 'audit_log'
      AND column_name = '$column_name'
      AND referenced_table_name IS NOT NULL;
  " || true)"

  if [[ -z "${fk_names//[[:space:]]/}" ]]; then
    return 0
  fi

  while IFS= read -r fk_name; do
    [[ -z "$fk_name" ]] && continue
    db_exec <<SQL
ALTER TABLE \`audit_log\` DROP FOREIGN KEY \`$fk_name\`;
SQL
  done <<< "$fk_names"
}

if table_exists "event_log" && ! table_exists "audit_log"; then
  db_exec <<'SQL'
RENAME TABLE `event_log` TO `audit_log`;
SQL
fi

if ! table_exists "audit_log"; then
  echo "ERROR: neither event_log nor audit_log exists." >&2
  exit 1
fi

if ! column_exists "audit_log" "guest_token"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `guest_token` VARCHAR(191) DEFAULT NULL AFTER `user_id`;
SQL
fi

if ! column_exists "audit_log" "role"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `role` VARCHAR(32) DEFAULT NULL AFTER `guest_token`;
SQL
fi

if ! column_exists "audit_log" "class_id"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `class_id` INT(11) DEFAULT NULL AFTER `role`;
SQL
fi

if ! column_exists "audit_log" "course_id"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `course_id` INT(11) DEFAULT NULL AFTER `class_id`;
SQL
fi

if ! column_exists "audit_log" "activity_id"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `activity_id` INT(11) DEFAULT NULL AFTER `course_id`;
SQL
fi

if ! column_exists "audit_log" "request_path"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `request_path` VARCHAR(255) DEFAULT NULL AFTER `activity_instance_id`;
SQL
fi

if ! column_exists "audit_log" "ip_address"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `ip_address` VARCHAR(64) DEFAULT NULL AFTER `request_path`;
SQL
fi

if ! column_exists "audit_log" "ip_country"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `ip_country` VARCHAR(64) DEFAULT NULL AFTER `ip_address`;
SQL
fi

if ! column_exists "audit_log" "ip_region"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `ip_region` VARCHAR(191) DEFAULT NULL AFTER `ip_country`;
SQL
fi

if ! column_exists "audit_log" "ip_city"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `ip_city` VARCHAR(191) DEFAULT NULL AFTER `ip_region`;
SQL
fi

if ! column_exists "audit_log" "user_agent"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN `user_agent` TEXT DEFAULT NULL AFTER `ip_city`;
SQL
fi

if ! index_exists "audit_log" "idx_audit_log_event_created_at"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD INDEX `idx_audit_log_event_created_at` (`event_type`, `created_at`);
SQL
fi

if ! index_exists "audit_log" "idx_audit_log_user_created_at"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD INDEX `idx_audit_log_user_created_at` (`user_id`, `created_at`);
SQL
fi

if ! index_exists "audit_log" "idx_audit_log_guest_created_at"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD INDEX `idx_audit_log_guest_created_at` (`guest_token`, `created_at`);
SQL
fi

if ! index_exists "audit_log" "idx_audit_log_class_created_at"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD INDEX `idx_audit_log_class_created_at` (`class_id`, `created_at`);
SQL
fi

if ! index_exists "audit_log" "idx_audit_log_course_created_at"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD INDEX `idx_audit_log_course_created_at` (`course_id`, `created_at`);
SQL
fi

if ! index_exists "audit_log" "idx_audit_log_activity_created_at"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD INDEX `idx_audit_log_activity_created_at` (`activity_id`, `created_at`);
SQL
fi

if ! index_exists "audit_log" "idx_audit_log_instance_created_at"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD INDEX `idx_audit_log_instance_created_at` (`activity_instance_id`, `created_at`);
SQL
fi

if ! fk_exists "audit_log" "audit_log_user_fk"; then
  drop_fk_for_column "user_id"
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD CONSTRAINT `audit_log_user_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;
SQL
fi

if ! fk_exists "audit_log" "audit_log_class_fk"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD CONSTRAINT `audit_log_class_fk`
    FOREIGN KEY (`class_id`) REFERENCES `pogil_classes` (`id`) ON DELETE SET NULL;
SQL
fi

if ! fk_exists "audit_log" "audit_log_course_fk"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD CONSTRAINT `audit_log_course_fk`
    FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL;
SQL
fi

if ! fk_exists "audit_log" "audit_log_activity_fk"; then
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD CONSTRAINT `audit_log_activity_fk`
    FOREIGN KEY (`activity_id`) REFERENCES `pogil_activities` (`id`) ON DELETE SET NULL;
SQL
fi

if ! fk_exists "audit_log" "audit_log_instance_fk"; then
  drop_fk_for_column "activity_instance_id"
  db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD CONSTRAINT `audit_log_instance_fk`
    FOREIGN KEY (`activity_instance_id`) REFERENCES `activity_instances` (`id`) ON DELETE SET NULL;
SQL
fi

echo "Migration completed successfully."
