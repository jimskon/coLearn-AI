const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const test = require('node:test');

process.env.OPENAI_API_KEY ||= 'test-key';

const express = require('express');

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

  if (courseIds.length) {
    await db.query(`DELETE FROM course_enrollments WHERE course_id IN (?)`, [courseIds]);
  }
  if (activityIds.length) {
    await db.query(`DELETE FROM group_members WHERE activity_instance_id IN (SELECT id FROM activity_instances WHERE activity_id IN (?))`, [activityIds]);
    await db.query(`DELETE FROM activity_instances WHERE activity_id IN (?)`, [activityIds]);
  }
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
    CREATE TABLE IF NOT EXISTS course_enrollments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      course_id INT NOT NULL,
      student_id INT NOT NULL
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
      ADD COLUMN IF NOT EXISTS total_groups INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS completed_groups INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS progress_status VARCHAR(32) NOT NULL DEFAULT 'not_started',
      ADD COLUMN IF NOT EXISTS section_timer_key VARCHAR(64) NULL,
      ADD COLUMN IF NOT EXISTS section_timer_duration_minutes INT NULL,
      ADD COLUMN IF NOT EXISTS section_timer_started_at DATETIME NULL,
      ADD COLUMN IF NOT EXISTS section_timer_paused TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS section_timer_paused_at DATETIME NULL,
      ADD COLUMN IF NOT EXISTS active_rotation_mode VARCHAR(16) NOT NULL DEFAULT 'submit',
      ADD COLUMN IF NOT EXISTS test_start_at DATETIME NULL,
      ADD COLUMN IF NOT EXISTS test_duration_minutes INT NULL,
      ADD COLUMN IF NOT EXISTS test_reopen_until DATETIME NULL,
      ADD COLUMN IF NOT EXISTS submitted_at DATETIME NULL,
      ADD COLUMN IF NOT EXISTS graded_at DATETIME NULL,
      ADD COLUMN IF NOT EXISTS review_complete TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reviewed_at DATETIME NULL,
      ADD COLUMN IF NOT EXISTS points_earned DECIMAL(10,2) NULL,
      ADD COLUMN IF NOT EXISTS points_possible DECIMAL(10,2) NULL,
      ADD COLUMN IF NOT EXISTS locked_before_start TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_after_end TINYINT(1) NOT NULL DEFAULT 0
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

async function createUser(role = 'student') {
  const email = `${uniqueValue(role)}@example.com`;
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [`${role} user`, email, 'not-used', role]
  );
  return { id: remember('users', result.insertId), role, email, name: `${role} user` };
}

async function createClassRecord() {
  const [result] = await db.query(
    'INSERT INTO pogil_classes (name, description, created_by) VALUES (?, ?, ?)',
    [uniqueValue('ActivityTypeClass'), 'Class for activity type route tests', null]
  );
  return remember('classes', result.insertId);
}

async function createCourse({ instructorId, classId }) {
  const [result] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uniqueValue('Activity Type Course'),
      uniqueValue('AT').toUpperCase(),
      'A',
      'fall',
      2026,
      instructorId,
      classId,
    ]
  );
  return remember('courses', result.insertId);
}

async function enroll(courseId, studentId) {
  await db.query(
    'INSERT INTO course_enrollments (course_id, student_id) VALUES (?, ?)',
    [courseId, studentId]
  );
}

