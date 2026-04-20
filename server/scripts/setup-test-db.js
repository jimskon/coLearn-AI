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
