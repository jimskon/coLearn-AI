// server/scripts/makeInstructors.js
// Create (or reuse) N instructor accounts from an email template.
// - If the user exists, reuse it: set role to "instructor" and reset the password.
//   (root/creator accounts keep their role.)
// - Else insert it directly into the DB (no email verification step).
//
// Run with: node server/scripts/makeInstructors.js

const bcrypt = require('bcrypt');
const readline = require('readline');
const db = require('../db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

function getRandomName() {
  const first = ["James","Mary","John","Patricia","Robert","Jennifer","Michael","Linda","William","Elizabeth",
    "David","Barbara","Richard","Susan","Joseph","Jessica","Thomas","Sarah","Charles","Karen",
    "Christopher","Nancy","Daniel","Lisa","Matthew","Betty","Anthony","Margaret","Donald","Sandra",
    "Mark","Ashley","Paul","Kimberly","Steven","Emily","Andrew","Donna","Kenneth","Michelle",
    "George","Dorothy","Joshua","Carol","Kevin","Amanda","Brian","Melissa","Edward","Deborah"
  ];
  const last = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
    "Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
    "Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson",
    "Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores",
    "Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts"
  ];
  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}

function makeEmailFromTemplate(template, i) {
  // Supports:
  //  - "demo-instructor@demo.local" -> demo-instructor1@demo.local, demo-instructor2@...
  //  - "demo-instructor+{i}@demo.local" -> demo-instructor+1@demo.local, ...
  if (template.includes('{i}')) return template.replaceAll('{i}', String(i));
  return template.replace('@', `${i}@`);
}

const KEEP_ROLES = new Set(['root', 'creator']);

async function createOrReuseInstructor(email, passwordHash) {
  const [[existing]] = await db.query(
    'SELECT id, name, email, role FROM users WHERE email = ?',
    [email]
  );

  if (existing) {
    const role = KEEP_ROLES.has(existing.role) ? existing.role : 'instructor';
    await db.query(
      'UPDATE users SET role = ?, password_hash = ? WHERE id = ?',
      [role, passwordHash, existing.id]
    );
    console.log(`✔ Reused ${email} (id ${existing.id}), role ${role}, password reset`);
    return { ...existing, role, reused: true };
  }

  const name = getRandomName();
  const [result] = await db.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'instructor')",
    [name, email, passwordHash]
  );
  console.log(`✔ Created ${email} (id ${result.insertId}) as ${name}`);
  return { id: result.insertId, name, email, role: 'instructor', reused: false };
}

async function main() {
  try {
    console.log('=== Create Instructor Accounts (idempotent) ===');

    const template = (await prompt('\nInstructor email template (e.g., demo-instructor@demo.local OR demo-instructor+{i}@demo.local): ')).trim();
    if (!template.includes('@')) {
      throw new Error('Email template must include an "@".');
    }

    const password = (await prompt('Password for all instructor accounts: ')).trim();
    if (!password) throw new Error('Password is required.');

    const countStr = await prompt('Number of instructors to create (e.g., 3): ');
    const count = Math.max(1, parseInt(countStr, 10) || 1);

    const passwordHash = await bcrypt.hash(password, 10);

    const instructors = [];
    for (let i = 1; i <= count; i++) {
      const email = makeEmailFromTemplate(template, i);
      instructors.push(await createOrReuseInstructor(email, passwordHash));
    }

    console.log('\n🎉 Done.');
    console.log(`All accounts use password: ${password}`);
    console.log('Instructors:');
    for (const u of instructors) {
      console.log(`  ${u.email}${u.reused ? '  (existing)' : ''}`);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await db.end();
  }
}

main();
