const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const classRoutes = require('../classes/routes');
const db = require('../db');
const activityCreator = require('../utils/activityCreator');

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

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS pogil_classes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      description TEXT DEFAULT NULL,
      level VARCHAR(255) DEFAULT NULL,
      topic_domain VARCHAR(255) DEFAULT NULL,
      demo_mode TINYINT(1) NOT NULL DEFAULT 0,
      created_by INT DEFAULT NULL
    )
  `);

  await db.query(`
    ALTER TABLE pogil_classes
      ADD COLUMN IF NOT EXISTS level VARCHAR(255) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS topic_domain VARCHAR(255) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS demo_mode TINYINT(1) NOT NULL DEFAULT 0
  `);
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
    'INSERT INTO pogil_classes (name, description, level, topic_domain, demo_mode, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [uniqueName('Class'), 'Class for route tests', null, null, 0, null]
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
  await ensureSchema();
  const name = uniqueName('Intro CS');
  const description = 'Collaborative intro course';
  const level = 'First-year college';
  const topicDomain = 'Computer Science';
  const demoMode = true;

  const create = await requestJson('/api/classes', {
    method: 'POST',
    body: {
      name,
      description,
      level,
      topic_domain: topicDomain,
      demo_mode: demoMode,
      createdBy: null,
    },
  });

  assert.equal(create.status, 201);
  assert.equal(create.body.name, name);
  assert.equal(create.body.description, description);
  assert.equal(create.body.level, level);
  assert.equal(create.body.topic_domain, topicDomain);
  assert.equal(create.body.demo_mode, true);
  assert.equal(create.body.created_by, null);
  assert.equal(typeof create.body.id, 'number');
  remember('classes', create.body.id);

  const list = await requestJson('/api/classes');
  assert.equal(list.status, 200);
  assert.ok(list.body.some(row => row.id === create.body.id && row.name === name));

  const updatedName = `${name} Updated`;
  const updatedDescription = 'Updated collaborative intro course';
  const updatedLevel = 'Advanced undergraduate';
  const updatedTopicDomain = 'Software Development';
  const update = await requestJson(`/api/classes/${create.body.id}`, {
    method: 'PUT',
    body: {
      name: updatedName,
      description: updatedDescription,
      level: updatedLevel,
      topic_domain: updatedTopicDomain,
      demo_mode: false,
    },
  });

  assert.equal(update.status, 200);
  assert.deepEqual(update.body, {
    id: String(create.body.id),
    name: updatedName,
    description: updatedDescription,
    level: updatedLevel,
    topic_domain: updatedTopicDomain,
    demo_mode: false,
  });

  const fetchOne = await requestJson(`/api/classes/${create.body.id}`);
  assert.equal(fetchOne.status, 200);
  assert.equal(fetchOne.body.id, create.body.id);
  assert.equal(fetchOne.body.name, updatedName);
  assert.equal(fetchOne.body.description, updatedDescription);
  assert.equal(fetchOne.body.level, updatedLevel);
  assert.equal(fetchOne.body.topic_domain, updatedTopicDomain);
  assert.equal(fetchOne.body.demo_mode, 0);

  const remove = await requestJson(`/api/classes/${create.body.id}`, {
    method: 'DELETE',
  });
  assert.equal(remove.status, 204);

  const fetchDeleted = await requestJson(`/api/classes/${create.body.id}`);
  assert.equal(fetchDeleted.status, 404);
  assert.deepEqual(fetchDeleted.body, { error: 'Class not found' });
});

test('class activity routes create, list, update, and delete an activity', async () => {
  await ensureSchema();
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

  await db.query(
    `UPDATE pogil_activities
        SET remote_source_hash = 'old-remote-hash',
            remote_updated_at = NOW(3),
            last_synced_hash = 'old-sync-hash',
            last_synced_at = NOW(3)
      WHERE id = ?`,
    [create.body.id]
  );

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
    remote_link_changed: true,
  });

  const [[updatedRow]] = await db.query(
    `SELECT remote_source_hash, remote_updated_at, last_synced_hash, last_synced_at
       FROM pogil_activities WHERE id = ?`,
    [create.body.id]
  );
  assert.equal(updatedRow.remote_source_hash, null);
  assert.equal(updatedRow.remote_updated_at, null);
  assert.equal(updatedRow.last_synced_hash, null);
  assert.equal(updatedRow.last_synced_at, null);

  const remove = await requestJson(`/api/classes/${classId}/activities/${create.body.id}`, {
    method: 'DELETE',
  });
  assert.equal(remove.status, 200);
  assert.deepEqual(remove.body, { success: true });

  const listAfterDelete = await requestJson(`/api/classes/${classId}/activities`);
  assert.equal(listAfterDelete.status, 200);
  assert.deepEqual(listAfterDelete.body, []);
});

test('class activity delete also removes assigned activity instances through cascade', async () => {
  await ensureSchema();
  const classId = await createClassRecord();
  const creatorId = await createUser('creator');
  const activityName = uniqueName('assigned-activity').toLowerCase();

  const create = await requestJson(`/api/classes/${classId}/activities`, {
    method: 'POST',
    body: {
      name: activityName,
      title: 'Assigned Activity',
      sheet_url: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit',
      order_index: 1,
      createdBy: creatorId,
    },
  });

  assert.equal(create.status, 201);
  remember('activities', create.body.id);

  const [courseResult] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uniqueName('Course'), uniqueName('code'), 'A', 'fall', 2026, creatorId, classId]
  );
  const courseId = remember('courses', courseResult.insertId);

  const [instanceResult] = await db.query(
    `INSERT INTO activity_instances (activity_id, course_id, status) VALUES (?, ?, 'in_progress')`,
    [create.body.id, courseId]
  );
  const instanceId = Number(instanceResult.insertId);

  const remove = await requestJson(`/api/classes/${classId}/activities/${create.body.id}`, {
    method: 'DELETE',
  });

  assert.equal(remove.status, 200);
  assert.deepEqual(remove.body, { success: true });

  const [[activityCount]] = await db.query(
    `SELECT COUNT(*) AS count FROM pogil_activities WHERE id = ?`,
    [create.body.id]
  );
  assert.equal(Number(activityCount.count), 0);

  const [[instanceCount]] = await db.query(
    `SELECT COUNT(*) AS count FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instanceCount.count), 0);
});

