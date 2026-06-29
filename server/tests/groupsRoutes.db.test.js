const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const groupRoutes = require('../groups/routes');
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
    await db.query(
      `DELETE FROM group_members
       WHERE activity_instance_id IN (
         SELECT id FROM activity_instances WHERE activity_id IN (?)
       )`,
      [activityIds]
    );
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
      demo_mode TINYINT(1) NOT NULL DEFAULT 0,
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
      student_id INT NOT NULL,
      UNIQUE KEY unique_enrollment (course_id, student_id)
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

  await db.query(`
    ALTER TABLE activity_instances
      ADD COLUMN IF NOT EXISTS total_groups INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS completed_groups INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS progress_status VARCHAR(32) NOT NULL DEFAULT 'not_started',
      ADD COLUMN IF NOT EXISTS test_start_at DATETIME NULL,
      ADD COLUMN IF NOT EXISTS test_duration_minutes INT NULL,
      ADD COLUMN IF NOT EXISTS lock_before_start TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS lock_after_end TINYINT(1) NOT NULL DEFAULT 0
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

async function createClassRecord({ demoMode = false } = {}) {
  const [result] = await db.query(
    'INSERT INTO pogil_classes (name, description, demo_mode, created_by) VALUES (?, ?, ?, ?)',
    [uniqueValue('GroupsClass'), 'Class for groups route tests', demoMode ? 1 : 0, null]
  );
  return remember('classes', result.insertId);
}

async function createCourse({ instructorId, classId, code = uniqueValue('GRP').toUpperCase() }) {
  const [result] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['Groups Course', code, 'A', 'fall', 2026, instructorId, classId]
  );
  return remember('courses', result.insertId);
}

async function createActivity({ classId, createdBy, isTest = 0 }) {
  const [result] = await db.query(
    `INSERT INTO pogil_activities (name, title, sheet_url, class_id, order_index, created_by, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uniqueValue('groups-activity').toLowerCase(),
      uniqueValue('Groups Activity Title'),
      'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit',
      classId,
      1,
      createdBy ?? null,
      isTest ? 1 : 0,
    ]
  );
  return remember('activities', result.insertId);
}

async function enrollStudent(courseId, studentId) {
  await db.query(
    `INSERT INTO course_enrollments (course_id, student_id) VALUES (?, ?)`,
    [courseId, studentId]
  );
}

async function createInstance({
  activityId,
  courseId,
  groupNumber = 1,
  activeStudentId = null,
  status = 'in_progress',
}) {
  const [result] = await db.query(
    `INSERT INTO activity_instances
       (activity_id, course_id, status, group_number, active_student_id)
     VALUES (?, ?, ?, ?, ?)`,
    [activityId, courseId, status, groupNumber, activeStudentId]
  );
  return remember('instances', result.insertId);
}

async function addGroupMember({
  instanceId,
  studentId,
  role = null,
  connected = false,
  lastHeartbeat = null,
}) {
  await db.query(
    `INSERT INTO group_members (activity_instance_id, student_id, role, connected, last_heartbeat)
     VALUES (?, ?, ?, ?, ?)`,
    [instanceId, studentId, role, connected ? 1 : 0, lastHeartbeat]
  );
}

