const mysql = require('mysql2/promise');

const {
  DB_HOST = '127.0.0.1',
  DB_PORT = '3306',
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
} = process.env;

if (!DB_USER || !DB_NAME) {
  console.error('DB_USER and DB_NAME are required to set up the test database.');
  process.exit(1);
}

async function main() {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    multipleStatements: true,
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name TEXT NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role ENUM('root','creator','instructor','student','grader') NOT NULL DEFAULT 'student',
        created_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS pending_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) DEFAULT NULL,
        email VARCHAR(255) DEFAULT NULL UNIQUE,
        password_hash VARCHAR(255) DEFAULT NULL,
        code VARCHAR(6) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

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

      CREATE TABLE IF NOT EXISTS pogil_classes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(191) NOT NULL UNIQUE,
        description TEXT DEFAULT NULL,
        level VARCHAR(255) DEFAULT NULL,
        topic_domain VARCHAR(255) DEFAULT NULL,
        created_by INT DEFAULT NULL,
        CONSTRAINT pogil_classes_created_by_fk
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );

      ALTER TABLE pogil_classes
        ADD COLUMN IF NOT EXISTS level VARCHAR(255) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS topic_domain VARCHAR(255) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS demo_mode TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ai_guidance TEXT DEFAULT NULL;

      CREATE TABLE IF NOT EXISTS courses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name TEXT NOT NULL,
        code VARCHAR(191) NOT NULL,
        section TEXT NOT NULL,
        semester ENUM('fall','spring','summer') NOT NULL,
        year INT NOT NULL,
        instructor_id INT DEFAULT NULL,
        class_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_course (code, section(191), semester, year),
        CONSTRAINT courses_instructor_fk
          FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT courses_class_fk
          FOREIGN KEY (class_id) REFERENCES pogil_classes(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS course_enrollments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_id INT NOT NULL,
        student_id INT NOT NULL,
        UNIQUE KEY unique_enrollment (course_id, student_id),
        CONSTRAINT course_enrollments_course_fk
          FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        CONSTRAINT course_enrollments_student_fk
          FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS pogil_activities (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(191) NOT NULL,
        title TEXT NOT NULL,
        sheet_url TEXT DEFAULT NULL,
        source_type VARCHAR(16) NOT NULL DEFAULT 'remote',
        content_text LONGTEXT DEFAULT NULL,
        source_updated_at DATETIME(3) DEFAULT NULL,
        source_revision INT UNSIGNED NOT NULL DEFAULT 0,
        source_origin VARCHAR(32) DEFAULT NULL,
        local_source_hash CHAR(64) DEFAULT NULL,
        remote_source_hash CHAR(64) DEFAULT NULL,
        remote_updated_at DATETIME(3) DEFAULT NULL,
        last_synced_hash CHAR(64) DEFAULT NULL,
        last_synced_at DATETIME(3) DEFAULT NULL,
        class_id INT NOT NULL,
        order_index INT NOT NULL DEFAULT 0,
        created_by INT DEFAULT NULL,
        last_loaded TIMESTAMP NULL DEFAULT NULL,
        is_test TINYINT(1) DEFAULT NULL,
        CONSTRAINT pogil_activities_class_fk
          FOREIGN KEY (class_id) REFERENCES pogil_classes(id) ON DELETE CASCADE,
        CONSTRAINT pogil_activities_created_by_fk
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );

      ALTER TABLE pogil_activities
        ADD COLUMN IF NOT EXISTS source_updated_at DATETIME(3) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS source_revision INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS source_origin VARCHAR(32) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS local_source_hash CHAR(64) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS remote_source_hash CHAR(64) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS remote_updated_at DATETIME(3) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS last_synced_hash CHAR(64) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS last_synced_at DATETIME(3) DEFAULT NULL,
        MODIFY COLUMN source_type VARCHAR(16) NOT NULL DEFAULT 'remote',
        MODIFY COLUMN content_text LONGTEXT NULL;

      CREATE TABLE IF NOT EXISTS activity_edit_locks (
        activity_id INT NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        lease_token CHAR(36) NOT NULL,
        acquired_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        KEY activity_edit_locks_expires_at_idx (expires_at),
        CONSTRAINT activity_edit_locks_activity_fk
          FOREIGN KEY (activity_id) REFERENCES pogil_activities(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS activity_instances (
        id INT AUTO_INCREMENT PRIMARY KEY,
        activity_id INT NOT NULL,
        course_id INT NOT NULL,
        status ENUM('in_progress','completed') DEFAULT 'in_progress',
        active_student_id INT DEFAULT NULL,
        group_number INT DEFAULT NULL,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT activity_instances_activity_fk
          FOREIGN KEY (activity_id) REFERENCES pogil_activities(id),
        CONSTRAINT activity_instances_course_fk
          FOREIGN KEY (course_id) REFERENCES courses(id),
        CONSTRAINT activity_instances_student_fk
          FOREIGN KEY (active_student_id) REFERENCES users(id)
      );

      ALTER TABLE activity_instances
        ADD COLUMN IF NOT EXISTS test_focus_loss_count INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS test_focus_enforcement TINYINT(1) NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_type VARCHAR(191) NOT NULL,
        user_id INT DEFAULT NULL,
        guest_token VARCHAR(191) DEFAULT NULL,
        role VARCHAR(32) DEFAULT NULL,
        class_id INT DEFAULT NULL,
        course_id INT DEFAULT NULL,
        activity_id INT DEFAULT NULL,
        activity_instance_id INT DEFAULT NULL,
        request_path VARCHAR(255) DEFAULT NULL,
        ip_address VARCHAR(64) DEFAULT NULL,
        ip_country VARCHAR(64) DEFAULT NULL,
        ip_region VARCHAR(191) DEFAULT NULL,
        ip_city VARCHAR(191) DEFAULT NULL,
        user_agent TEXT DEFAULT NULL,
        details TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_audit_log_event_created_at (event_type, created_at),
        KEY idx_audit_log_user_created_at (user_id, created_at),
        KEY idx_audit_log_guest_created_at (guest_token, created_at),
        KEY idx_audit_log_class_created_at (class_id, created_at),
        KEY idx_audit_log_course_created_at (course_id, created_at),
        KEY idx_audit_log_activity_created_at (activity_id, created_at),
        KEY idx_audit_log_instance_created_at (activity_instance_id, created_at),
        CONSTRAINT audit_log_user_fk
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT audit_log_class_fk
          FOREIGN KEY (class_id) REFERENCES pogil_classes(id) ON DELETE SET NULL,
        CONSTRAINT audit_log_course_fk
          FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
        CONSTRAINT audit_log_activity_fk
          FOREIGN KEY (activity_id) REFERENCES pogil_activities(id) ON DELETE SET NULL,
        CONSTRAINT audit_log_instance_fk
          FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE SET NULL
      );
    `);

    console.log(`Prepared test database ${DB_NAME}.`);
  } finally {
    await connection.end();
  }
}

main().catch(err => {
  console.error('Failed to set up test database:', err);
  process.exit(1);
});
