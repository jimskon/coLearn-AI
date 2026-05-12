const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const test = require('node:test');

const express = require('express');

const classRoutes = require('../classes/routes');
const db = require('../db');

function uniqueName(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      created_by INT DEFAULT NULL,
      google_folder_url TEXT DEFAULT NULL,
      google_folder_id VARCHAR(255) DEFAULT NULL,
      google_folder_name VARCHAR(255) DEFAULT NULL,
      google_folder_verified_at DATETIME DEFAULT NULL,
      google_folder_status VARCHAR(32) DEFAULT NULL
    )
  `);

  await db.query(`
    ALTER TABLE pogil_classes
      ADD COLUMN IF NOT EXISTS google_folder_url TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS google_folder_id VARCHAR(255) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS google_folder_name VARCHAR(255) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS google_folder_verified_at DATETIME DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS google_folder_status VARCHAR(32) DEFAULT NULL
  `);

  await db.query(`
    ALTER TABLE pogil_activities
      ADD COLUMN IF NOT EXISTS source_type VARCHAR(16) NOT NULL DEFAULT 'external'
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
    'INSERT INTO pogil_classes (name, description, created_by) VALUES (?, ?, ?)',
    [uniqueName('Class'), 'Class for route tests', null]
  );
  return remember('classes', result.insertId);
}

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = app.locals.user;
    next();
  });
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

