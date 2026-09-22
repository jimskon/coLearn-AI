/*M!999999\- enable the sandbox mode */ 
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_edit_locks` (
  `activity_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `lease_token` char(36) NOT NULL,
  `acquired_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  PRIMARY KEY (`activity_id`),
  KEY `activity_edit_locks_expires_at_idx` (`expires_at`),
  CONSTRAINT `activity_edit_locks_activity_fk` FOREIGN KEY (`activity_id`) REFERENCES `pogil_activities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_heartbeats` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `activity_instance_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_heartbeat` (`activity_instance_id`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `activity_heartbeats_ibfk_1` FOREIGN KEY (`activity_instance_id`) REFERENCES `activity_instances` (`id`) ON DELETE CASCADE,
  CONSTRAINT `activity_heartbeats_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_instances` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `activity_id` int(11) NOT NULL,
  `course_id` int(11) NOT NULL,
  `status` enum('in_progress','completed') DEFAULT 'in_progress',
  `active_student_id` int(11) DEFAULT NULL,
  `group_number` int(11) DEFAULT NULL,
  `start_time` timestamp NULL DEFAULT current_timestamp(),
  `total_groups` int(11) DEFAULT NULL,
  `completed_groups` int(11) NOT NULL DEFAULT 0,
  `progress_status` enum('not_started','in_progress','completed') NOT NULL DEFAULT 'not_started',
  `active_rotation_mode` varchar(16) NOT NULL DEFAULT 'submit',
  `section_timer_key` varchar(64) DEFAULT NULL,
  `section_timer_duration_minutes` int(11) DEFAULT NULL,
  `section_timer_started_at` datetime DEFAULT NULL,
  `section_timer_paused` tinyint(1) NOT NULL DEFAULT 0,
  `section_timer_paused_at` datetime DEFAULT NULL,
  `points_earned` int(11) DEFAULT NULL,
  `points_possible` int(11) DEFAULT NULL,
  `test_start_at` datetime DEFAULT NULL COMMENT 'Scheduled start time for timed tests',
  `test_duration_minutes` int(10) unsigned NOT NULL DEFAULT 0 COMMENT 'Time limit in minutes (0 = no limit)',
  `test_reopen_until` datetime DEFAULT NULL COMMENT 'Optional reopen-until time for this instance',
  `submitted_at` datetime DEFAULT NULL COMMENT 'When the instance was finally submitted',
  `graded_at` datetime DEFAULT NULL,
  `review_complete` tinyint(1) NOT NULL DEFAULT 0,
  `reviewed_at` datetime DEFAULT NULL,
  `hidden` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'If 1, students cannot Start or Review this activity instance',
  `submitted_by_user_id` int(11) DEFAULT NULL COMMENT 'User who submitted this test instance',
  `locked_before_start` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'If 1, students cannot open the test before test_start_at',
  `locked_after_end` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'If 1, students cannot open the test after the window closes (end or reopen_until)',
  `lock_before_start` tinyint(1) NOT NULL DEFAULT 0,
  `lock_after_end` tinyint(1) NOT NULL DEFAULT 0,
  `test_focus_loss_count` int(11) NOT NULL DEFAULT 0,
  `test_focus_enforcement` tinyint(1) NOT NULL DEFAULT 0,
  `assignment_due_at` datetime DEFAULT NULL,
  `submitted_late` tinyint(1) NOT NULL DEFAULT 0,
  `sandbox_owner_id` int(11) DEFAULT NULL,
  `randomize_order` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'If 1, MC answer choices are shuffled per student at render time',
  PRIMARY KEY (`id`),
  KEY `activity_id` (`activity_id`),
  KEY `active_student_id` (`active_student_id`),
  KEY `idx_activity_instances_test_start` (`test_start_at`),
  KEY `idx_ai_progress_status` (`progress_status`),
  KEY `idx_ai_course_activity` (`course_id`,`activity_id`),
  KEY `idx_ai_submitted_by_user` (`submitted_by_user_id`),
  KEY `idx_ai_sandbox_owner` (`activity_id`,`course_id`,`sandbox_owner_id`),
  CONSTRAINT `activity_instances_ibfk_1` FOREIGN KEY (`activity_id`) REFERENCES `pogil_activities` (`id`),
  CONSTRAINT `activity_instances_ibfk_2` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`),
  CONSTRAINT `activity_instances_ibfk_3` FOREIGN KEY (`active_student_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_ai_submitted_by_user` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5230 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `guest_token` varchar(191) DEFAULT NULL,
  `role` varchar(32) DEFAULT NULL,
  `class_id` int(11) DEFAULT NULL,
  `course_id` int(11) DEFAULT NULL,
  `activity_id` int(11) DEFAULT NULL,
  `activity_instance_id` int(11) DEFAULT NULL,
  `request_path` varchar(255) DEFAULT NULL,
  `ip_address` varchar(64) DEFAULT NULL,
  `ip_country` varchar(64) DEFAULT NULL,
  `ip_region` varchar(191) DEFAULT NULL,
  `ip_city` varchar(191) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `event_type` text NOT NULL,
  `details` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `activity_instance_id` (`activity_instance_id`),
  KEY `idx_audit_log_event_created_at` (`event_type`(191),`created_at`),
  KEY `idx_audit_log_user_created_at` (`user_id`,`created_at`),
  KEY `idx_audit_log_guest_created_at` (`guest_token`,`created_at`),
  KEY `idx_audit_log_class_created_at` (`class_id`,`created_at`),
  KEY `idx_audit_log_course_created_at` (`course_id`,`created_at`),
  KEY `idx_audit_log_activity_created_at` (`activity_id`,`created_at`),
  KEY `idx_audit_log_instance_created_at` (`activity_instance_id`,`created_at`),
  CONSTRAINT `audit_log_activity_fk` FOREIGN KEY (`activity_id`) REFERENCES `pogil_activities` (`id`) ON DELETE SET NULL,
  CONSTRAINT `audit_log_class_fk` FOREIGN KEY (`class_id`) REFERENCES `pogil_classes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `audit_log_course_fk` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `audit_log_instance_fk` FOREIGN KEY (`activity_instance_id`) REFERENCES `activity_instances` (`id`) ON DELETE SET NULL,
  CONSTRAINT `audit_log_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3604 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `code_alias_backup_1622_1626` (
  `id` int(11) NOT NULL DEFAULT 0,
  `activity_instance_id` int(11) NOT NULL,
  `question_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `response_type` enum('text','code','python','cpp','run_output') NOT NULL DEFAULT 'text',
  `response` text NOT NULL,
  `answered_by_user_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_enrollments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `course_id` int(11) NOT NULL,
  `student_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `course_id` (`course_id`,`student_id`),
  KEY `student_id` (`student_id`),
  CONSTRAINT `course_enrollments_ibfk_1` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `course_enrollments_ibfk_2` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1915 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `courses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` text NOT NULL,
  `code` text NOT NULL,
  `section` text NOT NULL,
  `semester` enum('fall','spring','summer') NOT NULL,
  `year` int(11) NOT NULL,
  `instructor_id` int(11) DEFAULT NULL,
  `class_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_course` (`code`(255),`section`(255),`semester`,`year`),
  KEY `instructor_id` (`instructor_id`),
  KEY `class_id` (`class_id`),
  CONSTRAINT `courses_ibfk_1` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `courses_ibfk_2` FOREIGN KEY (`class_id`) REFERENCES `pogil_classes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1281 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `demo_info_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `demo_code` varchar(64) NOT NULL DEFAULT 'aied2026',
  `name` varchar(191) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `institution` varchar(255) DEFAULT NULL,
  `role` varchar(255) DEFAULT NULL,
  `interest_beta` tinyint(1) NOT NULL DEFAULT 0,
  `interest_pilot` tinyint(1) NOT NULL DEFAULT 0,
  `interest_research` tinyint(1) NOT NULL DEFAULT 0,
  `interest_instructor_demo` tinyint(1) NOT NULL DEFAULT 0,
  `interest_technical` tinyint(1) NOT NULL DEFAULT 0,
  `interest_materials` tinyint(1) NOT NULL DEFAULT 0,
  `interest_other` tinyint(1) NOT NULL DEFAULT 0,
  `message` text DEFAULT NULL,
  `source_path` text DEFAULT NULL,
  `guest_token` varchar(191) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `ip_address` varchar(64) DEFAULT NULL,
  `status` enum('new','contacted','follow_up','closed') NOT NULL DEFAULT 'new',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_demo_info_requests_demo_code_created_at` (`demo_code`,`created_at`),
  KEY `idx_demo_info_requests_status` (`status`),
  KEY `idx_demo_info_requests_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `feedback` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `response_id` int(11) DEFAULT NULL,
  `feedback_text` text NOT NULL,
  `generated_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `feedback_fk_response` (`response_id`),
  CONSTRAINT `feedback_fk_response` FOREIGN KEY (`response_id`) REFERENCES `responses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4450 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `followups` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `response_id` int(11) DEFAULT NULL,
  `followup_prompt` text NOT NULL,
  `followup_generated` text NOT NULL,
  `generated_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `response_id` (`response_id`),
  CONSTRAINT `followups_ibfk_1` FOREIGN KEY (`response_id`) REFERENCES `responses_old` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `group_members` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `activity_instance_id` int(11) NOT NULL,
  `student_id` int(11) NOT NULL,
  `role` enum('facilitator','analyst','qc','spokesperson') DEFAULT NULL,
  `connected` tinyint(1) DEFAULT 0,
  `last_heartbeat` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_member_role` (`activity_instance_id`,`role`),
  KEY `student_id` (`student_id`),
  CONSTRAINT `group_members_ibfk_1` FOREIGN KEY (`activity_instance_id`) REFERENCES `activity_instances` (`id`) ON DELETE CASCADE,
  CONSTRAINT `group_members_ibfk_2` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7852 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pending_users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `code` varchar(6) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=242 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pogil_activities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(191) NOT NULL,
  `title` text NOT NULL,
  `sheet_url` text DEFAULT NULL,
  `source_type` varchar(16) NOT NULL DEFAULT 'remote',
  `content_text` longtext DEFAULT NULL,
  `class_id` int(11) NOT NULL,
  `order_index` int(11) NOT NULL DEFAULT 0,
  `created_by` int(11) DEFAULT NULL,
  `last_loaded` timestamp NULL DEFAULT NULL,
  `is_test` tinyint(1) DEFAULT NULL,
  `source_updated_at` datetime(3) DEFAULT NULL,
  `source_revision` int(10) unsigned NOT NULL DEFAULT 0,
  `source_origin` varchar(32) DEFAULT NULL,
  `local_source_hash` char(64) DEFAULT NULL,
  `remote_source_hash` char(64) DEFAULT NULL,
  `remote_updated_at` datetime(3) DEFAULT NULL,
  `last_synced_hash` char(64) DEFAULT NULL,
  `last_synced_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `class_id` (`class_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `pogil_activities_ibfk_1` FOREIGN KEY (`class_id`) REFERENCES `pogil_classes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pogil_activities_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1941 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pogil_classes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(191) NOT NULL,
  `description` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `level` varchar(255) DEFAULT NULL,
  `topic_domain` varchar(255) DEFAULT NULL,
  `demo_mode` tinyint(1) NOT NULL DEFAULT 0,
  `ai_guidance` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `pogil_classes_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1589 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `response_drafts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `activity_instance_id` int(11) NOT NULL,
  `question_id` varchar(64) NOT NULL,
  `response_type` enum('text','code','python','cpp','run_output') NOT NULL DEFAULT 'text',
  `response` mediumtext DEFAULT NULL,
  `answered_by_user_id` int(11) NOT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_draft` (`activity_instance_id`,`question_id`),
  KEY `idx_draft_instance` (`activity_instance_id`),
  KEY `idx_draft_answered_by` (`answered_by_user_id`),
  CONSTRAINT `fk_response_drafts_ai` FOREIGN KEY (`activity_instance_id`) REFERENCES `activity_instances` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_response_drafts_user` FOREIGN KEY (`answered_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12004959 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `response_qid_map` (
  `response_id` int(11) NOT NULL,
  `activity_instance_id` int(11) NOT NULL,
  `old_qid` text NOT NULL,
  `new_qid` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`response_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `responses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `activity_instance_id` int(11) NOT NULL,
  `question_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `submit_id` char(36) DEFAULT NULL,
  `response_type` enum('text','code','python','cpp','run_output') NOT NULL DEFAULT 'text',
  `response` text NOT NULL,
  `submitted_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `answered_by_user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `answered_by_user_id` (`answered_by_user_id`),
  KEY `idx_responses_ai_submit_id` (`activity_instance_id`,`submit_id`,`id`),
  KEY `idx_responses_ai_qid_id` (`activity_instance_id`,`question_id`,`id`),
  KEY `idx_responses_submit_id` (`submit_id`),
  KEY `idx_responses_ai_id` (`activity_instance_id`,`id`)
) ENGINE=InnoDB AUTO_INCREMENT=56285557 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `responses_legacy_backup` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `activity_instance_id` int(11) NOT NULL,
  `question_id` varchar(255) NOT NULL,
  `response_type` enum('text','code','python','cpp','run_output') NOT NULL DEFAULT 'text',
  `response` text NOT NULL,
  `submitted_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `answered_by_user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_responses_instance_question` (`activity_instance_id`,`question_id`),
  KEY `answered_by_user_id` (`answered_by_user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=32078315 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `password_hash` text NOT NULL,
  `role` enum('root','creator','instructor','student','grader') NOT NULL DEFAULT 'student',
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`) USING HASH,
  KEY `created_by` (`created_by`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3547 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
