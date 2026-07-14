/*M!999999\- enable the sandbox mode */ 

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `activity_heartbeats`;
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
DROP TABLE IF EXISTS `activity_instances`;
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
  `test_duration_minutes` int(10) unsigned NOT NULL DEFAULT 0 COMMENT 'Time limit in minutes for timed tests (0 = no limit)',
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
  PRIMARY KEY (`id`),
  KEY `activity_id` (`activity_id`),
  KEY `active_student_id` (`active_student_id`),
  KEY `idx_activity_instances_test_start` (`test_start_at`),
  KEY `idx_ai_progress_status` (`progress_status`),
  KEY `idx_ai_course_activity` (`course_id`,`activity_id`),
  KEY `idx_ai_submitted_by_user` (`submitted_by_user_id`),
  CONSTRAINT `activity_instances_ibfk_1` FOREIGN KEY (`activity_id`) REFERENCES `pogil_activities` (`id`) ON DELETE CASCADE,
  CONSTRAINT `activity_instances_ibfk_2` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `activity_instances_ibfk_3` FOREIGN KEY (`active_student_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ai_submitted_by_user` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1258 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `course_enrollments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_enrollments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `course_id` int(11) NOT NULL,
  `student_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_course_student` (`course_id`,`student_id`),
  KEY `student_id` (`student_id`),
  CONSTRAINT `course_enrollments_ibfk_1` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `course_enrollments_ibfk_2` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1437 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `courses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `courses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` text NOT NULL,
  `code` varchar(191) NOT NULL,
  `section` varchar(191) NOT NULL,
  `semester` enum('fall','spring','summer') NOT NULL,
  `year` int(11) NOT NULL,
  `instructor_id` int(11) DEFAULT NULL,
  `class_id` int(11) DEFAULT NULL,
  `google_folder_url` text DEFAULT NULL,
  `google_folder_id` varchar(255) DEFAULT NULL,
  `google_folder_name` varchar(255) DEFAULT NULL,
  `google_folder_verified_at` datetime DEFAULT NULL,
  `google_folder_status` varchar(32) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_course` (`code`,`section`,`semester`,`year`),
  KEY `instructor_id` (`instructor_id`),
  KEY `class_id` (`class_id`),
  CONSTRAINT `courses_ibfk_1` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `courses_ibfk_2` FOREIGN KEY (`class_id`) REFERENCES `pogil_classes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=307 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `demo_info_requests`;
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `event_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `activity_instance_id` int(11) DEFAULT NULL,
  `event_type` varchar(191) NOT NULL,
  `details` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `activity_instance_id` (`activity_instance_id`),
  CONSTRAINT `event_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `event_log_ibfk_2` FOREIGN KEY (`activity_instance_id`) REFERENCES `activity_instances` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `feedback`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `feedback` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `response_id` int(11) DEFAULT NULL,
  `feedback_text` text NOT NULL,
  `generated_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_feedback_response` (`response_id`),
  CONSTRAINT `fk_feedback_response` FOREIGN KEY (`response_id`) REFERENCES `responses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `followups`;
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
  CONSTRAINT `followups_ibfk_1` FOREIGN KEY (`response_id`) REFERENCES `responses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `group_members`;
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
  KEY `idx_gm_instance_student` (`activity_instance_id`,`student_id`),
  KEY `student_id` (`student_id`),
  CONSTRAINT `group_members_ibfk_1` FOREIGN KEY (`activity_instance_id`) REFERENCES `activity_instances` (`id`) ON DELETE CASCADE,
  CONSTRAINT `group_members_ibfk_2` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2256 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pending_users`;
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
) ENGINE=InnoDB AUTO_INCREMENT=47 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pogil_activities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pogil_activities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(191) NOT NULL,
  `title` text NOT NULL,
  `sheet_url` text DEFAULT NULL,
  `class_id` int(11) NOT NULL,
  `order_index` int(11) NOT NULL DEFAULT 0,
  `created_by` int(11) DEFAULT NULL,
  `last_loaded` timestamp NULL DEFAULT NULL,
  `is_test` tinyint(1) DEFAULT NULL,
  `source_type` varchar(16) NOT NULL DEFAULT 'remote',
  `content_text` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `class_id` (`class_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `pogil_activities_ibfk_1` FOREIGN KEY (`class_id`) REFERENCES `pogil_classes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pogil_activities_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=555 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pogil_classes`;
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
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `pogil_classes_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=354 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `response_drafts`;
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
) ENGINE=InnoDB AUTO_INCREMENT=597538 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `responses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `responses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `activity_instance_id` int(11) NOT NULL,
  `question_id` varchar(64) NOT NULL,
  `submit_id` char(36) DEFAULT NULL,
  `response_type` enum('text','code','python','cpp','run_output') NOT NULL DEFAULT 'text',
  `response` mediumtext DEFAULT NULL,
  `submitted_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `answered_by_user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_qid` (`activity_instance_id`,`question_id`),
  KEY `idx_answered_by` (`answered_by_user_id`),
  KEY `idx_responses_ai_submit_id` (`activity_instance_id`,`submit_id`,`id`),
  KEY `idx_responses_ai_qid_id` (`activity_instance_id`,`question_id`,`id`),
  KEY `idx_responses_submit_id` (`submit_id`),
  KEY `idx_responses_ai_id` (`activity_instance_id`,`id`),
  CONSTRAINT `fk_responses_ai` FOREIGN KEY (`activity_instance_id`) REFERENCES `activity_instances` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_responses_user` FOREIGN KEY (`answered_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1190621 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` text NOT NULL,
  `role` enum('root','creator','instructor','student','grader') NOT NULL DEFAULT 'student',
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=873 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

