const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const courseRoutes = require('../courses/routes');
const db = require('../db');

function uniqueValue(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createUser(role = 'student') {
  const email = `${uniqueValue(role)}@example.com`;
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [`${role} user`, email, 'not-used', role]
  );
  return {
    id: Number(result.insertId),
    name: `${role} user`,
    email,
    role,
  };
}

async function createClassRecord() {
  const [result] = await db.query(
    'INSERT INTO pogil_classes (name, description, created_by) VALUES (?, ?, ?)',
    [uniqueValue('Course Class'), 'Class for course route tests', null]
  );
  return Number(result.insertId);
}

function createTestServer(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/courses', courseRoutes);

  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(closeResolve => server.close(closeResolve)),
      });
    });
  });
}

async function requestJson(user, path, { method = 'GET', body } = {}) {
  const server = await createTestServer(user);
  try {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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

async function createCourse({ instructor, classId, code = uniqueValue('CS').toUpperCase() }) {
  const response = await requestJson(instructor, '/api/courses', {
    method: 'POST',
    body: {
      name: 'Intro to Collaborative Computing',
      code,
      section: 'A',
      semester: 'fall',
      year: 2026,
      instructor_id: instructor.id,
      class_id: classId,
    },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(typeof response.body.courseId, 'number');
  return response.body.courseId;
}

test.after(async () => {
  await db.end();
});

test('course routes create a course and auto-enroll the instructor', async () => {
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const code = uniqueValue('CS101').toUpperCase();

  const courseId = await createCourse({ instructor, classId, code });

  const info = await requestJson(instructor, `/api/courses/${courseId}/info`);
  assert.equal(info.status, 200);
  assert.equal(info.body.id, courseId);
  assert.equal(info.body.name, 'Intro to Collaborative Computing');
  assert.equal(info.body.code, code);
  assert.equal(info.body.instructor_id, instructor.id);

  const students = await requestJson(instructor, `/api/courses/${courseId}/students`);
  assert.equal(students.status, 200);
  assert.ok(students.body.some(student => student.id === instructor.id && student.role === 'instructor'));
});

test('course creation rejects duplicate code section semester and year', async () => {
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const code = uniqueValue('CS101').toUpperCase();
  const body = {
    name: 'Intro to Collaborative Computing',
    code,
    section: 'A',
    semester: 'fall',
    year: 2026,
    instructor_id: instructor.id,
    class_id: classId,
  };

  const created = await requestJson(instructor, '/api/courses', {
    method: 'POST',
    body,
  });
  assert.equal(created.status, 201);

  const duplicate = await requestJson(instructor, '/api/courses', {
    method: 'POST',
    body,
  });

  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.body, {
    error: 'An instance with that join code, section, semester, and year already exists',
  });
});

test('root user can list courses with class and instructor names', async () => {
  const root = await createUser('root');
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const code = uniqueValue('CS102').toUpperCase();

  const courseId = await createCourse({ instructor, classId, code });

  const list = await requestJson(root, '/api/courses');
  assert.equal(list.status, 200);

  const course = list.body.find(row => row.id === courseId);
  assert.ok(course);
  assert.equal(course.code, code);
  assert.equal(course.instructor_name, instructor.name);
  assert.match(course.class_name, /^Course Class-/);
});

test('enroll-by-code enrolls a student, lists enrollment, and rejects duplicates', async () => {
  const instructor = await createUser('instructor');
  const student = await createUser('student');
  const classId = await createClassRecord();
  const code = uniqueValue('CS103').toUpperCase();
  const courseId = await createCourse({ instructor, classId, code });

  const enroll = await requestJson(student, '/api/courses/enroll-by-code', {
    method: 'POST',
    body: {
      userId: student.id,
      code,
    },
  });

  assert.equal(enroll.status, 201);
  assert.equal(enroll.body.success, true);
  assert.equal(enroll.body.newCourse.id, courseId);
  assert.equal(enroll.body.newCourse.code, code);

  const duplicate = await requestJson(student, '/api/courses/enroll-by-code', {
    method: 'POST',
    body: {
      userId: student.id,
      code,
    },
  });
  assert.equal(duplicate.status, 400);
  assert.deepEqual(duplicate.body, { error: 'Already joined this instance' });

  const enrollments = await requestJson(student, `/api/courses/user/${student.id}/enrollments`);
  assert.equal(enrollments.status, 200);
  assert.ok(enrollments.body.some(course => course.id === courseId && course.code === code));

  const students = await requestJson(instructor, `/api/courses/${courseId}/students`);
  assert.equal(students.status, 200);
  assert.ok(students.body.some(row => row.id === student.id && row.role === 'student'));
});

test('enroll-by-code returns 404 for an unknown course code', async () => {
  const student = await createUser('student');

  const response = await requestJson(student, '/api/courses/enroll-by-code', {
    method: 'POST',
    body: {
      userId: student.id,
      code: uniqueValue('MISSING').toUpperCase(),
    },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'Join code not found' });
});

test('course owner can unenroll a student from a course', async () => {
  const instructor = await createUser('instructor');
  const student = await createUser('student');
  const classId = await createClassRecord();
  const code = uniqueValue('CS104').toUpperCase();
  const courseId = await createCourse({ instructor, classId, code });

  const enroll = await requestJson(student, '/api/courses/enroll-by-code', {
    method: 'POST',
    body: {
      userId: student.id,
      code,
    },
  });
  assert.equal(enroll.status, 201);

  const remove = await requestJson(instructor, `/api/courses/${courseId}/unenroll/${student.id}`, {
    method: 'DELETE',
  });
  assert.equal(remove.status, 200);
  assert.deepEqual(remove.body, { success: true });

  const students = await requestJson(instructor, `/api/courses/${courseId}/students`);
  assert.equal(students.status, 200);
  assert.ok(!students.body.some(row => row.id === student.id));
});

test('non-owner cannot delete a course, but owner can delete it', async () => {
  const instructor = await createUser('instructor');
  const otherInstructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructor, classId });

  const forbidden = await requestJson(otherInstructor, `/api/courses/${courseId}`, {
    method: 'DELETE',
  });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(forbidden.body, { error: 'Unauthorized to delete this instance' });

  const remove = await requestJson(instructor, `/api/courses/${courseId}`, {
    method: 'DELETE',
  });
  assert.equal(remove.status, 200);
  assert.deepEqual(remove.body, { success: true });

  const info = await requestJson(instructor, `/api/courses/${courseId}/info`);
  assert.equal(info.status, 404);
  assert.deepEqual(info.body, { error: 'Instance not found' });
});
