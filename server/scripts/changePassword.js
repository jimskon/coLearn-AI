const readline = require('readline');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '/opt/coLearn-AI/server/.env') });

// ===== DB CONFIG FROM .env =====
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// ===== Readline helpers =====
function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve =>
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

// Hidden password input
function askHidden(question) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);

    let input = '';
    process.stdout.write(question);

    stdin.on('data', char => {
      char = char.toString();

      if (char === '\n' || char === '\r') {
        stdin.setRawMode(false);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        process.exit(); // Ctrl+C
      } else {
        input += char;
        process.stdout.write('*');
      }
    });
  });
}

// ===== Main =====
async function main() {
  try {
    const email = await ask('Enter email: ');
    const password = await askHidden('Enter new password: ');

    if (!email || !password) {
      throw new Error('Email and password are required.');
    }

    const hash = await bcrypt.hash(password, 10);

    const conn = await mysql.createConnection(dbConfig);

    const [result] = await conn.execute(
      'UPDATE users SET password_hash = ? WHERE email = ?',
      [hash, email]
    );

    if (result.affectedRows === 0) {
      console.log('No user found with that email.');
    } else {
      console.log('Password updated successfully.');
    }

    await conn.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