async function createActivity({ classId, title, sheetUrl, isTest = null, orderIndex = 1 }) {
  const [result] = await db.query(
    `INSERT INTO pogil_activities (name, title, sheet_url, class_id, order_index, created_by, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uniqueValue('activity').toLowerCase(), title, sheetUrl, classId, orderIndex, null, isTest]
  );
  return remember('activities', result.insertId);
}

function createDocBodyLines(lines) {
  return {
    data: {
      body: {
        content: lines.map((line) => ({
          paragraph: {
            elements: [{ textRun: { content: `${line}\n` } }],
          },
        })),
      },
    },
  };
}

function loadRouters({ docsById = {} } = {}) {
  const googleAuthPath = require.resolve('../utils/googleAuth');
  const courseRoutesPath = require.resolve('../courses/routes');
  const activityInstanceRoutesPath = require.resolve('../activity_instances/routes');

  const fakeGoogleApis = {
    google: {
      docs: () => ({
        documents: {
          get: async ({ documentId }) => {
            const lines = docsById[documentId];
            if (!lines) throw new Error(`No stubbed doc for ${documentId}`);
            return createDocBodyLines(lines);
          },
        },
      }),
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'googleapis') {
      return fakeGoogleApis;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[googleAuthPath];
  delete require.cache[courseRoutesPath];
  delete require.cache[activityInstanceRoutesPath];

  const googleAuth = require(googleAuthPath);
  const originalAuthorize = googleAuth.authorize;
  googleAuth.authorize = () => ({ fake: true });

  let courseRoutes;
  let activityInstanceRoutes;
  courseRoutes = require(courseRoutesPath);
  activityInstanceRoutes = require(activityInstanceRoutesPath);

  return {
    courseRoutes,
    activityInstanceRoutes,
    restore() {
      Module._load = originalLoad;
      googleAuth.authorize = originalAuthorize;
      delete require.cache[googleAuthPath];
      delete require.cache[courseRoutesPath];
      delete require.cache[activityInstanceRoutesPath];
    },
  };
}

function createTestServer(user, overrides = {}) {
  const { courseRoutes, activityInstanceRoutes, restore } = loadRouters(overrides);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/courses', courseRoutes);
  app.use('/api/activity-instances', activityInstanceRoutes);

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
            server.close(() => {
              restore();
              closeResolve();
            });
            server.closeIdleConnections?.();
          }),
      });
    });
  });
}

async function requestJson(user, path, { method = 'GET', body, overrides } = {}) {
  const server = await createTestServer(user, overrides);
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

test('course activities returns canonical activity_type values inferred from source docs', async () => {
  await ensureSchema();

  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });

  const demoDocId = 'demoDoc12345678901234567890';
  const testDocId = 'testDoc12345678901234567890';
  const groupDocId = 'groupDoc1234567890123456789';

  await createActivity({
    classId,
    title: 'Demo Activity',
    sheetUrl: `https://docs.google.com/document/d/${demoDocId}/edit`,
    isTest: 0,
    orderIndex: 1,
  });
  await createActivity({
    classId,
    title: 'Test Activity',
    sheetUrl: `https://docs.google.com/document/d/${testDocId}/edit`,
    isTest: 0,
    orderIndex: 2,
  });
  await createActivity({
    classId,
    title: 'Group Activity',
    sheetUrl: `https://docs.google.com/document/d/${groupDocId}/edit`,
    isTest: 1,
    orderIndex: 3,
  });

  const response = await requestJson(instructor, `/api/courses/${courseId}/activities`, {
    overrides: {
      docsById: {
        [demoDocId]: ['\\title{Demo}', '\\mode{demo}', '\\questiongroup{One}'],
        [testDocId]: ['\\title{Test}', '\\mode{test}', '\\questiongroup{One}'],
        [groupDocId]: ['\\title{Group}', '\\mode{group}', '\\questiongroup{One}'],
      },
    },
  });

  assert.equal(response.status, 200);
  const byTitle = new Map(response.body.map((row) => [row.title, row]));
  assert.equal(byTitle.get('Demo Activity')?.activity_type, 'demo');
  assert.equal(byTitle.get('Test Activity')?.activity_type, 'test');
  assert.equal(byTitle.get('Group Activity')?.activity_type, 'group');
});

test('student course activities include demos without groups and classify them as demo', async () => {
  await ensureSchema();

  const instructor = await createUser('instructor');
  const student = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  await enroll(courseId, student.id);

  const demoDocId = 'studentVisibleDemo12345678901234';
  const groupDocId = 'studentVisibleGroup1234567890123';

  await createActivity({
    classId,
    title: 'Student Demo Visible',
    sheetUrl: `https://docs.google.com/document/d/${demoDocId}/edit`,
    isTest: 0,
    orderIndex: 1,
  });
  const groupActivityId = await createActivity({
    classId,
    title: 'Student Group Hidden Without Groups',
    sheetUrl: `https://docs.google.com/document/d/${groupDocId}/edit`,
    isTest: 0,
    orderIndex: 2,
  });

  const response = await requestJson(student, `/api/courses/${courseId}/activities`, {
    overrides: {
      docsById: {
        [demoDocId]: ['\\title{Student Demo Visible}', '\\mode{demo}', '\\questiongroup{One}'],
        [groupDocId]: ['\\title{Student Group Hidden Without Groups}', '\\mode{group}', '\\questiongroup{One}'],
      },
    },
  });

  assert.equal(response.status, 200);
  const byTitle = new Map(response.body.map((row) => [row.title, row]));
  assert.equal(byTitle.get('Student Demo Visible')?.activity_type, 'demo');
  assert.equal(byTitle.get('Student Demo Visible')?.has_groups, false);
  assert.equal(byTitle.has('Student Group Hidden Without Groups'), false);

  const openDemo = await requestJson(
    student,
    `/api/activity-instances/by-activity/${courseId}/${byTitle.get('Student Demo Visible').activity_id}/demo-instance`,
    {
      method: 'POST',
      overrides: {
        docsById: {
          [demoDocId]: ['\\title{Student Demo Visible}', '\\mode{demo}', '\\questiongroup{One}'],
        },
      },
    }
  );

  assert.equal(openDemo.status, 201);
  assert.equal(typeof openDemo.body.instanceId, 'number');

  const [[instanceRow]] = await db.query(
    `SELECT course_id, activity_id, active_student_id
       FROM activity_instances
      WHERE id = ?`,
    [openDemo.body.instanceId]
  );
  assert.equal(Number(instanceRow.course_id), courseId);
  assert.equal(Number(instanceRow.activity_id), byTitle.get('Student Demo Visible').activity_id);
  assert.equal(Number(instanceRow.active_student_id), student.id);
});

