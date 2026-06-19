#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Upgrading event_log to audit_log..."

db_exec <<'SQL'
RENAME TABLE `event_log` TO `audit_log`;

ALTER TABLE `audit_log`
  DROP FOREIGN KEY `event_log_ibfk_1`,
  DROP FOREIGN KEY `event_log_ibfk_2`,
  ADD COLUMN `guest_token` VARCHAR(191) DEFAULT NULL AFTER `user_id`,
  ADD COLUMN `role` VARCHAR(32) DEFAULT NULL AFTER `guest_token`,
  ADD COLUMN `class_id` INT(11) DEFAULT NULL AFTER `role`,
  ADD COLUMN `course_id` INT(11) DEFAULT NULL AFTER `class_id`,
  ADD COLUMN `activity_id` INT(11) DEFAULT NULL AFTER `course_id`,
  ADD COLUMN `request_path` VARCHAR(255) DEFAULT NULL AFTER `activity_instance_id`,
  ADD COLUMN `ip_address` VARCHAR(64) DEFAULT NULL AFTER `request_path`,
  ADD COLUMN `ip_country` VARCHAR(64) DEFAULT NULL AFTER `ip_address`,
  ADD COLUMN `ip_region` VARCHAR(191) DEFAULT NULL AFTER `ip_country`,
  ADD COLUMN `ip_city` VARCHAR(191) DEFAULT NULL AFTER `ip_region`,
  ADD COLUMN `user_agent` TEXT DEFAULT NULL AFTER `ip_city`,
  ADD INDEX `idx_audit_log_event_created_at` (`event_type`, `created_at`),
  ADD INDEX `idx_audit_log_user_created_at` (`user_id`, `created_at`),
  ADD INDEX `idx_audit_log_guest_created_at` (`guest_token`, `created_at`),
  ADD INDEX `idx_audit_log_class_created_at` (`class_id`, `created_at`),
  ADD INDEX `idx_audit_log_course_created_at` (`course_id`, `created_at`),
  ADD INDEX `idx_audit_log_activity_created_at` (`activity_id`, `created_at`),
  ADD INDEX `idx_audit_log_instance_created_at` (`activity_instance_id`, `created_at`),
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
