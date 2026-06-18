#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/db.sh"

echo "Adding demo_info_requests table..."

db_exec <<'SQL'
CREATE TABLE IF NOT EXISTS demo_info_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_code VARCHAR(64) NOT NULL DEFAULT 'aied2026',
  name VARCHAR(191) DEFAULT NULL,
  email VARCHAR(255) NOT NULL,
  institution VARCHAR(255) DEFAULT NULL,
  role VARCHAR(255) DEFAULT NULL,
  interest_beta TINYINT(1) NOT NULL DEFAULT 0,
  interest_pilot TINYINT(1) NOT NULL DEFAULT 0,
  interest_research TINYINT(1) NOT NULL DEFAULT 0,
  interest_instructor_demo TINYINT(1) NOT NULL DEFAULT 0,
  interest_technical TINYINT(1) NOT NULL DEFAULT 0,
  interest_materials TINYINT(1) NOT NULL DEFAULT 0,
  interest_other TINYINT(1) NOT NULL DEFAULT 0,
  message TEXT DEFAULT NULL,
  source_path TEXT DEFAULT NULL,
  guest_token VARCHAR(191) DEFAULT NULL,
  user_agent TEXT DEFAULT NULL,
  ip_address VARCHAR(64) DEFAULT NULL,
  status ENUM('new','contacted','follow_up','closed') NOT NULL DEFAULT 'new',
  notes TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_demo_info_requests_demo_code_created_at (demo_code, created_at),
  KEY idx_demo_info_requests_status (status),
  KEY idx_demo_info_requests_email (email)
);
SQL

echo "Migration completed successfully."
