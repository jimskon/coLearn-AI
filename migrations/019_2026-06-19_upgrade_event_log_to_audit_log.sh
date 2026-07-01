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

drop_fk_for_column "user_id"
drop_fk_for_column "class_id"
drop_fk_for_column "course_id"
drop_fk_for_column "activity_id"
drop_fk_for_column "activity_instance_id"

db_exec <<'SQL'
ALTER TABLE `audit_log`
  ADD COLUMN IF NOT EXISTS `guest_token` VARCHAR(191) DEFAULT NULL AFTER `user_id`,
  ADD COLUMN IF NOT EXISTS `role` VARCHAR(32) DEFAULT NULL AFTER `guest_token`,
  ADD COLUMN IF NOT EXISTS `class_id` INT(11) DEFAULT NULL AFTER `role`,
  ADD COLUMN IF NOT EXISTS `course_id` INT(11) DEFAULT NULL AFTER `class_id`,
  ADD COLUMN IF NOT EXISTS `activity_id` INT(11) DEFAULT NULL AFTER `course_id`,
  ADD COLUMN IF NOT EXISTS `request_path` VARCHAR(255) DEFAULT NULL AFTER `activity_instance_id`,
  ADD COLUMN IF NOT EXISTS `ip_address` VARCHAR(64) DEFAULT NULL AFTER `request_path`,
  ADD COLUMN IF NOT EXISTS `ip_country` VARCHAR(64) DEFAULT NULL AFTER `ip_address`,
  ADD COLUMN IF NOT EXISTS `ip_region` VARCHAR(191) DEFAULT NULL AFTER `ip_country`,
  ADD COLUMN IF NOT EXISTS `ip_city` VARCHAR(191) DEFAULT NULL AFTER `ip_region`,
  ADD COLUMN IF NOT EXISTS `user_agent` TEXT DEFAULT NULL AFTER `ip_city`,
  ADD INDEX IF NOT EXISTS `idx_audit_log_event_created_at` (`event_type`, `created_at`),
  ADD INDEX IF NOT EXISTS `idx_audit_log_user_created_at` (`user_id`, `created_at`),
  ADD INDEX IF NOT EXISTS `idx_audit_log_guest_created_at` (`guest_token`, `created_at`),
  ADD INDEX IF NOT EXISTS `idx_audit_log_class_created_at` (`class_id`, `created_at`),
  ADD INDEX IF NOT EXISTS `idx_audit_log_course_created_at` (`course_id`, `created_at`),
  ADD INDEX IF NOT EXISTS `idx_audit_log_activity_created_at` (`activity_id`, `created_at`),
  ADD INDEX IF NOT EXISTS `idx_audit_log_instance_created_at` (`activity_instance_id`, `created_at`),
  ADD CONSTRAINT `audit_log_user_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `audit_log_class_fk`
    FOREIGN KEY (`class_id`) REFERENCES `pogil_classes` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `audit_log_course_fk`
    FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `audit_log_activity_fk`
    FOREIGN KEY (`activity_id`) REFERENCES `pogil_activities` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `audit_log_instance_fk`
    FOREIGN KEY (`activity_instance_id`) REFERENCES `activity_instances` (`id`) ON DELETE SET NULL;
SQL

echo "Migration completed successfully."