test('class activity routes can create a local stored activity', async () => {
  await ensureSchema();
  const classId = await createClassRecord();
  const creatorId = await createUser('creator');
  const activityName = uniqueName('local-activity').toLowerCase();
  const contentText = '\\title{Local Upload}\\mode{group}\n\\questiongroup{One}';

  const create = await requestJson(`/api/classes/${classId}/activities`, {
    method: 'POST',
    body: {
      name: activityName,
      title: 'Local Upload',
      source_type: 'local',
      content_text: contentText,
      order_index: 1,
      createdBy: creatorId,
    },
  });

  assert.equal(create.status, 201);
  assert.equal(create.body.name, activityName);
  assert.equal(create.body.title, 'Local Upload');
  assert.equal(create.body.source_type, 'local');
  assert.equal(create.body.content_text, contentText);
  assert.equal(create.body.sheet_url, null);
  remember('activities', create.body.id);

  const [[row]] = await db.query(
    `SELECT source_type, content_text, sheet_url
       FROM pogil_activities
      WHERE id = ?`,
    [create.body.id]
  );
  assert.equal(row.source_type, 'local');
  assert.equal(row.content_text, contentText);
  assert.equal(row.sheet_url, null);
});

test('class activity routes can create an empty local activity shell', async () => {
  await ensureSchema();
  const classId = await createClassRecord();
  const creatorId = await createUser('creator');
  const activityName = uniqueName('blank-activity').toLowerCase();

  const create = await requestJson(`/api/classes/${classId}/activities`, {
    method: 'POST',
    body: {
      name: activityName,
      title: 'Blank Activity',
      source_type: 'local',
      content_text: '',
      order_index: 2,
      createdBy: creatorId,
    },
  });

  assert.equal(create.status, 201);
  assert.equal(create.body.name, activityName);
  assert.equal(create.body.title, 'Blank Activity');
  assert.equal(create.body.source_type, 'local');
  assert.equal(create.body.content_text, '');
  remember('activities', create.body.id);

  const [[row]] = await db.query(
    `SELECT source_type, content_text
       FROM pogil_activities
      WHERE id = ?`,
    [create.body.id]
  );
  assert.equal(row.source_type, 'local');
  assert.equal(row.content_text, '');
});

