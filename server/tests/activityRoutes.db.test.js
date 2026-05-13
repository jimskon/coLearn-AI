const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const activityRoutes = require('../activities/routes');
const db = require('../db');

function uniqueValue(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const created = {
  users: new Set(),
  classes: new Set(),
  courses: new Set(),
  activities: new Set(),
};

function remember(kind, id) {
  const numericId = Number(id);
  if (Number.isFinite(numericId)) created[kind].add(numericId);
  return numericId;
}

async function cleanupCreatedRows() {
  const activityIds = [...created.activities];
  const courseIds = [...created.courses];
  const classIds = [...created.classes];
  const userIds = [...created.users];

  if (activityIds.length) {
    await db.query(`DELETE FROM activity_instances WHERE activity_id IN (?)`, [activityIds]);
    await db.query(`DELETE FROM pogil_activities WHERE id IN (?)`, [activityIds]);
  }
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
    ALTER TABLE pogil_activities
      MODIFY COLUMN source_type VARCHAR(16) NOT NULL DEFAULT 'remote',
      MODIFY COLUMN content_text LONGTEXT DEFAULT NULL
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
}

async function createUser(role = 'instructor', name = null) {
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
    [uniqueValue('ActivitiesClass'), 'Class for activities route tests', null]
  );
  return remember('classes', result.insertId);
}

async function createCourse({ instructorId, classId, code = uniqueValue('ACT').toUpperCase() }) {
  const [result] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['Activities Course', code, 'A', 'fall', 2026, instructorId, classId]
  );
  return remember('courses', result.insertId);
}