test('demo-instance creates a personal instance once and reuses it on repeat opens', async () => {
  await ensureSchema();

  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });

  const demoDocId = 'reuseDemo123456789012345678';
  const activityId = await createActivity({
    classId,
    title: 'Reusable Demo',
    sheetUrl: `https://docs.google.com/document/d/${demoDocId}/edit`,
    isTest: 0,
  });

  const first = await requestJson(
    instructor,
    `/api/activity-instances/by-activity/${courseId}/${activityId}/demo-instance`,
    {
      method: 'POST',
      overrides: {
        docsById: {
          [demoDocId]: ['\\title{Reusable Demo}', '\\mode{demo}', '\\questiongroup{One}'],
        },
      },
    }
  );

  assert.equal(first.status, 201);
  assert.equal(typeof first.body.instanceId, 'number');
  assert.equal(first.body.created, true);

  const second = await requestJson(
    instructor,
    `/api/activity-instances/by-activity/${courseId}/${activityId}/demo-instance`,
    {
      method: 'POST',
      overrides: {
        docsById: {
          [demoDocId]: ['\\title{Reusable Demo}', '\\mode{demo}', '\\questiongroup{One}'],
        },
      },
    }
  );

  assert.equal(second.status, 200);
  assert.equal(second.body.instanceId, first.body.instanceId);
  assert.equal(second.body.created, false);

  const [[instanceRow]] = await db.query(
    `SELECT course_id, activity_id, active_student_id
       FROM activity_instances
      WHERE id = ?`,
    [first.body.instanceId]
  );
  assert.equal(Number(instanceRow.course_id), courseId);
  assert.equal(Number(instanceRow.activity_id), activityId);
  assert.equal(Number(instanceRow.active_student_id), instructor.id);

  const [members] = await db.query(
    `SELECT student_id
       FROM group_members
      WHERE activity_instance_id = ?`,
    [first.body.instanceId]
  );
  assert.deepEqual(members.map((row) => Number(row.student_id)), [instructor.id]);
});

test('demo-instance rejects non-demo activities and unenrolled students', async () => {
  await ensureSchema();

  const instructor = await createUser('instructor');
  const enrolledStudent = await createUser('student');
  const outsider = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  await enroll(courseId, enrolledStudent.id);

  const groupDocId = 'groupOnly123456789012345678';
  const groupActivityId = await createActivity({
    classId,
    title: 'Not A Demo',
    sheetUrl: `https://docs.google.com/document/d/${groupDocId}/edit`,
    isTest: 0,
  });

  const nonDemo = await requestJson(
    instructor,
    `/api/activity-instances/by-activity/${courseId}/${groupActivityId}/demo-instance`,
    {
      method: 'POST',
      overrides: {
        docsById: {
          [groupDocId]: ['\\title{Not A Demo}', '\\mode{group}', '\\questiongroup{One}'],
        },
      },
    }
  );

  assert.equal(nonDemo.status, 400);
  assert.deepEqual(nonDemo.body, { error: 'This activity is not a demo.' });

  const demoDocId = 'studentDemo123456789012345678';
  const demoActivityId = await createActivity({
    classId,
    title: 'Student Demo',
    sheetUrl: `https://docs.google.com/document/d/${demoDocId}/edit`,
    isTest: 0,
  });

  const forbidden = await requestJson(
    outsider,
    `/api/activity-instances/by-activity/${courseId}/${demoActivityId}/demo-instance`,
    {
      method: 'POST',
      overrides: {
        docsById: {
          [demoDocId]: ['\\title{Student Demo}', '\\mode{demo}', '\\questiongroup{One}'],
        },
      },
    }
  );

  assert.equal(forbidden.status, 403);
  assert.deepEqual(forbidden.body, { error: 'Student is not enrolled in this course.' });

  const allowed = await requestJson(
    enrolledStudent,
    `/api/activity-instances/by-activity/${courseId}/${demoActivityId}/demo-instance`,
    {
      method: 'POST',
      overrides: {
        docsById: {
          [demoDocId]: ['\\title{Student Demo}', '\\mode{demo}', '\\questiongroup{One}'],
        },
      },
    }
  );

  assert.equal(allowed.status, 201);
  assert.equal(allowed.body.created, true);
});
