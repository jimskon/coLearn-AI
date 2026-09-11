#!/usr/bin/env node
// scripts/importStudents.js
// Usage: node scripts/importStudents.js students.csv
//
// CSV format (header row required):
//   name,email
//   -- or --
//   first_name,last_name,email
//
// Prompts for a default password for new accounts and an optional
// course join code to enroll everyone in an existing class instance.

'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const readline = require('readline');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

// ── helpers ──────────────────────────────────────────────────────────────────

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
        case '\n': case '\r': case '':
          stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(value.trim());
          break;
        case '':
          process.exit();
          break;
        case '':
          if (value.length > 0) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
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

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));

  const nameIdx     = headers.indexOf('name');
  const firstIdx    = headers.indexOf('first_name');
  const lastIdx     = headers.indexOf('last_name');
  const emailIdx    = headers.indexOf('email');

  if (emailIdx === -1) throw new Error('CSV must have an "email" column.');
  if (nameIdx === -1 && (firstIdx === -1 || lastIdx === -1)) {
    throw new Error('CSV must have either a "name" column or both "first_name" and "last_name" columns.');
  }

  const students = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const email = cols[emailIdx] || '';
    if (!email) continue;

    let name;
    if (nameIdx !== -1) {
      name = cols[nameIdx] || '';
    } else {
      name = `${cols[firstIdx] || ''} ${cols[lastIdx] || ''}`.trim();
    }

    if (!name) throw new Error(`Row ${i + 1}: could not determine student name.`);
    students.push({ name, email: email.toLowerCase() });
  }
  return students;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/importStudents.js <students.csv>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(csvPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  let students;
  try {
    students = parseCsv(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (err) {
    console.error('CSV parse error:', err.message);
    process.exit(1);
  }

  console.log(`\nImport Students into coLearn\n`);
  console.log(`Found ${students.length} student(s) in ${path.basename(resolvedPath)}\n`);

  // Default password for new accounts
  const password = await ask('Default password for new accounts: ', { hidden: true });
  const confirm  = await ask('Confirm password: ',                  { hidden: true });
  if (password !== confirm) { console.error('Passwords do not match.'); process.exit(1); }
  if (password.length < 6)  { console.error('Password must be at least 6 characters.'); process.exit(1); }

  // Optional join code
  const joinCodeRaw = await ask('Course join code (press Enter to skip): ');
  const joinCode = joinCodeRaw || null;

  const hash = await bcrypt.hash(password, 10);

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'colearn_db',
  });

  let courseId = null;
  let courseName = null;

  if (joinCode) {
    const [[course]] = await conn.execute(
      `SELECT id, name FROM courses WHERE code = ?`, [joinCode]
    );
    if (!course) {
      console.error(`\nJoin code "${joinCode}" not found in the database.`);
      await conn.end();
      process.exit(1);
    }
    courseId   = course.id;
    courseName = course.name;
    console.log(`\nWill enroll students in: ${courseName} (id=${courseId})\n`);
  }

  const results = { created: 0, existing: 0, enrolled: 0, alreadyEnrolled: 0, errors: [] };

  for (const { name, email } of students) {
    try {
      // Upsert user
      const [[existing]] = await conn.execute(
        `SELECT id FROM users WHERE email = ?`, [email]
      );

      let userId;
      if (existing) {
        userId = existing.id;
        results.existing++;
        process.stdout.write(`  ~ ${name} <${email}> — already exists\n`);
      } else {
        const [ins] = await conn.execute(
          `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'student')`,
          [name, email, hash]
        );
        userId = ins.insertId;
        results.created++;
        process.stdout.write(`  + ${name} <${email}> — created\n`);
      }

      // Enroll if join code given
      if (courseId) {
        const [[enr]] = await conn.execute(
          `SELECT 1 FROM course_enrollments WHERE student_id = ? AND course_id = ?`,
          [userId, courseId]
        );
        if (enr) {
          results.alreadyEnrolled++;
          process.stdout.write(`      already enrolled in ${courseName}\n`);
        } else {
          await conn.execute(
            `INSERT INTO course_enrollments (student_id, course_id) VALUES (?, ?)`,
            [userId, courseId]
          );
          results.enrolled++;
          process.stdout.write(`      enrolled in ${courseName}\n`);
        }
      }
    } catch (err) {
      results.errors.push({ email, message: err.message });
      process.stdout.write(`  ! ${email} — ERROR: ${err.message}\n`);
    }
  }

  await conn.end();

  console.log('\n── Summary ─────────────────────────────');
  console.log(`  Created:          ${results.created}`);
  console.log(`  Already existed:  ${results.existing}`);
  if (courseId) {
    console.log(`  Enrolled:         ${results.enrolled}`);
    console.log(`  Already enrolled: ${results.alreadyEnrolled}`);
  }
  if (results.errors.length) {
    console.log(`  Errors:           ${results.errors.length}`);
    results.errors.forEach((e) => console.log(`    ${e.email}: ${e.message}`));
  }
  console.log('────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
