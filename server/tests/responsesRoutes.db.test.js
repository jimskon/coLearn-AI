const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OPENAI_API_KEY ||= 'test-key';

const express = require('express');

const aiController = require('../ai/controller');
aiController.evaluateCode = async () => ({ feedback: 'Mock AI feedback' });

const responseRoutes = require('../responses/routes');
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
    await db.query(`DELETE FROM response_drafts WHERE activity_instance_id IN (?)`, [instanceIds]);
    await db.query(`DELETE FROM responses WHERE activity_instance_id IN (?)`, [instanceIds]);
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
      class_id INT NOT NULL,
      order_index INT NOT NULL DEFAULT 0,
      created_by INT DEFAULT NULL,
      last_loaded TIMESTAMP NULL DEFAULT NULL,
      is_test TINYINT(1) DEFAULT NULL
    )
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
    CREATE TABLE IF NOT EXISTS responses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      activity_instance_id INT NOT NULL,
      question_id VARCHAR(64) NOT NULL,
      submit_id CHAR(36) NULL,
      response_type VARCHAR(32) NOT NULL DEFAULT 'text',
      response MEDIUMTEXT NULL,
      answered_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_resp_instance_qid (activity_instance_id, question_id, id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS response_drafts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      activity_instance_id INT NOT NULL,
      question_id VARCHAR(64) NOT NULL,
      response_type VARCHAR(32) NOT NULL DEFAULT 'text',
      response MEDIUMTEXT NULL,
      answered_by_user_id INT NOT NULL,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_draft (activity_instance_id, question_id)
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
    [uniqueValue('ResponsesClass'), 'Class for responses route tests', null]
  );
  return remember('classes', result.insertId);
}

async function createCourse({ instructorId, classId, code = uniqueValue('RSP').toUpperCase() }) {
  const [result] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['Responses Course', code, 'A', 'fall', 2026, instructorId, classId]
  );
  return remember('courses', result.insertId);
}

