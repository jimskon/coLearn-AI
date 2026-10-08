// server/scripts/makeWorkshopAccounts.js
// One-time setup for a workshop: give each participant a student account and a
// creator account under their real name, using the workshop's fake emails, so
// the instructor sees real names in View Groups.
//
// Input CSV (header row required; other columns are ignored):
//   table,activity,name,email,student,creator
//   1,Maps,Jane Doe,jane@college.edu,s1@school.edu,c1@school.edu
// The participant's real email is never stored; only the fake student/creator
// emails are used as logins.
//
// - Existing accounts with those emails are reused: name, role, and password
//   are updated, so there is nothing to clear out first.
// - Adds EXTRA spare pairs (default 5) with random names for walk-ins,
//   numbered after the highest sN/cN in the file (e.g. s14/c14 ... s18/c18).
// - Optionally enrolls the student accounts in a course by course code, one
//   code per value in the "activity" column; spares go into every code given.
// - Writes <input>-accounts.csv: table, name, student login, creator login.
//
// Run with: node server/scripts/makeWorkshopAccounts.js path/to/participants.csv

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const bcrypt = require('bcrypt');
const readline = require('readline');
const db = require('../db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000/api';
const EXTRA = Number.parseInt(process.env.EXTRA ?? '5', 10);

function prompt(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

function getRandomName() {
  const first = ["James","Mary","John","Patricia","Robert","Jennifer","Michael","Linda","William","Elizabeth",
    "David","Barbara","Richard","Susan","Joseph","Jessica","Thomas","Sarah","Charles","Karen",
    "Christopher","Nancy","Daniel","Lisa","Matthew","Betty","Anthony","Margaret","Donald","Sandra"];
  const last = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
    "Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin"];
  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}

// Minimal CSV parser: commas, double-quoted fields, "" escapes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

function readParticipants(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV is missing the "${name}" column.`);
    return i;
  };
  const [iTable, iActivity, iName, iStudent, iCreator] =
    ['table', 'activity', 'name', 'student', 'creator'].map(col);
  return rows.map((r, n) => {
    const p = {
      table: (r[iTable] || '').trim(),
      activity: (r[iActivity] || '').trim(),
      name: (r[iName] || '').trim(),
      student: (r[iStudent] || '').trim().toLowerCase(),
      creator: (r[iCreator] || '').trim().toLowerCase(),
    };
    if (!p.name || !p.student.includes('@') || !p.creator.includes('@')) {
      throw new Error(`Row ${n + 2}: needs a name and student/creator emails.`);
    }
    return p;
  });
}

// s13@school.edu -> { prefix: 's', n: 13, domain: 'school.edu' }
function splitNumbered(email) {
  const m = /^([a-z._+-]*?)(\d+)@(.+)$/i.exec(email);
  return m ? { prefix: m[1], n: Number(m[2]), domain: m[3] } : null;
}

function spareParticipants(participants, count) {
  if (count <= 0) return [];
  const s = participants.map((p) => splitNumbered(p.student)).filter(Boolean);
  const c = participants.map((p) => splitNumbered(p.creator)).filter(Boolean);
  if (!s.length || !c.length) {
    throw new Error('Cannot number spare accounts: student/creator emails are not like s1@school.edu.');
  }
  const next = Math.max(...s.map((x) => x.n), ...c.map((x) => x.n)) + 1;
  return Array.from({ length: count }, (_, k) => ({
    table: 'spare',
    activity: '',
    name: getRandomName(),
    student: `${s[0].prefix}${next + k}@${s[0].domain}`,
    creator: `${c[0].prefix}${next + k}@${c[0].domain}`,
  }));
}

async function upsertUser(email, name, role, passwordHash) {
  const [[existing]] = await db.query('SELECT id, role FROM users WHERE email = ?', [email]);
  if (existing) {
    if (existing.role === 'root' || existing.role === 'instructor') {
      throw new Error(`${email} is an existing ${existing.role} account; refusing to change it.`);
    }
    await db.query(
      'UPDATE users SET name = ?, role = ?, password_hash = ? WHERE id = ?',
      [name, role, passwordHash, existing.id]
    );
    return { id: existing.id, reused: true };
  }
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, role]
  );
  await db.query('DELETE FROM pending_users WHERE email = ?', [email]);
  return { id: result.insertId, reused: false };
}

async function enroll(courseCode, userId) {
  try {
    await axios.post(`${BASE_URL}/courses/enroll-by-code`, { code: courseCode, userId });
  } catch (err) {
    const status = err.response?.status;
    const msg = JSON.stringify(err.response?.data || {});
    if (status === 409 || (status === 400 && /already/i.test(msg))) return;
    throw new Error(`Enrolling user ${userId} in "${courseCode}" failed (${status || err.message}): ${msg}`);
  }
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: node server/scripts/makeWorkshopAccounts.js participants.csv');

    const participants = readParticipants(file);
    const spares = spareParticipants(participants, Number.isFinite(EXTRA) ? EXTRA : 5);
    const everyone = [...participants, ...spares];

    console.log(`=== Workshop accounts: ${participants.length} participants + ${spares.length} spares ===`);
    for (const p of everyone) {
      console.log(`  table ${String(p.table).padEnd(5)} ${p.name.padEnd(28)} ${p.student.padEnd(18)} ${p.creator}`);
    }

    const password = (await prompt('\nPassword for all accounts: ')).trim();
    if (!password) throw new Error('Password is required.');

    const activities = [...new Set(participants.map((p) => p.activity).filter(Boolean))];
    const codes = {};
    for (const a of activities) {
      codes[a] = (await prompt(`Course code to enroll the "${a}" students in (blank to skip): `)).trim();
    }
    const allCodes = [...new Set(Object.values(codes).filter(Boolean))];

    const ok = (await prompt(`\nCreate/update ${everyone.length * 2} accounts? Existing accounts with these emails get the new name and password. Type "yes": `)).trim().toLowerCase();
    if (ok !== 'yes') { console.log('Cancelled.'); return; }

    const passwordHash = await bcrypt.hash(password, 10);
    for (const p of everyone) {
      const s = await upsertUser(p.student, p.name, 'student', passwordHash);
      const c = await upsertUser(p.creator, p.name, 'creator', passwordHash);
      p.studentId = s.id;
      const targets = p.table === 'spare' ? allCodes : [codes[p.activity]].filter(Boolean);
      for (const code of targets) await enroll(code, s.id);
      console.log(`✔ ${p.name}: ${p.student} (${s.reused ? 'updated' : 'new'}), ${p.creator} (${c.reused ? 'updated' : 'new'})${targets.length ? `, enrolled in ${targets.join(', ')}` : ''}`);
    }

    const out = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}-accounts.csv`);
    fs.writeFileSync(out, [
      'table,activity,name,student_login,creator_login',
      ...everyone.map((p) => [p.table, p.activity, p.name, p.student, p.creator].map(csvCell).join(',')),
    ].join('\n') + '\n');

    console.log('\n🎉 Done.');
    console.log(`All accounts use password: ${password}`);
    console.log(`Roster written to ${out}`);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await db.end();
  }
}

main();
