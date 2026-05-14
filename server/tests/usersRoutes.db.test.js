const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const userRoutes = require('../users/routes');
const db = require('../db');

function uniqueValue(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const created = {
  users: new Set(),
  classes: new Set(),
  courses: new Set(),
  activities: new Set(),
  instances: new Set(),
};

function remember(kind, id) {
  const numericId = Number(id);
  if (Number.isFinite(numericId)) created[kind].add(numericId);
  return numericId;
}

async function cleanupCreatedRows() {
  const instanceIds = [...created.instances];
  const activityIds = [...created.activities];
  const courseIds = [...created.courses];
  const classIds = [...created.classes];
  const userIds = [...created.users];

  if (instanceIds.length) {
    await db.query(`DELETE FROM group_members WHERE activity_instance_id IN (?)`, [instanceIds]);
    await db.query(`DELETE FROM activity_instances WHERE id IN (?)`, [instanceIds]);
  }
  if (activityIds.length) await db.query(`DELETE FROM pogil_activities WHERE id IN (?)`, [activityIds]);
  if (courseIds.length) await db.query(`DELETE FROM courses WHERE id IN (?)`, [courseIds]);
  if (classIds.length) await db.query(`DELETE FROM pogil_classes WHERE id IN (?)`, [classIds]);
  if (userIds.length) await db.query(`DELETE FROM users WHERE id IN (?)`, [userIds]);
}

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name TEXT NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role ENUM('root','creator','instructor','student','grader') NOT NULL DEFAULT 'student',
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS pogil_classes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      description TEXT DEFAULT NULL,
      created_by INT DEFAULT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name TEXT NOT NULL,
      code VARCHAR(191) NOT NULL,
      section TEXT NOT NULL,
      semester ENUM('fall','spring','summer') NOT NULL,
      year INT NOT NULL,
      instructor_id INT DEFAULT NULL,
      class_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS pogil_activities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      title TEXT NOT NULL,
      sheet_url TEXT DEFAULT NULL,
      source_type VARCHAR(16) NOT NULL DEFAULT 'remote',
      content_text LONGTEXT DEFAULT NULL,
      class_id INT NOT NULL,
      order_index INT NOT NULL DEFAULT 0,
      created_by INT DEFAULT NULL,
      last_loaded TIMESTAMP NULL DEFAULT NULL,
      is_test TINYINT(1) DEFAULT NULL
    )
  `);

  await db.query(`
    ALTER TABLE pogil_activities
      ADD COLUMN IF NOT EXISTS source_type VARCHAR(16) NOT NULL DEFAULT 'remote',
      ADD COLUMN IF NOT EXISTS content_text LONGTEXT DEFAULT NULL
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS activity_instances (
      id INT AUTO_INCREMENT PRIMARY KEY,
      activity_id INT NOT NULL,
      course_id INT NOT NULL,
      status ENUM('in_progress','completed') DEFAULT 'in_progress',
      active_student_id INT DEFAULT NULL,
      group_number INT DEFAULT NULL,
      start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE activity_instances
      ADD COLUMN IF NOT EXISTS progress_status VARCHAR(32) NOT NULL DEFAULT 'not_started'
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      activity_instance_id INT NOT NULL,
      student_id INT NOT NULL,
      role VARCHAR(32) DEFAULT NULL,
      connected TINYINT(1) NOT NULL DEFAULT 0,
      last_heartbeat DATETIME NULL,
      UNIQUE KEY uniq_group_member (activity_instance_id, student_id)
    )
  `);
}

async function createUser(role = 'student', name = null) {
  const email = `${uniqueValue(role)}@example.com`;
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name || `${role} user`, email, 'not-used', role]
  );
  return {
    id: remember('users', result.insertId),
    name: name || `${role} user`,
    email,
    role,
  };
}

async function createClassRecord() {
  const [result] = await db.query(
    'INSERT INTO pogil_classes (name, description, created_by) VALUES (?, ?, ?)',
    [uniqueValue('UsersClass'), 'Class for users route tests', null]
  );
  return remember('classes', result.insertId);
}

async function createCourse({ instructorId, classId, code = uniqueValue('USR').toUpperCase() }) {
  const [result] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['Users Course', code, 'A', 'fall', 2026, instructorId, classId]
  );
  return remember('courses', result.insertId);
}

async function createActivity({ classId, createdBy }) {
  const [result] = await db.query(
    `INSERT INTO pogil_activities (name, title, sheet_url, class_id, order_index, created_by, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uniqueValue('users-activity').toLowerCase(),
      uniqueValue('Users Activity Title'),
      'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit',
      classId,
      1,
      createdBy ?? null,
      0,
    ]
  );
  return remember('activities', result.insertId);
}

async function createInstance({
  activityId,
  courseId,
  groupNumber = 1,
  progressStatus = 'in_progress',
}) {
  const [result] = await db.query(
    `INSERT INTO activity_instances
       (activity_id, course_id, status, group_number, progress_status)
     VALUES (?, ?, 'in_progress', ?, ?)`,
    [activityId, courseId, groupNumber, progressStatus]
  );
  return remember('instances', result.insertId);
}

