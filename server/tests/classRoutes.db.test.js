const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const classRoutes = require('../classes/routes');
const db = require('../db');

function uniqueName(prefix) {
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
  if (courseIds.length) {
    await db.query(`DELETE FROM course_enrollments WHERE course_id IN (?)`, [courseIds]);
    await db.query(`DELETE FROM activity_instances WHERE course_id IN (?)`, [courseIds]);
    await db.query(`DELETE FROM courses WHERE id IN (?)`, [courseIds]);
  }
  if (classIds.length) {
    await db.query(`DELETE FROM pogil_classes WHERE id IN (?)`, [classIds]);
  }
  if (userIds.length) {
    await db.query(`DELETE FROM users WHERE id IN (?)`, [userIds]);
  }
}

async function createUser(role = 'student') {
  const email = `${uniqueName(role)}@example.com`;
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [`${role} user`, email, 'not-used', role]
  );
  return remember('users', result.insertId);
}

async function createClassRecord() {
  const [result] = await db.query(
    'INSERT INTO pogil_classes (name, description, created_by) VALUES (?, ?, ?)',
    [uniqueName('Class'), 'Class for route tests', null]
  );
  return remember('classes', result.insertId);
}

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/classes', classRoutes);

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

async function requestJson(path, { method = 'GET', body } = {}) {
  const server = await createTestServer();
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

test.after(async () => {
  await cleanupCreatedRows();
  await db.end();
});

test('class routes create, list, update, fetch, and delete a class', async () => {
  const name = uniqueName('Intro CS');
  const description = 'Collaborative intro course';

  const create = await requestJson('/api/classes', {
    method: 'POST',
    body: {
      name,
      description,
      createdBy: null,
    },
  });

  assert.equal(create.status, 201);
  assert.equal(create.body.name, name);
  assert.equal(create.body.description, description);
  assert.equal(create.body.created_by, null);
  assert.equal(typeof create.body.id, 'number');
  remember('classes', create.body.id);

  const list = await requestJson('/api/classes');
  assert.equal(list.status, 200);
  assert.ok(list.body.some(row => row.id === create.body.id && row.name === name));

  const updatedName = `${name} Updated`;
  const updatedDescription = 'Updated collaborative intro course';
  const update = await requestJson(`/api/classes/${create.body.id}`, {
    method: 'PUT',
    body: {
      name: updatedName,
      description: updatedDescription,
    },
  });

  assert.equal(update.status, 200);
  assert.deepEqual(update.body, {
    id: String(create.body.id),
    name: updatedName,
    description: updatedDescription,
  });

  const fetchOne = await requestJson(`/api/classes/${create.body.id}`);
  assert.equal(fetchOne.status, 200);
  assert.equal(fetchOne.body.id, create.body.id);
  assert.equal(fetchOne.body.name, updatedName);
  assert.equal(fetchOne.body.description, updatedDescription);

  const remove = await requestJson(`/api/classes/${create.body.id}`, {
    method: 'DELETE',
  });
  assert.equal(remove.status, 204);

  const fetchDeleted = await requestJson(`/api/classes/${create.body.id}`);
  assert.equal(fetchDeleted.status, 404);
  assert.deepEqual(fetchDeleted.body, { error: 'Class not found' });
});

test('class activity routes create, list, update, and delete an activity', async () => {
  const classId = await createClassRecord();
  const creatorId = await createUser('creator');
  const activityName = uniqueName('activity').toLowerCase();

  const create = await requestJson(`/api/classes/${classId}/activities`, {
    method: 'POST',
    body: {
      name: activityName,
      title: 'Loops and Lists',
      sheet_url: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit',
      order_index: 2,
      createdBy: creatorId,
    },
  });

  assert.equal(create.status, 201);
  assert.equal(create.body.name, activityName);
  assert.equal(create.body.title, 'Loops and Lists');
  assert.equal(create.body.order_index, 2);
  assert.equal(create.body.class_id, classId);
  assert.equal(create.body.created_by, creatorId);
  assert.equal(typeof create.body.id, 'number');
  remember('activities', create.body.id);

  const list = await requestJson(`/api/classes/${classId}/activities`);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, create.body.id);
  assert.equal(list.body[0].name, activityName);

  const update = await requestJson(`/api/classes/${classId}/activities/${activityName}`, {
    method: 'PUT',
    body: {
      title: 'Loops, Lists, and Tables',
      sheet_url: 'https://docs.google.com/document/d/1BcdEfGhIjKlMnOpQrStUvWxYz1234567890A/edit',
      order_index: 5,
    },
  });

  assert.equal(update.status, 200);
  assert.deepEqual(update.body, {
    name: activityName,
    title: 'Loops, Lists, and Tables',
    sheet_url: 'https://docs.google.com/document/d/1BcdEfGhIjKlMnOpQrStUvWxYz1234567890A/edit',
    order_index: 5,
    class_id: String(classId),
  });

  const remove = await requestJson(`/api/classes/${classId}/activities/${create.body.id}`, {
    method: 'DELETE',
  });
  assert.equal(remove.status, 200);
  assert.deepEqual(remove.body, { success: true });

  const listAfterDelete = await requestJson(`/api/classes/${classId}/activities`);
  assert.equal(listAfterDelete.status, 200);
  assert.deepEqual(listAfterDelete.body, []);
});

test('activity creation rejects missing required fields before database insert', async () => {
  const classId = await createClassRecord();

  const response = await requestJson(`/api/classes/${classId}/activities`, {
    method: 'POST',
    body: {
      name: uniqueName('activity').toLowerCase(),
      title: 'Missing order and creator',
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Missing required fields');
});

test('enrollment routes enroll a student by course code and list enrollments', async () => {
  const classId = await createClassRecord();
  const instructorId = await createUser('instructor');
  const studentId = await createUser('student');
  const code = uniqueName('CS101').toUpperCase();

  const [courseResult] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['Intro CS', code, 'A', 'fall', 2026, instructorId, classId]
  );
  const courseId = remember('courses', courseResult.insertId);

  const enroll = await requestJson('/api/classes/enroll-by-code', {
    method: 'POST',
    body: {
      userId: studentId,
      code,
    },
  });

  assert.equal(enroll.status, 200);
  assert.equal(enroll.body.success, true);
  assert.equal(enroll.body.newCourse.id, courseId);
  assert.equal(enroll.body.newCourse.code, code);

  const duplicate = await requestJson('/api/classes/enroll-by-code', {
    method: 'POST',
    body: {
      userId: studentId,
      code,
    },
  });
  assert.equal(duplicate.status, 400);
  assert.deepEqual(duplicate.body, { error: 'Already joined this instance' });

  const enrollments = await requestJson(`/api/classes/user/${studentId}/enrollments`);
  assert.equal(enrollments.status, 200);
  assert.ok(enrollments.body.some(course => course.id === courseId && course.code === code));
});

test('enroll by code returns 404 for an unknown course code', async () => {
  const studentId = await createUser('student');

  const response = await requestJson('/api/classes/enroll-by-code', {
    method: 'POST',
    body: {
      userId: studentId,
      code: uniqueName('missing').toUpperCase(),
    },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'Join code not found' });
});
