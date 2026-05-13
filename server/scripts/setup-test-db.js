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

      CREATE TABLE IF NOT EXISTS pogil_classes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(191) NOT NULL UNIQUE,
        description TEXT DEFAULT NULL,
        created_by INT DEFAULT NULL,
        CONSTRAINT pogil_classes_created_by_fk
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );

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