async function addGroupMember({
  instanceId,
  studentId,
  role = 'facilitator',
  connected = false,
  lastHeartbeat = null,
}) {
  await db.query(
    `INSERT INTO group_members (activity_instance_id, student_id, role, connected, last_heartbeat)
     VALUES (?, ?, ?, ?, ?)`,
    [instanceId, studentId, role, connected ? 1 : 0, lastHeartbeat]
  );
}

function createSessionStore(sessionRows) {
  return {
    all(callback) {
      callback(null, sessionRows);
    },
  };
}

function createTestServer(user = null, sessionRows = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    req.sessionStore = createSessionStore(sessionRows);
    next();
  });
  app.use('/api/users', userRoutes);

  const server = http.createServer(app);
  server.keepAliveTimeout = 1;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((closeResolve) => {
            server.close(closeResolve);
            server.closeIdleConnections?.();
          }),
      });
    });
  });
}

async function requestJson(user, path, { method = 'GET', body, sessionRows } = {}) {
  const server = await createTestServer(user, sessionRows);
  try {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers:
        body === undefined
          ? { Connection: 'close' }
          : { 'Content-Type': 'application/json', Connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody = response.status === 204 ? null : await response.json();
    return {
      status: response.status,
      body: responseBody,
    };
  } finally {
    await server.close();
  }
}

test.before(async () => {
  await ensureSchema();
});

test.after(async () => {
  await cleanupCreatedRows();
  await db.end();
});

test('root can list all users from admin/users', async () => {
  const root = await createUser('root', 'Root Admin');
  const student = await createUser('student', 'Student User');
  const instructor = await createUser('instructor', 'Instructor User');

  const response = await requestJson(root, '/api/users/admin/users');

  assert.equal(response.status, 200);
  const ids = response.body.map((user) => Number(user.id));
  assert.ok(ids.includes(root.id));
  assert.ok(ids.includes(student.id));
  assert.ok(ids.includes(instructor.id));
});

test('non-root is forbidden from admin/users', async () => {
  const student = await createUser('student');

  const response = await requestJson(student, '/api/users/admin/users');

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: 'Root access required' });
});

test('root can update another user role', async () => {
  const root = await createUser('root');
  const student = await createUser('student');

  const response = await requestJson(root, `/api/users/admin/users/${student.id}/role`, {
    method: 'PUT',
    body: { role: 'grader' },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true });

  const [[row]] = await db.query(
    `SELECT role FROM users WHERE id = ?`,
    [student.id]
  );
  assert.equal(row.role, 'grader');
});

test('non-root cannot update user roles', async () => {
  const student = await createUser('student');
  const target = await createUser('student');

  const response = await requestJson(student, `/api/users/admin/users/${target.id}/role`, {
    method: 'PUT',
    body: { role: 'instructor' },
  });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: 'Root access required' });
});

test('get user by id returns public user fields', async () => {
  const user = await createUser('student', 'Lookup User');

  const response = await requestJson(null, `/api/users/${user.id}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    id: user.id,
    name: 'Lookup User',
    email: user.email,
    role: 'student',
  });
});

test('get user by id returns 404 for missing users', async () => {
  const response = await requestJson(null, '/api/users/99999999');

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'User not found' });
});

test('active-users returns only live-session users with running activity context', async () => {
  const root = await createUser('root', 'Root Viewer');
  const instructor = await createUser('instructor', 'Course Instructor');
  const activeStudent = await createUser('student', 'Active Student');
  const inactiveStudent = await createUser('student', 'Inactive Student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    groupNumber: 2,
    progressStatus: 'in_progress',
  });
  await addGroupMember({
    instanceId,
    studentId: activeStudent.id,
    role: 'analyst',
    connected: true,
    lastHeartbeat: '2099-01-01 12:00:00',
  });

  const response = await requestJson(root, '/api/users/admin/active-users', {
    sessionRows: {
      a: {
        userId: activeStudent.id,
        cookie: { expires: '2099-01-01T13:00:00.000Z' },
      },
      b: {
        userId: activeStudent.id,
        cookie: { expires: '2099-01-01T14:00:00.000Z' },
      },
      c: {
        userId: inactiveStudent.id,
        cookie: { expires: '2000-01-01T00:00:00.000Z' },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.users));
  assert.equal(response.body.users.length, 1);
  assert.equal(Number(response.body.users[0].id), activeStudent.id);
  assert.equal(response.body.users[0].session_count, 2);
  assert.equal(response.body.users[0].running_activities.length, 1);
  assert.equal(response.body.users[0].running_activities[0].instance_id, instanceId);
  assert.equal(response.body.users[0].running_activities[0].group_number, 2);
  assert.equal(response.body.users[0].running_activities[0].progress_status, 'in_progress');
  assert.equal(response.body.users[0].running_activities[0].activity_title != null, true);
  assert.equal(response.body.users[0].running_activities[0].course_name, 'Users Course');
  assert.match(response.body.asOf, /^\d{4}-\d{2}-\d{2}T/);
});

test('non-root is forbidden from active-users', async () => {
  const student = await createUser('student');

  const response = await requestJson(student, '/api/users/admin/active-users');

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: 'Root access required' });
});