async function createActivity({ classId, createdBy }) {
  const [result] = await db.query(
    `INSERT INTO pogil_activities (name, title, sheet_url, class_id, order_index, created_by, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uniqueValue('responses-activity').toLowerCase(),
      uniqueValue('Responses Activity Title'),
      'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit',
      classId,
      1,
      createdBy ?? null,
      0,
    ]
  );
  return remember('activities', result.insertId);
}

async function createInstance({ activityId, courseId, status = 'in_progress' }) {
  const [result] = await db.query(
    `INSERT INTO activity_instances (activity_id, course_id, status)
     VALUES (?, ?, ?)`,
    [activityId, courseId, status]
  );
  return remember('instances', result.insertId);
}

async function createFixture() {
  const instructor = await createUser('instructor');
  const student = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId });

  return {
    instructor,
    student,
    classId,
    courseId,
    activityId,
    instanceId,
  };
}

function createTestServer(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/responses', responseRoutes);

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

async function requestJson(user, path, { method = 'GET', body } = {}) {
  const server = await createTestServer(user);
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

test('single draft save upserts text responses by question id', async () => {
  const { student, instanceId } = await createFixture();

  const first = await requestJson(student, '/api/responses', {
    method: 'POST',
    body: {
      instanceId,
      questionId: '1a',
      responseText: 'first draft',
      answeredBy: student.id,
    },
  });

  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { success: true });

  const second = await requestJson(student, '/api/responses', {
    method: 'POST',
    body: {
      instanceId,
      questionId: '1a',
      responseText: 'updated draft',
      answeredBy: student.id,
    },
  });

  assert.equal(second.status, 200);

  const [rows] = await db.query(
    `SELECT question_id, response, response_type, answered_by_user_id
     FROM response_drafts
     WHERE activity_instance_id = ? AND question_id = ?`,
    [instanceId, '1a']
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].response, 'updated draft');
  assert.equal(rows[0].response_type, 'text');
  assert.equal(Number(rows[0].answered_by_user_id), student.id);
});

test('single draft save rejects invalid question ids', async () => {
  const { student, instanceId } = await createFixture();

  const response = await requestJson(student, '/api/responses', {
    method: 'POST',
    body: {
      instanceId,
      questionId: 'not a qid',
      responseText: 'bad',
      answeredBy: student.id,
    },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /Invalid question_id/);
});

test('code draft save stores python draft and returns mocked AI feedback', async () => {
  const { student, instanceId } = await createFixture();

  const response = await requestJson(student, '/api/responses/code', {
    method: 'POST',
    body: {
      activity_instance_id: instanceId,
      question_id: '1acode1',
      user_id: student.id,
      response: 'print("hello")',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.feedback, 'Mock AI feedback');

  const [[draft]] = await db.query(
    `SELECT response, response_type, answered_by_user_id
     FROM response_drafts
     WHERE activity_instance_id = ? AND question_id = ?`,
    [instanceId, '1acode1']
  );
  assert.equal(draft.response, 'print("hello")');
  assert.equal(draft.response_type, 'python');
  assert.equal(Number(draft.answered_by_user_id), student.id);
});

test('bulk-save upserts multiple valid text drafts and reports saved count', async () => {
  const { student, instanceId } = await createFixture();

  const response = await requestJson(student, '/api/responses/bulk-save', {
    method: 'POST',
    body: {
      instanceId,
      userId: student.id,
      answers: {
        '1b': 'beta',
        '1a': 'alpha',
        '1aS': 'complete',
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, saved: 3 });

  const [rows] = await db.query(
    `SELECT question_id, response
     FROM response_drafts
     WHERE activity_instance_id = ?
     ORDER BY question_id`,
    [instanceId]
  );
  assert.deepEqual(
    rows.map((row) => [row.question_id, row.response]),
    [
      ['1a', 'alpha'],
      ['1aS', 'complete'],
      ['1b', 'beta'],
    ]
  );
});

test('bulk-save rejects invalid question ids before writing drafts', async () => {
  const { student, instanceId } = await createFixture();

  const response = await requestJson(student, '/api/responses/bulk-save', {
    method: 'POST',
    body: {
      instanceId,
      userId: student.id,
      answers: {
        bad: 'nope',
        '1a': 'fine',
      },
    },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /Invalid question_id/);

  const [[count]] = await db.query(
    `SELECT COUNT(*) AS count FROM response_drafts WHERE activity_instance_id = ?`,
    [instanceId]
  );
  assert.equal(Number(count.count), 0);
});

test('instance readback merges submitted responses with drafts taking precedence', async () => {
  const { student, instanceId } = await createFixture();

  await db.query(
    `INSERT INTO responses
       (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [instanceId, '1a', 'text', 'submitted answer', student.id]
  );
  await db.query(
    `INSERT INTO responses
       (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [instanceId, '1b', 'text', 'submitted only', student.id]
  );
  await db.query(
    `INSERT INTO response_drafts
       (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [instanceId, '1a', 'text', 'draft answer', student.id]
  );
  await db.query(
    `INSERT INTO response_drafts
       (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [instanceId, '1c', 'python', 'print(3)', student.id]
  );

  const response = await requestJson(student, `/api/responses/${instanceId}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body['1a'], {
    response: 'draft answer',
    type: 'text',
    python_feedback: null,
  });
  assert.deepEqual(response.body['1b'], {
    response: 'submitted only',
    type: 'text',
    python_feedback: null,
  });
  assert.deepEqual(response.body['1c'], {
    response: 'print(3)',
    type: 'python',
    python_feedback: null,
  });
});

test('group readback returns the same merged answers without python_feedback decoration', async () => {
  const { student, instanceId } = await createFixture();

  await db.query(
    `INSERT INTO responses
       (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [instanceId, '2a', 'text', 'submitted group answer', student.id]
  );
  await db.query(
    `INSERT INTO response_drafts
       (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [instanceId, '2b', 'text', 'draft-only answer', student.id]
  );

  const response = await requestJson(student, `/api/responses/${instanceId}/group`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body['2a'], {
    response: 'submitted group answer',
    type: 'text',
  });
  assert.deepEqual(response.body['2b'], {
    response: 'draft-only answer',
    type: 'text',
  });
});

test('mark-complete flips the activity instance status to completed', async () => {
  const { student, activityId, courseId } = await createFixture();
  const instanceId = await createInstance({ activityId, courseId, status: 'in_progress' });

  const response = await requestJson(student, '/api/responses/mark-complete', {
    method: 'POST',
    body: { instanceId },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true });

  const [[instance]] = await db.query(
    `SELECT status FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(instance.status, 'completed');
});