function createTestServer(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/groups', groupRoutes);

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

test('getGroupsByInstance returns the group with ordered member details', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student', 'Zelda Student');
  const studentB = await createUser('student', 'Amy Student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, groupNumber: 3 });
  await addGroupMember({ instanceId, studentId: studentA.id, role: 'analyst' });
  await addGroupMember({ instanceId, studentId: studentB.id, role: 'facilitator' });

  const response = await requestJson(instructor, `/api/groups/instance/${instanceId}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.groups.length, 1);
  assert.equal(response.body.groups[0].group_number, 3);
  assert.deepEqual(
    response.body.groups[0].members.map((member) => ({
      student_id: member.student_id,
      name: member.name,
      role: member.role,
    })),
    [
      { student_id: studentB.id, name: 'Amy Student', role: 'facilitator' },
      { student_id: studentA.id, name: 'Zelda Student', role: 'analyst' },
    ]
  );
});

test('available-students excludes students already assigned to an in-progress group', async () => {
  const instructor = await createUser('instructor');
  const assigned = await createUser('student', 'Assigned Student');
  const available = await createUser('student', 'Available Student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, groupNumber: 1 });
  await enrollStudent(courseId, assigned.id);
  await enrollStudent(courseId, available.id);
  await addGroupMember({ instanceId, studentId: assigned.id, role: 'facilitator' });

  const response = await requestJson(
    instructor,
    `/api/groups/${activityId}/${courseId}/available-students`
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.students.map((student) => student.id),
    [available.id]
  );
});

test('active-students returns assigned students with instance and group metadata', async () => {
  const instructor = await createUser('instructor');
  const student = await createUser('student', 'Connected Student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, groupNumber: 4 });
  await addGroupMember({
    instanceId,
    studentId: student.id,
    role: 'qc',
    connected: true,
    lastHeartbeat: '2026-05-01 12:00:00',
  });

  const response = await requestJson(
    instructor,
    `/api/groups/${activityId}/${courseId}/active-students`
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.students.length, 1);
  assert.equal(response.body.students[0].id, student.id);
  assert.equal(response.body.students[0].activity_instance_id, instanceId);
  assert.equal(response.body.students[0].group_number, 4);
  assert.equal(response.body.students[0].role, 'qc');
});

test('smart-add puts a student into an existing group with space and assigns the next open role', async () => {
  const instructor = await createUser('instructor');
  const facilitator = await createUser('student', 'Facilitator Student');
  const added = await createUser('student', 'Added Student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, groupNumber: 1 });
  await enrollStudent(courseId, facilitator.id);
  await enrollStudent(courseId, added.id);
  await addGroupMember({ instanceId, studentId: facilitator.id, role: 'facilitator' });

  const response = await requestJson(
    instructor,
    `/api/groups/${activityId}/${courseId}/smart-add`,
    {
      method: 'POST',
      body: { studentId: added.id },
    }
  );

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.activityInstanceId, instanceId);
  assert.equal(response.body.groupNumber, 1);
  assert.equal(response.body.role, 'analyst');

  const [[member]] = await db.query(
    `SELECT role FROM group_members
     WHERE activity_instance_id = ? AND student_id = ?`,
    [instanceId, added.id]
  );
  assert.equal(member.role, 'analyst');
});

test('smart-add creates a new group when all in-progress groups are full', async () => {
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, groupNumber: 2 });
  const fullGroupStudents = await Promise.all(
    ['One', 'Two', 'Three', 'Four'].map((name) => createUser('student', `${name} Student`))
  );
  const added = await createUser('student', 'Fresh Student');

  for (const student of fullGroupStudents) {
    await enrollStudent(courseId, student.id);
  }
  await enrollStudent(courseId, added.id);

  await addGroupMember({ instanceId, studentId: fullGroupStudents[0].id, role: 'facilitator' });
  await addGroupMember({ instanceId, studentId: fullGroupStudents[1].id, role: 'analyst' });
  await addGroupMember({ instanceId, studentId: fullGroupStudents[2].id, role: 'qc' });
  await addGroupMember({ instanceId, studentId: fullGroupStudents[3].id, role: 'spokesperson' });

  const response = await requestJson(
    instructor,
    `/api/groups/${activityId}/${courseId}/smart-add`,
    {
      method: 'POST',
      body: { studentId: added.id },
    }
  );

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.groupNumber, 3);
  assert.equal(response.body.role, 'facilitator');

  const [[instance]] = await db.query(
    `SELECT group_number FROM activity_instances WHERE id = ?`,
    [response.body.activityInstanceId]
  );
  assert.equal(Number(instance.group_number), 3);
});

test('smart-add for demo courses prunes stale members and limits auto-join groups to pairs', async () => {
  const instructor = await createUser('instructor');
  const staleStudent = await createUser('student', 'Stale Demo Student');
  const addedA = await createUser('student', 'Demo Student A');
  const addedB = await createUser('student', 'Demo Student B');
  const addedC = await createUser('student', 'Demo Student C');
  const classId = await createClassRecord({ demoMode: true });
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const staleInstanceId = await createInstance({ activityId, courseId, groupNumber: 1 });

  await enrollStudent(courseId, staleStudent.id);
  await enrollStudent(courseId, addedA.id);
  await enrollStudent(courseId, addedB.id);
  await enrollStudent(courseId, addedC.id);

  await addGroupMember({
    instanceId: staleInstanceId,
    studentId: staleStudent.id,
    role: 'facilitator',
    connected: false,
    lastHeartbeat: '2026-05-01 12:00:00',
  });

  const responseA = await requestJson(
    instructor,
    `/api/groups/${activityId}/${courseId}/smart-add`,
    {
      method: 'POST',
      body: { studentId: addedA.id },
    }
  );

  assert.equal(responseA.status, 201);
  assert.equal(responseA.body.groupNumber, 1);
  assert.equal(responseA.body.role, 'facilitator');

  const responseB = await requestJson(
    instructor,
    `/api/groups/${activityId}/${courseId}/smart-add`,
    {
      method: 'POST',
      body: { studentId: addedB.id },
    }
  );

  assert.equal(responseB.status, 201);
  assert.equal(responseB.body.groupNumber, 1);
  assert.equal(responseB.body.role, 'analyst');

  const responseC = await requestJson(
    instructor,
    `/api/groups/${activityId}/${courseId}/smart-add`,
    {
      method: 'POST',
      body: { studentId: addedC.id },
    }
  );

  assert.equal(responseC.status, 201);
  assert.equal(responseC.body.groupNumber, 2);
  assert.equal(responseC.body.role, 'facilitator');

  const [groupOneMembers] = await db.query(
    `SELECT student_id, role
       FROM group_members
      WHERE activity_instance_id = ?
      ORDER BY student_id`,
    [responseA.body.activityInstanceId]
  );
  assert.deepEqual(
    groupOneMembers.map((member) => ({
      student_id: Number(member.student_id),
      role: member.role,
    })),
    [
      { student_id: addedA.id, role: 'facilitator' },
      { student_id: addedB.id, role: 'analyst' },
    ]
  );

  const [[staleRemaining]] = await db.query(
    `SELECT COUNT(*) AS count
       FROM group_members
      WHERE activity_instance_id = ? AND student_id = ?`,
    [staleInstanceId, staleStudent.id]
  );
  assert.equal(Number(staleRemaining.count), 0);
});

test('add-solo creates a new one-person group and makes that student active', async () => {
  const instructor = await createUser('instructor');
  const student = await createUser('student', 'Solo Student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  await enrollStudent(courseId, student.id);

  const response = await requestJson(
    instructor,
    `/api/groups/${activityId}/${courseId}/add-solo`,
    {
      method: 'POST',
      body: { studentId: student.id },
    }
  );

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.groupNumber, 1);

  const [[instance]] = await db.query(
    `SELECT active_student_id, group_number FROM activity_instances WHERE id = ?`,
    [response.body.activityInstanceId]
  );
  assert.equal(Number(instance.active_student_id), student.id);
  assert.equal(Number(instance.group_number), 1);

  const [[member]] = await db.query(
    `SELECT student_id, role FROM group_members WHERE activity_instance_id = ?`,
    [response.body.activityInstanceId]
  );
  assert.equal(Number(member.student_id), student.id);
  assert.equal(member.role, null);
});

test('remove deletes the final student and removes the empty activity instance', async () => {
  const instructor = await createUser('instructor');
  const student = await createUser('student', 'Removed Student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, groupNumber: 1 });
  await addGroupMember({ instanceId, studentId: student.id, role: 'facilitator' });

  const response = await requestJson(
    instructor,
    `/api/groups/${instanceId}/remove/${student.id}`,
    { method: 'DELETE' }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });

  const [[memberCount]] = await db.query(
    `SELECT COUNT(*) AS count FROM group_members WHERE activity_instance_id = ?`,
    [instanceId]
  );
  assert.equal(Number(memberCount.count), 0);

  const [[instanceCount]] = await db.query(
    `SELECT COUNT(*) AS count FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instanceCount.count), 0);
});