async function insertActivity({
  name = uniqueValue('activity').toLowerCase(),
  title = 'Activities Test Title',
  sheetUrl = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit',
  classId,
  createdBy,
  orderIndex = 0,
  isTest = 0,
}) {
  const [result] = await db.query(
    `INSERT INTO pogil_activities
       (name, title, sheet_url, class_id, order_index, created_by, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, title, sheetUrl, classId, orderIndex, createdBy, isTest]
  );
  return {
    id: remember('activities', result.insertId),
    name,
    title,
    sheet_url: sheetUrl,
    class_id: classId,
    created_by: createdBy,
    order_index: orderIndex,
    is_test: isTest,
  };
}

function createTestServer(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/activities', activityRoutes);

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

test('activity storage columns default existing-style inserts to remote with no local content', async () => {
  const creator = await createUser('creator');
  const classId = await createClassRecord();
  const activity = await insertActivity({ classId, createdBy: creator.id });

  const [[row]] = await db.query(
    `SELECT source_type, content_text
       FROM pogil_activities
      WHERE id = ?`,
    [activity.id]
  );

  assert.equal(row.source_type, 'remote');
  assert.equal(row.content_text, null);
});

test('getActivitySource returns stored local content without reading Google Docs', async () => {
  const creator = await createUser('creator');
  const classId = await createClassRecord();
  const activity = await insertActivity({ classId, createdBy: creator.id });
  const contentText = [
    '\\title{Local Activity}',
    '\\mode{group}',
    '',
    '\\questiongroup{One}',
    '\\question{What do you notice?}',
  ].join('\n');

  await db.query(
    `UPDATE pogil_activities
        SET source_type = 'local',
            content_text = ?
      WHERE id = ?`,
    [contentText, activity.id]
  );

  const response = await requestJson(null, `/api/activities/${activity.id}/source`);

  assert.equal(response.status, 200);
  assert.equal(response.body.activity_id, activity.id);
  assert.equal(response.body.source_type, 'local');
  assert.deepEqual(response.body.lines, contentText.split('\n'));
  assert.equal(response.body.text, contentText);
});

test('createActivity inserts a new activity and returns its payload', async () => {
  const creator = await createUser('creator');
  const classId = await createClassRecord();
  const name = uniqueValue('new-activity').toLowerCase();

  const response = await requestJson(creator, '/api/activities', {
    method: 'POST',
    body: {
      name,
      title: 'Created Activity',
      sheet_url: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit',
      createdBy: creator.id,
      class_id: classId,
      order_index: 4,
    },
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    name,
    title: 'Created Activity',
    sheet_url: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit',
    createdBy: creator.id,
    class_id: classId,
    order_index: 4,
  });

  const [[row]] = await db.query(
    `SELECT name, title, sheet_url, class_id, created_by, order_index
     FROM pogil_activities WHERE name = ?`,
    [name]
  );
  assert.equal(row.name, name);
  assert.equal(row.title, 'Created Activity');
  assert.equal(row.sheet_url, 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit');
  assert.equal(Number(row.class_id), classId);
  assert.equal(Number(row.created_by), creator.id);
  assert.equal(Number(row.order_index), 4);
});

test('createActivity rejects requests missing required fields', async () => {
  const creator = await createUser('creator');
  const classId = await createClassRecord();

  const response = await requestJson(creator, '/api/activities', {
    method: 'POST',
    body: {
      name: uniqueValue('bad-activity').toLowerCase(),
      title: 'Missing URL',
      createdBy: creator.id,
      class_id: classId,
    },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Missing required fields' });
});

test('getAllActivities returns inserted activities', async () => {
  const creator = await createUser('creator');
  const classId = await createClassRecord();
  const activity = await insertActivity({
    name: uniqueValue('list-activity').toLowerCase(),
    title: 'Listable Activity',
    classId,
    createdBy: creator.id,
    orderIndex: 2,
  });

  const response = await requestJson(creator, '/api/activities');

  assert.equal(response.status, 200);
  const rows = Array.isArray(response.body?.[0]) ? response.body[0] : response.body;
  const found = rows.find((row) => Number(row.id) === activity.id);
  assert.ok(found);
  assert.equal(found.name, activity.name);
  assert.equal(found.title, 'Listable Activity');
});

test('getActivity returns one activity object and 404s when missing', async () => {
  const creator = await createUser('creator');
  const classId = await createClassRecord();
  const activity = await insertActivity({
    name: uniqueValue('fetch-activity').toLowerCase(),
    title: 'Fetchable Activity',
    classId,
    createdBy: creator.id,
    isTest: 1,
  });

  const found = await requestJson(creator, `/api/activities/${activity.id}`);
  assert.equal(found.status, 200);
  assert.equal(found.body.id, activity.id);
  assert.equal(found.body.name, activity.name);
  assert.equal(found.body.title, 'Fetchable Activity');
  assert.equal(Number(found.body.is_test), 1);

  const missing = await requestJson(creator, '/api/activities/99999999');
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: 'Activity not found' });
});

test('setIsTest updates the activity test flag', async () => {
  const creator = await createUser('creator');
  const classId = await createClassRecord();
  const activity = await insertActivity({
    name: uniqueValue('toggle-test').toLowerCase(),
    classId,
    createdBy: creator.id,
    isTest: 0,
  });

  const response = await requestJson(creator, `/api/activities/${activity.id}/is-test`, {
    method: 'PATCH',
    body: { is_test: 1 },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { id: activity.id, is_test: 1 });

  const [[row]] = await db.query(
    `SELECT is_test FROM pogil_activities WHERE id = ?`,
    [activity.id]
  );
  assert.equal(Number(row.is_test), 1);
});

test('deleteActivity removes an activity by its route name parameter', async () => {
  const creator = await createUser('creator');
  const classId = await createClassRecord();
  const activity = await insertActivity({
    name: uniqueValue('delete-me').toLowerCase(),
    classId,
    createdBy: creator.id,
  });

  const response = await requestJson(creator, `/api/activities/${activity.name}`, {
    method: 'DELETE',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { message: 'Activity deleted.' });

  const [[count]] = await db.query(
    `SELECT COUNT(*) AS count FROM pogil_activities WHERE id = ?`,
    [activity.id]
  );
  assert.equal(Number(count.count), 0);
});

test('launchActivityInstance resolves an activity by name and creates an instance row', async () => {
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activity = await insertActivity({
    name: uniqueValue('launchable').toLowerCase(),
    classId,
    createdBy: instructor.id,
  });

  const response = await requestJson(instructor, `/api/activities/${activity.name}/launch`, {
    method: 'POST',
    body: { courseId, groupNumber: 3 },
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { message: 'Activity instance launched.' });

  const [[row]] = await db.query(
    `SELECT activity_id, course_id, group_number
     FROM activity_instances
     WHERE activity_id = ? AND course_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [activity.id, courseId]
  );
  assert.equal(Number(row.activity_id), activity.id);
  assert.equal(Number(row.course_id), courseId);
  assert.equal(Number(row.group_number), 3);
});
