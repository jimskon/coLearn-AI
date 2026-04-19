// server/tests/enrollStudentsByCourseCode.js
// Given a course code, generate (or reuse) N demo students and enroll them.
// - If student exists, reuse.
// - Else register.
// - Ensure role is "student".
// - Enroll is idempotent (ignore already-enrolled).
//
// Run with: node server/tests/enrollStudentsByCourseCode.js

const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000/api';
const PASSWORD = process.env.DEMO_PASSWORD || 'KenyonAI';   // Shared demo password

function prompt(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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

// ---------------- user helpers ----------------

async function getUserByEmail(email) {
  // Your working admin endpoint.
  const res = await axios.get(`${BASE_URL}/users/admin/users`);
  return (res.data || []).find(u => u.email === email) || null;
}

async function pollForUser(email, { attempts = 12, delayMs = 250 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const u = await getUserByEmail(email);
    if (u) return u;
    await sleep(delayMs);
  }
  return null;
}

async function ensureRole(user, desiredRole) {
  if (!user?.id) return user;
  if (user.role !== desiredRole) {
    console.log(`→ Updating role for ${user.email} from ${user.role} to ${desiredRole}`);
    await axios.put(`${BASE_URL}/users/admin/users/${user.id}/role`, { role: desiredRole });
    return { ...user, role: desiredRole };
  }
  return user;
}

async function registerOrReuseUser(email, name, desiredRole) {
  try {
    console.log(`\n=== Registering ${desiredRole} ${email} (or reusing) ===`);
    const res = await axios.post(`${BASE_URL}/auth/register`, {
      name, email, password: PASSWORD
    });

    const payload = res.data || {};
    if (payload?.id) {
      console.log(`✔ Registered user ${email} with id ${payload.id}`);
      return ensureRole(payload, desiredRole);
    }

    console.warn(`ℹ️ Register returned no user for ${email}. Polling admin list...`);
    const user = await pollForUser(email);
    if (!user) throw new Error(`User with email ${email} not found after registration.`);
    console.log(`✔ Reused existing user ${email} (id ${user.id})`);
    return ensureRole(user, desiredRole);

  } catch (error) {
    if (error.response?.status === 409) {
      console.warn(`⚠️ Email already exists for ${email}. Reusing existing user.`);
      const existingUser = await pollForUser(email);
      if (!existingUser) throw new Error(`Existing user ${email} not retrievable from admin list.`);
      console.log(`✔ Reused existing user ${email} (id ${existingUser.id})`);
      return ensureRole(existingUser, desiredRole);
    }
    throw error;
  }
}

// ---------------- enrollment helper ----------------

// Use the enroll endpoint as the source of truth about whether the course code exists.
// This avoids the "GET /courses is filtered/auth-protected" problem.
async function enrollStudent(courseCode, studentId) {
  console.log(`  → Enrolling student ${studentId} into ${courseCode} (idempotent)`);
  try {
    await axios.post(`${BASE_URL}/courses/enroll-by-code`, { code: courseCode, userId: studentId });
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    const msg = JSON.stringify(body || {});

    // already enrolled
    if (status === 409) return;
    if (status === 400 && /already/i.test(msg)) return;

    // course code not found / invalid (make it explicit)
    if (status === 404 || (status === 400 && /course/i.test(msg) && /not/i.test(msg))) {
      throw new Error(`Course code "${courseCode}" was rejected by enroll-by-code. Server said: ${msg}`);
    }

    throw err;
  }
}

function makeEmailFromTemplate(template, i) {
  // Supports:
  //  - "demo-student@demo.local" -> demo-student1@demo.local, demo-student2@...
  //  - "demo-student+{i}@demo.local" -> demo-student+1@demo.local, ...
  if (template.includes('{i}')) return template.replaceAll('{i}', String(i));
  return template.replace('@', `${i}@`);
}

async function main() {
  try {
    console.log('=== Enroll Demo Students into Existing Course Code (idempotent) ===');
    console.log(`BASE_URL = ${BASE_URL}`);

    const courseCode = (await prompt('\nCourse code to enroll into (must already exist): ')).trim();
    if (!courseCode) throw new Error('Course code is required.');

    const studentTemplate = (await prompt('\nStudent email template (e.g., demo-student@demo.local OR demo-student+{i}@demo.local): ')).trim();
    if (!studentTemplate.includes('@')) {
      throw new Error('Student email template must include an "@".');
    }

    const numStudentsStr = await prompt('Number of demo students to create/enroll (e.g., 6): ');
    const numStudents = Math.max(1, parseInt(numStudentsStr, 10) || 4);

    // 1) Create/reuse students
    const students = [];
    for (let i = 1; i <= numStudents; i++) {
      const email = makeEmailFromTemplate(studentTemplate, i);
      const student = await registerOrReuseUser(email, getRandomName(), 'student');
      students.push(student);
    }

    // 2) Enroll students
    console.log(`\n=== Enrolling ${students.length} students into ${courseCode} ===`);
    for (const s of students) {
      await enrollStudent(courseCode, s.id);
    }

    console.log('\n🎉 Done.');
    console.log(`All demo accounts use password: ${PASSWORD}`);
    console.log('Students:');
    for (const s of students) {
      console.log(`  ${s.email}`);
    }

  } catch (error) {
    if (error.response) {
      console.error('\n❌ API Error:');
      console.error(`  URL:     ${error.config?.url}`);
      console.error(`  Method:  ${error.config?.method?.toUpperCase()}`);
      console.error(`  Status:  ${error.response.status} ${error.response.statusText}`);
      console.error(`  Message: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error('\n❌ No response received from server:');
      console.error(error.request);
    } else {
      console.error('\n❌ Error:', error.message);
    }
  } finally {
    rl.close();
  }
}

main();
