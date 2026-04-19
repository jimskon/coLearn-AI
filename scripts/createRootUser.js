#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const readline = require('readline');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    if (!hidden) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    const stdin = process.openStdin();
    process.stdout.write(question);

    let value = '';
    const onData = (char) => {
      char = char.toString();

      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(value.trim());
          break;
        case '\u0003':
          process.exit();
          break;
        case '\u007f':
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          break;
        default:
          value += char;
          process.stdout.write('*');
          break;
      }
    };

    stdin.on('data', onData);
  });
}

async function main() {
  let connection;

  try {
    console.log('\nCreate coLearn Root User\n');

    const email = await ask('Enter root email (example: colearnroot@ki.se): ');
    const password = await ask('Enter password: ', { hidden: true });
    const confirm = await ask('Confirm password: ', { hidden: true });

    if (password !== confirm) {
      throw new Error('Passwords do not match');
    }

    const hash = await bcrypt.hash(password, 10);

    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'colearn_db',
    });

    const [existing] = await connection.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      await connection.execute(
        `UPDATE users
         SET password_hash = ?, role = 'root'
         WHERE email = ?`,
        [hash, email]
      );

      console.log(`Updated existing user and promoted to root: ${email}`);
    } else {
      await connection.execute(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES (?, ?, ?, 'root')`,
        ['Root User', email, hash]
      );

      console.log(`Created root user: ${email}`);
    }

  } catch (err) {
    console.error('\nError:', err.message);
  } finally {
    if (connection) await connection.end();
  }
}

main();