test('creator draft route creates a local draft from the template and class metadata', async () => {
  await ensureSchema();
  const creatorId = await createUser('creator');
  const className = uniqueName('CreatorClass');
  const [classResult] = await db.query(
    `INSERT INTO pogil_classes (name, description, level, topic_domain, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [className, 'This class focuses on collaboration and code reading.', 'First-year college', 'Computer Science', creatorId]
  );
  const classId = remember('classes', classResult.insertId);

  const originalGenerator = activityCreator.generateActivityDraft;
  let capturedInput = null;
  activityCreator.generateActivityDraft = async (input) => {
    capturedInput = input;
    return {
      text: [
        '\\title{Sorting Warmup}',
        '\\mode{demo}',
        '\\studentlevel{First-year college}',
        '\\activitycontext{Computer Science}',
        '\\section{Learning Objectives}',
        '\\questiongroup{Predictions}',
        '\\question{What do you predict insertion sort will do first?}',
        '\\textresponse{3}',
        '\\sampleresponses{Students predict the first comparison or swap.}',
        '\\feedbackprompt{Accept any reasonable prediction grounded in the problem.}',
        '\\endquestion',
        '\\endquestiongroup',
      ].join('\n'),
      generation_status: 'generated',
      generation_error: null,
    };
  };

  try {
    const create = await requestJson(`/api/classes/${classId}/creator-draft`, {
      method: 'POST',
      body: {
        title: 'Sorting Warmup',
        duration_minutes: 35,
        mode: 'demo',
        description: 'Introduce insertion sort with a small trace and one reflection prompt.',
        selected_model: 'gpt-5-mini',
        major_sections: ['Learning Objectives', 'Application', 'Reflection'],
        use_timed_sections: true,
        timed_sections: [
          { title: 'Learning Objectives', minutes: 10 },
          { title: 'Application', minutes: 15 },
          { title: 'Reflection', minutes: 10 },
        ],
        retries_required: 3,
        createdBy: creatorId,
      },
    });

    assert.equal(create.status, 201);
    assert.equal(create.body.title, 'Sorting Warmup');
    assert.equal(create.body.source_type, 'local');
    assert.equal(create.body.mode, 'demo');
    assert.equal(create.body.duration_minutes, 35);
    assert.equal(create.body.selected_model, 'gpt-5-mini');
    assert.deepEqual(create.body.major_sections, ['Learning Objectives', 'Application', 'Reflection']);
    assert.equal(create.body.use_timed_sections, true);
    assert.deepEqual(create.body.timed_sections, [
      { title: 'Learning Objectives', minutes: 10 },
      { title: 'Application', minutes: 15 },
      { title: 'Reflection', minutes: 10 },
    ]);
    assert.equal(create.body.retries_required, 3);
    assert.equal(create.body.generation_status, 'generated');
    assert.equal(create.body.generation_error, null);
    assert.match(create.body.content_text, /\\title\{Sorting Warmup\}/);
    assert.match(create.body.content_text, /\\mode\{demo\}/);
    assert.match(create.body.content_text, /\\section\{Learning Objectives\}/);
    assert.match(create.body.content_text, /\\questiongroup\{Predictions\}/);
    assert.deepEqual(capturedInput?.majorSections, ['Learning Objectives', 'Application', 'Reflection']);
    remember('activities', create.body.id);

    const [[row]] = await db.query(
      `SELECT source_type, content_text, is_test
         FROM pogil_activities
        WHERE id = ?`,
      [create.body.id]
    );
    assert.equal(row.source_type, 'local');
    assert.equal(row.is_test, 0);
    assert.match(row.content_text, /What do you predict insertion sort will do first\?/);
  } finally {
    activityCreator.generateActivityDraft = originalGenerator;
  }
});

test('creator draft route creates a test draft without section requirements', async () => {
  await ensureSchema();
  const creatorId = await createUser('creator');
  const className = uniqueName('CreatorTestClass');
  const [classResult] = await db.query(
    `INSERT INTO pogil_classes (name, description, level, topic_domain, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [className, 'This class focuses on assessment only.', 'First-year college', 'Computer Science', creatorId]
  );
  const classId = remember('classes', classResult.insertId);

  const originalGenerator = activityCreator.generateActivityDraft;
  let capturedInput = null;
  activityCreator.generateActivityDraft = async (input) => {
    capturedInput = input;
    return {
      text: [
        '\\title{Final Exam}',
        '\\mode{test}',
        '\\studentlevel{First-year college}',
        '\\activitycontext{Computer Science}',
        '\\retries{0}',
        '\\questiongroup{Exam Questions}',
        '\\question{What does the program print?}',
        '\\textresponse{3}',
        '\\sampleresponses{It prints a greeting.}',
        '\\feedbackprompt{Explain the output clearly.}',
        '\\endquestion',
        '\\endquestiongroup',
      ].join('\n'),
      generation_status: 'generated',
      generation_error: null,
    };
  };

  try {
    const create = await requestJson(`/api/classes/${classId}/creator-draft`, {
      method: 'POST',
      body: {
        title: 'Final Exam',
        duration_minutes: 60,
        mode: 'test',
        description: 'Create a full test without section structure.',
        selected_model: 'gpt-5-mini',
        major_sections: [],
        use_timed_sections: false,
        timed_sections: [],
        retries_required: 0,
        createdBy: creatorId,
      },
    });

    assert.equal(create.status, 201);
    assert.equal(create.body.title, 'Final Exam');
    assert.equal(create.body.mode, 'test');
    assert.deepEqual(create.body.major_sections, []);
    assert.equal(create.body.use_timed_sections, false);
    assert.deepEqual(create.body.timed_sections, []);
    assert.equal(create.body.retries_required, 0);
    assert.deepEqual(capturedInput?.majorSections, []);
    assert.deepEqual(capturedInput?.timedSections, []);
    assert.match(create.body.content_text, /\\mode\{test\}/);
    assert.doesNotMatch(create.body.content_text, /\\section\{/);
    remember('activities', create.body.id);
  } finally {
    activityCreator.generateActivityDraft = originalGenerator;
  }
});

test('creator draft route creates an assignment draft without section requirements', async () => {
  await ensureSchema();
  const creatorId = await createUser('creator');
  const className = uniqueName('CreatorAssignmentClass');
  const [classResult] = await db.query(
    `INSERT INTO pogil_classes (name, description, level, topic_domain, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [className, 'This class focuses on lab assignments.', 'First-year college', 'Computer Science', creatorId]
  );
  const classId = remember('classes', classResult.insertId);

  const originalGenerator = activityCreator.generateActivityDraft;
  let capturedInput = null;
  activityCreator.generateActivityDraft = async (input) => {
    capturedInput = input;
    return {
      text: [
        '\\title{Lab Project}',
        '\\mode{assignment}',
        '\\studentlevel{First-year college}',
        '\\activitycontext{Computer Science}',
        '\\retries{2}',
        '\\questiongroup{Project Goal}',
        '\\question{Describe the first milestone you will complete.}',
        '\\textresponse{3}',
        '\\sampleresponses{Describe a concrete first step.}',
        '\\feedbackprompt{Keep the answer tied to an actual project milestone.}',
        '\\endquestion',
        '\\endquestiongroup',
      ].join('\n'),
      generation_status: 'generated',
      generation_error: null,
    };
  };

  try {
    const create = await requestJson(`/api/classes/${classId}/creator-draft`, {
      method: 'POST',
      body: {
        title: 'Lab Project',
        duration_minutes: 90,
        mode: 'assignment',
        description: 'Create a project-style lab assignment.',
        selected_model: 'gpt-5-mini',
        major_sections: [],
        use_timed_sections: false,
        timed_sections: [],
        retries_required: 2,
        language: 'Swedish',
        createdBy: creatorId,
      },
    });

    assert.equal(create.status, 201);
    assert.equal(create.body.title, 'Lab Project');
    assert.equal(create.body.mode, 'assignment');
    assert.deepEqual(create.body.major_sections, []);
    assert.equal(create.body.use_timed_sections, false);
    assert.deepEqual(create.body.timed_sections, []);
    assert.equal(create.body.retries_required, 2);
    assert.equal(create.body.language, 'Swedish');
    assert.deepEqual(capturedInput?.majorSections, []);
    assert.deepEqual(capturedInput?.timedSections, []);
    assert.equal(capturedInput?.language, 'Swedish');
    assert.match(create.body.content_text, /\\mode\{assignment\}/);
    assert.match(create.body.content_text, /\\language\{Swedish\}/);
    assert.doesNotMatch(create.body.content_text, /\\section\{/);
    remember('activities', create.body.id);
  } finally {
    activityCreator.generateActivityDraft = originalGenerator;
  }
});

test('activity creation rejects missing required fields before database insert', async () => {
  await ensureSchema();
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
  await ensureSchema();
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
  await ensureSchema();
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