function loadClassRoutes({ docsById = {}, folderFiles = [], metadataById = {}, verifyCourseFolderAccessImpl } = {}) {
  const googleAuthPath = require.resolve('../utils/googleAuth');
  const googleDrivePath = require.resolve('../utils/googleDrive');
  const courseFolderPath = require.resolve('../utils/courseFolder');
  const activityTypePath = require.resolve('../utils/activityType');
  const classControllerPath = require.resolve('../classes/controller');
  const classRoutesPath = require.resolve('../classes/routes');

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
      drive: () => ({
        files: {
          list: async () => ({ data: { files: folderFiles } }),
          get: async ({ fileId }) => ({
            data:
              metadataById[fileId]
              || folderFiles.find((file) => file.id === fileId)
              || { id: fileId, name: `Untitled ${fileId}` },
          }),
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
  delete require.cache[googleDrivePath];
  delete require.cache[courseFolderPath];
  delete require.cache[activityTypePath];
  delete require.cache[classControllerPath];
  delete require.cache[classRoutesPath];

  const googleAuth = require(googleAuthPath);
  const originalAuthorize = googleAuth.authorize;
  googleAuth.authorize = () => ({ fake: true });
  const courseFolder = require(courseFolderPath);
  const originalVerifyCourseFolderAccess = courseFolder.verifyCourseFolderAccess;
  if (verifyCourseFolderAccessImpl) {
    courseFolder.verifyCourseFolderAccess = verifyCourseFolderAccessImpl;
  }

  const loadedClassRoutes = require(classRoutesPath);

  return {
    classRoutes: loadedClassRoutes,
    restore() {
      Module._load = originalLoad;
      googleAuth.authorize = originalAuthorize;
      courseFolder.verifyCourseFolderAccess = originalVerifyCourseFolderAccess;
      delete require.cache[googleAuthPath];
      delete require.cache[googleDrivePath];
      delete require.cache[courseFolderPath];
      delete require.cache[activityTypePath];
      delete require.cache[classControllerPath];
      delete require.cache[classRoutesPath];
    },
  };
}

function createStubbedTestServer(user, overrides = {}) {
  const { classRoutes: stubbedClassRoutes, restore } = loadClassRoutes(overrides);
  const app = express();
  app.locals.user = user;
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/classes', stubbedClassRoutes);

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

async function requestJson(userOrPath, maybePathOrOptions, maybeOptions) {
  const hasUser = typeof userOrPath !== 'string';
  const user = hasUser ? userOrPath : undefined;
  const path = hasUser ? maybePathOrOptions : userOrPath;
  const options = hasUser ? (maybeOptions || {}) : (maybePathOrOptions || {});
  const { method = 'GET', body, overrides } = options;
  const server = overrides ? await createStubbedTestServer(user, overrides) : await createTestServer();

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

test('class folder endpoints return empty state, verify, save, fetch, and delete a folder', async () => {
  await ensureSchema();
  const classId = await createClassRecord();
  const folderUrl = 'https://drive.google.com/drive/folders/1FolderGhIjKlMnOpQrStUvWxYz1234567890?usp=sharing';

  const initial = await requestJson(`/api/classes/${classId}/folder`);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, {
    class_id: classId,
    has_folder: false,
  });

  const verify = await requestJson(`/api/classes/${classId}/folder/verify`, {
    method: 'POST',
    body: { folderUrl },
    overrides: {
      verifyCourseFolderAccessImpl: async () => ({
        ok: true,
        folderId: '1FolderGhIjKlMnOpQrStUvWxYz1234567890',
        folderName: 'CS101 Activities',
        writable: true,
        error: null,
      }),
    },
  });
  assert.equal(verify.status, 200);
  assert.deepEqual(verify.body, {
    ok: true,
    folder_id: '1FolderGhIjKlMnOpQrStUvWxYz1234567890',
    folder_name: 'CS101 Activities',
    writable: true,
  });

  const saved = await requestJson(`/api/classes/${classId}/folder`, {
    method: 'PUT',
    body: { folderUrl },
    overrides: {
      verifyCourseFolderAccessImpl: async () => ({
        ok: true,
        folderId: '1FolderGhIjKlMnOpQrStUvWxYz1234567890',
        folderName: 'CS101 Activities',
        writable: true,
        error: null,
      }),
    },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, {
    ok: true,
    folder_url: folderUrl,
    folder_id: '1FolderGhIjKlMnOpQrStUvWxYz1234567890',
    folder_name: 'CS101 Activities',
    status: 'verified',
    reconciled_count: 0,
  });

  const fetched = await requestJson(`/api/classes/${classId}/folder`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.has_folder, true);
  assert.equal(fetched.body.folder_url, folderUrl);
  assert.equal(fetched.body.folder_id, '1FolderGhIjKlMnOpQrStUvWxYz1234567890');
  assert.equal(fetched.body.folder_name, 'CS101 Activities');
  assert.equal(fetched.body.status, 'verified');
  assert.ok(fetched.body.verified_at);

  const removed = await requestJson(`/api/classes/${classId}/folder`, {
    method: 'DELETE',
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { ok: true });

  const afterDelete = await requestJson(`/api/classes/${classId}/folder`);
  assert.equal(afterDelete.status, 200);
  assert.deepEqual(afterDelete.body, {
    class_id: classId,
    has_folder: false,
  });
});

test('class folder save rejects invalid verification results', async () => {
  await ensureSchema();
  const classId = await createClassRecord();

  const invalid = await requestJson(`/api/classes/${classId}/folder`, {
    method: 'PUT',
    body: { folderUrl: 'not a folder' },
    overrides: {
      verifyCourseFolderAccessImpl: async () => ({
        ok: false,
        folderId: null,
        folderName: null,
        writable: false,
        error: 'Invalid Google Drive folder URL.',
      }),
    },
  });

  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body, {
    ok: false,
    folder_id: null,
    folder_name: null,
    writable: false,
    error: 'Invalid Google Drive folder URL.',
  });
});

test('class activity routes create, list, update, and delete an activity', async () => {
  await ensureSchema();
  const classId = await createClassRecord();
  const creatorId = await createUser('creator');
  const activityName = uniqueName('activity').toLowerCase();
  const docId = 'testCreateActivityDoc123456789';

  const create = await requestJson(null, `/api/classes/${classId}/activities`, {
    method: 'POST',
    body: {
      name: activityName,
      title: 'Loops and Lists',
      sheet_url: `https://docs.google.com/document/d/${docId}/edit`,
      order_index: 2,
      createdBy: creatorId,
    },
    overrides: {
      docsById: {
        [docId]: ['\\title{Loops and Lists}', '\\mode{test}', '\\questiongroup{One}'],
      },
    },
  });

  assert.equal(create.status, 201);
  assert.equal(create.body.name, activityName);
  assert.equal(create.body.title, 'Loops and Lists');
  assert.equal(create.body.order_index, 2);
  assert.equal(create.body.class_id, classId);
  assert.equal(create.body.created_by, creatorId);
  assert.equal(create.body.is_test, 1);
  assert.equal(create.body.activity_type, 'test');
  assert.equal(create.body.source_type, 'external');
  assert.equal(typeof create.body.id, 'number');
  remember('activities', create.body.id);

  const list = await requestJson(`/api/classes/${classId}/activities`);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, create.body.id);
  assert.equal(list.body[0].name, activityName);
  assert.equal(Number(list.body[0].is_test), 1);
  assert.equal(list.body[0].source_type, 'external');

  const [[storedActivity]] = await db.query(
    `SELECT is_test, source_type FROM pogil_activities WHERE id = ?`,
    [create.body.id]
  );
  assert.equal(Number(storedActivity.is_test), 1);
  assert.equal(storedActivity.source_type, 'external');

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

test('saving a class folder reconciles matching existing external activities to local', async () => {
  await ensureSchema();
  const classId = await createClassRecord();
  const creatorId = await createUser('creator');
  const folderId = '1FolderGhIjKlMnOpQrStUvWxYz1234567890';
  const matchingDocId = '1MatchingDocGhIjKlMnOpQrStUvWxYz12345';
  const otherDocId = '1OtherDocGhIjKlMnOpQrStUvWxYz12345678';

  const [matchingActivity] = await db.query(
    `INSERT INTO pogil_activities
     (name, title, sheet_url, order_index, class_id, created_by, is_test, source_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uniqueName('matching').toLowerCase(),
      'Matching Activity',
      `https://docs.google.com/document/d/${matchingDocId}/edit`,
      1,
      classId,
      creatorId,
      0,
      'external',
    ]
  );
  remember('activities', matchingActivity.insertId);

  const [otherActivity] = await db.query(
    `INSERT INTO pogil_activities
     (name, title, sheet_url, order_index, class_id, created_by, is_test, source_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uniqueName('other').toLowerCase(),
      'Other Activity',
      `https://docs.google.com/document/d/${otherDocId}/edit`,
      2,
      classId,
      creatorId,
      0,
      'external',
    ]
  );
  remember('activities', otherActivity.insertId);

  const response = await requestJson(`/api/classes/${classId}/folder`, {
    method: 'PUT',
    body: { folderUrl: `https://drive.google.com/drive/folders/${folderId}` },
    overrides: {
      verifyCourseFolderAccessImpl: async () => ({
        ok: true,
        folderId,
        folderName: 'CS101 Activities',
        writable: true,
        error: null,
      }),
      metadataById: {
        [matchingDocId]: { id: matchingDocId, name: 'Matching Activity', parents: [folderId] },
        [otherDocId]: { id: otherDocId, name: 'Other Activity', parents: ['different-folder'] },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.reconciled_count, 1);

  const [storedRows] = await db.query(
    `SELECT title, source_type
       FROM pogil_activities
      WHERE id IN (?, ?)`,
    [matchingActivity.insertId, otherActivity.insertId]
  );
  const storedByTitle = new Map(storedRows.map((row) => [row.title, row.source_type]));
  assert.equal(storedByTitle.get('Matching Activity'), 'local');
  assert.equal(storedByTitle.get('Other Activity'), 'external');
});

test('import-folder initializes activity types without opening each imported activity', async () => {
  await ensureSchema();
  const classId = await createClassRecord();
  const instructorId = await createUser('instructor');
  const folderId = 'folderImportActivity1234567890';
  const testDocId = 'folderImportTestDoc1234567890';
  const groupDocId = 'folderImportGroupDoc123456789';

  await db.query(
    `UPDATE pogil_classes
        SET google_folder_url = ?,
            google_folder_id = ?,
            google_folder_name = ?,
            google_folder_status = 'verified'
      WHERE id = ?`,
    [
      `https://drive.google.com/drive/folders/${folderId}`,
      folderId,
      'Demo Activities',
      classId,
    ]
  );

  const response = await requestJson(
    { id: instructorId, role: 'instructor' },
    `/api/classes/${classId}/import-folder`,
    {
      method: 'POST',
      body: {
        folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
      },
      overrides: {
        folderFiles: [
          { id: testDocId, name: '2 Test Activity' },
          { id: groupDocId, name: '1 Group Activity' },
        ],
        metadataById: {
          [testDocId]: { id: testDocId, name: '2 Test Activity' },
          [groupDocId]: { id: groupDocId, name: '1 Group Activity' },
        },
        docsById: {
          [testDocId]: ['\\title{Imported Test}', '\\mode{test}', '\\questiongroup{One}'],
          [groupDocId]: ['\\title{Imported Group}', '\\mode{group}', '\\questiongroup{One}'],
        },
      },
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.imported.length, 2);

  for (const activity of response.body.imported) {
    remember('activities', activity.id);
  }

  const byTitle = new Map(response.body.imported.map((activity) => [activity.title, activity]));
  assert.equal(byTitle.get('1 Group Activity')?.activity_type, 'group');
  assert.equal(byTitle.get('1 Group Activity')?.is_test, 0);
  assert.equal(byTitle.get('1 Group Activity')?.source_type, 'local');
  assert.equal(byTitle.get('2 Test Activity')?.activity_type, 'test');
  assert.equal(byTitle.get('2 Test Activity')?.is_test, 1);
  assert.equal(byTitle.get('2 Test Activity')?.source_type, 'local');

  const [storedRows] = await db.query(
    `SELECT title, is_test, source_type
       FROM pogil_activities
      WHERE id IN (?)`,
    [response.body.imported.map((activity) => activity.id)]
  );
  const storedByTitle = new Map(storedRows.map((row) => [row.title, row]));
  assert.equal(Number(storedByTitle.get('1 Group Activity')?.is_test), 0);
  assert.equal(storedByTitle.get('1 Group Activity')?.source_type, 'local');
  assert.equal(Number(storedByTitle.get('2 Test Activity')?.is_test), 1);
  assert.equal(storedByTitle.get('2 Test Activity')?.source_type, 'local');
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
