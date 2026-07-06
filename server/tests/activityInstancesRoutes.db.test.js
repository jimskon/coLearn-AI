const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { Server } = require('socket.io');

process.env.OPENAI_API_KEY ||= 'test-key';

const express = require('express');

const activityInstanceRoutes = require('../activity_instances/routes');
const progressMonitorRoutes = require('../progress_monitor/routes');
const db = require('../db');
const aiController = require('../ai/controller');

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
  if (Number.isFinite(numericId)) {
    created[kind].add(numericId);
  }
  return numericId;
}

async function cleanupCreatedRows() {
  const instanceIds = [...created.instances];
  const activityIds = [...created.activities];
  const courseIds = [...created.courses];
  const classIds = [...created.classes];
  const userIds = [...created.users];

  if (instanceIds.length) {
    await db.query(`DELETE FROM audit_log WHERE activity_instance_id IN (?)`, [instanceIds]);
    await db.query(`DELETE FROM followups WHERE response_id IN (SELECT id FROM responses WHERE activity_instance_id IN (?))`, [instanceIds]);
    await db.query(`DELETE FROM feedback WHERE response_id IN (SELECT id FROM responses WHERE activity_instance_id IN (?))`, [instanceIds]);
    await db.query(`DELETE FROM response_drafts WHERE activity_instance_id IN (?)`, [instanceIds]);
    await db.query(`DELETE FROM responses WHERE activity_instance_id IN (?)`, [instanceIds]);
    await db.query(`DELETE FROM group_members WHERE activity_instance_id IN (?)`, [instanceIds]);
    await db.query(`DELETE FROM activity_instances WHERE id IN (?)`, [instanceIds]);
  }
  if (activityIds.length) {
    await db.query(`DELETE FROM pogil_activities WHERE id IN (?)`, [activityIds]);
  }
  if (courseIds.length) {
    await db.query(`DELETE FROM courses WHERE id IN (?)`, [courseIds]);
  }
  if (classIds.length) {
    await db.query(`DELETE FROM pogil_classes WHERE id IN (?)`, [classIds]);
  }
  if (userIds.length) {
    await db.query(`DELETE FROM users WHERE id IN (?)`, [userIds]);
  }
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
    ALTER TABLE pogil_classes
      ADD COLUMN IF NOT EXISTS demo_mode TINYINT(1) NOT NULL DEFAULT 0
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

  await db.query(`
    ALTER TABLE activity_instances
      ADD COLUMN IF NOT EXISTS total_groups INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS completed_groups INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS progress_status VARCHAR(32) NOT NULL DEFAULT 'not_started',
      ADD COLUMN IF NOT EXISTS submitted_by_user_id INT NULL,
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
      ADD COLUMN IF NOT EXISTS hidden TINYINT(1) NOT NULL DEFAULT 0,
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

  await db.query(`
    CREATE TABLE IF NOT EXISTS responses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      activity_instance_id INT NOT NULL,
      question_id VARCHAR(64) NOT NULL,
      submit_id CHAR(36) NULL,
      response_type VARCHAR(32) NOT NULL DEFAULT 'text',
      response MEDIUMTEXT NULL,
      submitted_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
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

  await db.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INT AUTO_INCREMENT PRIMARY KEY,
      response_id INT DEFAULT NULL,
      feedback_text TEXT NOT NULL,
      generated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_feedback_response (response_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS followups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      response_id INT DEFAULT NULL,
      followup_prompt TEXT NOT NULL,
      followup_generated TEXT NOT NULL,
      generated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_followups_response (response_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS progress_monitor_suggestions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      activity_instance_id INT NOT NULL,
      audit_log_id INT DEFAULT NULL,
      previous_status VARCHAR(32) DEFAULT NULL,
      status VARCHAR(32) NOT NULL,
      suggestion_text TEXT NOT NULL,
      context_json LONGTEXT DEFAULT NULL,
      suggestion_state ENUM('pending','dismissed','acted_on') NOT NULL DEFAULT 'pending',
      dismissed_at TIMESTAMP NULL DEFAULT NULL,
      acted_on_at TIMESTAMP NULL DEFAULT NULL,
      generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_pms_instance_generated (activity_instance_id, generated_at),
      KEY idx_pms_state (suggestion_state),
      KEY idx_pms_audit (audit_log_id),
      CONSTRAINT pms_instance_fk
        FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
      CONSTRAINT pms_audit_fk
        FOREIGN KEY (audit_log_id) REFERENCES audit_log(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(191) NOT NULL,
      user_id INT DEFAULT NULL,
      guest_token VARCHAR(191) DEFAULT NULL,
      role VARCHAR(32) DEFAULT NULL,
      class_id INT DEFAULT NULL,
      course_id INT DEFAULT NULL,
      activity_id INT DEFAULT NULL,
      activity_instance_id INT DEFAULT NULL,
      request_path VARCHAR(255) DEFAULT NULL,
      ip_address VARCHAR(64) DEFAULT NULL,
      user_agent VARCHAR(1000) DEFAULT NULL,
      details LONGTEXT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function createUser(role = 'student') {
  const email = `${uniqueValue(role)}@example.com`;
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [`${role} user`, email, 'not-used', role]
  );
  return {
    id: remember('users', result.insertId),
    name: `${role} user`,
    email,
    role,
  };
}

async function createClassRecord({ demoMode = false } = {}) {
  const [result] = await db.query(
    'INSERT INTO pogil_classes (name, description, demo_mode, created_by) VALUES (?, ?, ?, ?)',
    [uniqueValue('ActivityInstanceClass'), 'Class for activity instance tests', demoMode ? 1 : 0, null]
  );
  return remember('classes', result.insertId);
}

async function createCourse({ instructorId, classId, code = uniqueValue('AI').toUpperCase() }) {
  const [result] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['Activity Instances Course', code, 'A', 'fall', 2026, instructorId, classId]
  );
  return remember('courses', result.insertId);
}

async function createActivity({ classId, createdBy }) {
  const [result] = await db.query(
    `INSERT INTO pogil_activities (name, title, sheet_url, class_id, order_index, created_by, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uniqueValue('activity').toLowerCase(),
      uniqueValue('Activity Title'),
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
  totalGroups = 3,
  completedGroups = 0,
  progressStatus = 'not_started',
  activeStudentId = null,
  activeRotationMode = 'submit',
  sectionTimerKey = null,
  sectionTimerDurationMinutes = null,
  sectionTimerStartedAt = null,
  sectionTimerPaused = 0,
  sectionTimerPausedAt = null,
}) {
  const [result] = await db.query(
    `INSERT INTO activity_instances
       (activity_id, course_id, status, group_number, total_groups, completed_groups, progress_status,
        active_student_id, active_rotation_mode, section_timer_key, section_timer_duration_minutes,
        section_timer_started_at, section_timer_paused, section_timer_paused_at)
     VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      activityId,
      courseId,
      groupNumber,
      totalGroups,
      completedGroups,
      progressStatus,
      activeStudentId,
      activeRotationMode,
      sectionTimerKey,
      sectionTimerDurationMinutes,
      sectionTimerStartedAt,
      sectionTimerPaused,
      sectionTimerPausedAt,
    ]
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

function createTestServer(user = null, withSockets = false) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/activity-instances', activityInstanceRoutes);
  app.use('/api/progress-monitor', progressMonitorRoutes);

  const server = http.createServer(app);
  const io = withSockets ? new Server(server, { serveClient: false }) : null;
  if (io) {
    global.io = io;
    global.emitInstanceState = () => {};
    io.on('connection', (socket) => {
      socket.on('instance:join', ({ instanceId }) => {
        socket.join('instance-' + instanceId);
      });
      socket.on('instance:leave', ({ instanceId }) => {
        socket.leave('instance-' + instanceId);
      });
      socket.on('progress-monitor:join', ({ courseId, activityId }) => {
        if (courseId) socket.join('progress-monitor-course-' + courseId);
        if (activityId) socket.join('progress-monitor-activity-' + activityId);
      });
      socket.on('progress-monitor:leave', ({ courseId, activityId }) => {
        if (courseId) socket.leave('progress-monitor-course-' + courseId);
        if (activityId) socket.leave('progress-monitor-activity-' + activityId);
      });
    });
  }
  server.keepAliveTimeout = 1;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        io,
        close: () =>
          new Promise((closeResolve) => {
              io?.close();
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
  global.emitInstanceState = () => {};
  await ensureSchema();
});

test.after(async () => {
  delete global.emitInstanceState;
  await cleanupCreatedRows();
  await db.end();
});

test('by-activity returns grouped instance rows with members, timer fields, and rotation mode', async () => {
  const instructor = await createUser('instructor');
  const student = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    totalGroups: 5,
    completedGroups: 2,
    progressStatus: 'in_progress',
    activeStudentId: student.id,
    activeRotationMode: 'group',
    sectionTimerKey: 'section-2',
    sectionTimerDurationMinutes: 10,
    sectionTimerStartedAt: '2026-05-01 12:00:00',
  });
  await addGroupMember({ instanceId, studentId: student.id, connected: true });

  const response = await requestJson(instructor, `/api/activity-instances/by-activity/${courseId}/${activityId}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.courseName, 'Activity Instances Course');
  assert.equal(response.body.groups.length, 1);
  assert.equal(response.body.groups[0].instance_id, instanceId);
  assert.equal(response.body.groups[0].active_rotation_mode, 'group');
  assert.equal(response.body.groups[0].completed_groups, 2);
  assert.equal(response.body.groups[0].progress_status, 'in_progress');
  assert.equal(response.body.groups[0].section_timer_key, 'section-2');
  assert.equal(response.body.groups[0].section_timer_duration_minutes, 10);
  assert.equal(response.body.groups[0].members.length, 1);
  assert.equal(response.body.groups[0].members[0].student_id, student.id);
});

test('preview-doc for an instance returns local stored activity content', async () => {
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId });
  const contentText = [
    '\\title{Stored Local Activity}',
    '\\mode{group}',
    '',
    '\\questiongroup{One}',
    '\\question{Local question?}',
  ].join('\n');

  await db.query(
    `UPDATE pogil_activities
        SET source_type = 'local',
            content_text = ?
      WHERE id = ?`,
    [contentText, activityId]
  );

  const response = await requestJson(instructor, `/api/activity-instances/${instanceId}/preview-doc`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.lines, contentText.split('\n'));
});

test('heartbeat marks membership connected, starts a timer anchor, and assigns active student', async () => {
  const instructor = await createUser('instructor');
  const student = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, totalGroups: 4 });
  await addGroupMember({ instanceId, studentId: student.id, connected: false });

  const response = await requestJson(student, `/api/activity-instances/${instanceId}/heartbeat`, {
    method: 'POST',
    body: {
      userId: student.id,
      sectionTimerKey: 'section-1',
      sectionTimerDurationMinutes: 12,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.becameActive, true);
  assert.equal(response.body.activeStudentId, student.id);
  assert.equal(response.body.section_timer_key, 'section-1');
  assert.equal(response.body.section_timer_duration_minutes, 12);
  assert.match(response.body.section_timer_started_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const [[instance]] = await db.query(
    `SELECT active_student_id, section_timer_key, section_timer_duration_minutes, section_timer_started_at
     FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instance.active_student_id), student.id);
  assert.equal(instance.section_timer_key, 'section-1');
  assert.equal(Number(instance.section_timer_duration_minutes), 12);
  assert.ok(instance.section_timer_started_at);

  const [[member]] = await db.query(
    `SELECT connected, last_heartbeat FROM group_members
     WHERE activity_instance_id = ? AND student_id = ?`,
    [instanceId, student.id]
  );
  assert.equal(Number(member.connected), 1);
  assert.ok(member.last_heartbeat);
});

test('heartbeat keeps a recently active student active until the two-minute window expires', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student');
  const studentB = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, totalGroups: 4, activeStudentId: studentA.id });
  await addGroupMember({ instanceId, studentId: studentA.id, connected: true });
  await addGroupMember({ instanceId, studentId: studentB.id, connected: true });

  await db.query(
    `UPDATE group_members
        SET last_heartbeat = DATE_SUB(NOW(), INTERVAL 90 SECOND)
      WHERE activity_instance_id = ? AND student_id = ?`,
    [instanceId, studentA.id]
  );
  await db.query(
    `UPDATE group_members
        SET last_heartbeat = DATE_SUB(NOW(), INTERVAL 5 SECOND)
      WHERE activity_instance_id = ? AND student_id = ?`,
    [instanceId, studentB.id]
  );

  const response = await requestJson(studentB, `/api/activity-instances/${instanceId}/heartbeat`, {
    method: 'POST',
    body: { userId: studentB.id, timerInfo: {} },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.becameActive, false);
  assert.equal(Number(response.body.activeStudentId), studentA.id);

  const [[instance]] = await db.query(
    `SELECT active_student_id
       FROM activity_instances
      WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instance.active_student_id), studentA.id);
});

test('timer-pause pauses and resumes all instances for an activity without clearing the timer anchor', async () => {
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceA = await createInstance({
    activityId,
    courseId,
    groupNumber: 1,
    sectionTimerKey: 'section-1',
    sectionTimerDurationMinutes: 8,
    sectionTimerStartedAt: '2026-05-01 10:00:00',
  });
  const instanceB = await createInstance({
    activityId,
    courseId,
    groupNumber: 2,
    sectionTimerKey: 'section-1',
    sectionTimerDurationMinutes: 8,
    sectionTimerStartedAt: '2026-05-01 10:05:00',
  });

  const pause = await requestJson(instructor, `/api/activity-instances/by-activity/${courseId}/${activityId}/timer-pause`, {
    method: 'POST',
    body: { paused: true },
  });
  assert.equal(pause.status, 200);
  assert.equal(pause.body.ok, true);
  assert.equal(pause.body.paused, true);
  assert.equal(pause.body.updated, 2);

  const [pausedRows] = await db.query(
    `SELECT id, section_timer_paused, section_timer_paused_at
     FROM activity_instances
     WHERE id IN (?, ?)
     ORDER BY id`,
    [instanceA, instanceB]
  );
  assert.equal(Number(pausedRows[0].section_timer_paused), 1);
  assert.ok(pausedRows[0].section_timer_paused_at);
  assert.equal(Number(pausedRows[1].section_timer_paused), 1);
  assert.ok(pausedRows[1].section_timer_paused_at);

  const resume = await requestJson(instructor, `/api/activity-instances/by-activity/${courseId}/${activityId}/timer-pause`, {
    method: 'POST',
    body: { paused: false },
  });
  assert.equal(resume.status, 200);
  assert.equal(resume.body.ok, true);
  assert.equal(resume.body.paused, false);

  const [resumedRows] = await db.query(
    `SELECT id, section_timer_started_at, section_timer_paused, section_timer_paused_at
     FROM activity_instances
     WHERE id IN (?, ?)
     ORDER BY id`,
    [instanceA, instanceB]
  );
  assert.equal(Number(resumedRows[0].section_timer_paused), 0);
  assert.equal(resumedRows[0].section_timer_paused_at, null);
  assert.ok(resumedRows[0].section_timer_started_at);
  assert.equal(Number(resumedRows[1].section_timer_paused), 0);
  assert.equal(resumedRows[1].section_timer_paused_at, null);
  assert.ok(resumedRows[1].section_timer_started_at);
});

test('active-rotation-mode updates every instance for the activity', async () => {
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceA = await createInstance({ activityId, courseId, groupNumber: 1, activeRotationMode: 'submit' });
  const instanceB = await createInstance({ activityId, courseId, groupNumber: 2, activeRotationMode: 'submit' });

  const response = await requestJson(instructor, `/api/activity-instances/by-activity/${courseId}/${activityId}/active-rotation-mode`, {
    method: 'POST',
    body: { mode: 'group' },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, mode: 'group', updated: 2 });

  const [rows] = await db.query(
    `SELECT active_rotation_mode
     FROM activity_instances
     WHERE id IN (?, ?)
     ORDER BY id`,
    [instanceA, instanceB]
  );
  assert.equal(rows[0].active_rotation_mode, 'group');
  assert.equal(rows[1].active_rotation_mode, 'group');
});

test('submit-group advances progress, rotates active student in submit mode, and clears drafts', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student');
  const studentB = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    groupNumber: 1,
    totalGroups: 3,
    completedGroups: 0,
    progressStatus: 'not_started',
    activeStudentId: studentA.id,
    activeRotationMode: 'submit',
  });
  await addGroupMember({ instanceId, studentId: studentA.id, role: 'facilitator', connected: true, lastHeartbeat: '2026-05-01 12:00:00' });
  await addGroupMember({ instanceId, studentId: studentB.id, role: 'analyst', connected: true, lastHeartbeat: '2026-05-01 12:00:01' });

  await db.query(
    `INSERT INTO response_drafts (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, 'text', ?, ?)`,
    [instanceId, '1a', 'draft answer', studentA.id]
  );

  const response = await requestJson(studentA, `/api/activity-instances/${instanceId}/submit-group`, {
    method: 'POST',
    body: {
      studentId: studentA.id,
      groupNum: 1,
      retriesRequired: 1,
      attempt: {
        submissionString: '1a=done',
        blocked: false,
        canAdvance: true,
        unanswered: [],
        answers: {
          '1a': 'done',
          '1aS': 'complete',
        },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.completed_groups, 1);
  assert.equal(response.body.progress_status, 'in_progress');
  assert.equal(response.body.activeStudentId, studentB.id);

  const [[instance]] = await db.query(
    `SELECT completed_groups, progress_status, active_student_id
     FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instance.completed_groups), 1);
  assert.equal(instance.progress_status, 'in_progress');
  assert.equal(Number(instance.active_student_id), studentB.id);

  const [stateRows] = await db.query(
    `SELECT question_id, response
     FROM responses
     WHERE activity_instance_id = ?
       AND question_id IN ('1a', '1aS', '1state', 'attempt:1')
     ORDER BY id`,
    [instanceId]
  );
  assert.ok(stateRows.some((row) => row.question_id === '1a' && row.response === 'done'));
  assert.ok(stateRows.some((row) => row.question_id === '1aS' && row.response === 'complete'));
  assert.ok(stateRows.some((row) => row.question_id === '1state' && row.response === 'complete'));
  assert.ok(stateRows.some((row) => row.question_id === 'attempt:1'));

  const [drafts] = await db.query(
    `SELECT id FROM response_drafts WHERE activity_instance_id = ?`,
    [instanceId]
  );
  assert.equal(drafts.length, 0);
});

test('submit-group only stores changed questions and freezes accepted ones', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student');
  const studentB = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    groupNumber: 1,
    totalGroups: 3,
    completedGroups: 0,
    progressStatus: 'not_started',
    activeStudentId: studentA.id,
    activeRotationMode: 'group',
  });
  await addGroupMember({ instanceId, studentId: studentA.id, role: 'facilitator', connected: true, lastHeartbeat: '2026-05-01 12:00:00' });
  await addGroupMember({ instanceId, studentId: studentB.id, role: 'analyst', connected: true, lastHeartbeat: '2026-05-01 12:00:01' });

  await db.query(
    `INSERT INTO responses
       (activity_instance_id, question_id, submit_id, response_type, response, answered_by_user_id)
     VALUES
       (?, '1a', 'seed-1', 'text', 'already accepted', ?),
       (?, '1aFM', 'seed-1', 'text', 'accepted', ?),
       (?, '1aAF', 'seed-1', 'text', 'resolved', ?),
       (?, '1b', 'seed-1', 'text', 'old answer', ?)`,
    [instanceId, studentA.id, instanceId, studentA.id, instanceId, studentA.id, instanceId, studentA.id]
  );

  const response = await requestJson(studentA, `/api/activity-instances/${instanceId}/submit-group`, {
    method: 'POST',
    body: {
      studentId: studentA.id,
      groupNum: 1,
      retriesRequired: 1,
      attempt: {
        submissionString: '1a=new;1b=new',
        blocked: false,
        canAdvance: true,
        unanswered: [],
        answers: {
          '1a': 'new attempt that should be ignored',
          '1aF1': 'ignored feedback',
          '1aFM': 'accepted',
          '1aAF': 'resolved',
          '1aS': 'complete',
          '1b': 'new answer',
          '1bF1': 'fresh feedback',
          '1bFM': 'needsRevision',
          '1bAF': 'active',
          '1bS': 'complete',
        },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);

  const [rows] = await db.query(
    `SELECT question_id, response
       FROM responses
      WHERE activity_instance_id = ?
        AND question_id IN ('1a', '1aF1', '1aFM', '1aAF', '1aS', '1b', '1bF1', '1bFM', '1bAF', '1bS')
      ORDER BY id`,
    [instanceId]
  );

  const count = (qid) => rows.filter((row) => row.question_id === qid).length;
  const latest = (qid) => [...rows].reverse().find((row) => row.question_id === qid)?.response ?? null;

  assert.equal(count('1a'), 1);
  assert.equal(count('1aF1'), 0);
  assert.equal(count('1aFM'), 1);
  assert.equal(latest('1a'), 'already accepted');

  assert.equal(count('1b'), 2);
  assert.equal(count('1bF1'), 1);
  assert.equal(count('1bFM'), 1);
  assert.equal(count('1bAF'), 1);
  assert.equal(count('1bS'), 1);
  assert.equal(latest('1b'), 'new answer');
  assert.equal(latest('1bF1'), 'fresh feedback');
});

test('submit-group in group rotation mode does not rotate when the group does not advance', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student');
  const studentB = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    groupNumber: 1,
    totalGroups: 2,
    completedGroups: 0,
    progressStatus: 'not_started',
    activeStudentId: studentA.id,
    activeRotationMode: 'group',
  });
  await addGroupMember({ instanceId, studentId: studentA.id, role: 'facilitator', connected: true, lastHeartbeat: '2026-05-01 12:00:00' });
  await addGroupMember({ instanceId, studentId: studentB.id, role: 'analyst', connected: true, lastHeartbeat: '2026-05-01 12:00:01' });

  const response = await requestJson(studentA, `/api/activity-instances/${instanceId}/submit-group`, {
    method: 'POST',
    body: {
      studentId: studentA.id,
      groupNum: 1,
      retriesRequired: 1,
      attempt: {
        submissionString: '1a=partial',
        blocked: true,
        canAdvance: false,
        unanswered: ['1b'],
        answers: {
          '1a': 'partial',
          '1aS': 'inprogress',
        },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.completed_groups, 0);
  assert.equal(response.body.progress_status, 'in_progress');
  assert.ok(!Object.prototype.hasOwnProperty.call(response.body, 'activeStudentId'));

  const [[instance]] = await db.query(
    `SELECT completed_groups, progress_status, active_student_id
     FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instance.completed_groups), 0);
  assert.equal(instance.progress_status, 'in_progress');
  assert.equal(Number(instance.active_student_id), studentA.id);

  const [[groupState]] = await db.query(
    `SELECT response
     FROM responses
     WHERE activity_instance_id = ? AND question_id = '1state'
     ORDER BY id DESC
     LIMIT 1`,
    [instanceId]
  );
  assert.equal(groupState.response, 'inprogress');
});

test('submit-group does not rotate active student after final group completion', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student');
  const studentB = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    groupNumber: 1,
    totalGroups: 2,
    completedGroups: 1,
    progressStatus: 'in_progress',
    activeStudentId: studentA.id,
    activeRotationMode: 'submit',
  });
  await addGroupMember({ instanceId, studentId: studentA.id, role: 'facilitator', connected: true, lastHeartbeat: '2026-05-01 12:00:00' });
  await addGroupMember({ instanceId, studentId: studentB.id, role: 'analyst', connected: true, lastHeartbeat: '2026-05-01 12:00:01' });

  await db.query(
    `INSERT INTO responses (activity_instance_id, question_id, response, response_type, answered_by_user_id)
     VALUES (?, '1state', 'complete', 'text', ?)`,
    [instanceId, studentA.id]
  );

  const response = await requestJson(studentA, `/api/activity-instances/${instanceId}/submit-group`, {
    method: 'POST',
    body: {
      studentId: studentA.id,
      groupNum: 2,
      retriesRequired: 1,
      attempt: {
        submissionString: '2a=done',
        blocked: false,
        canAdvance: true,
        unanswered: [],
        answers: {
          '2a': 'done',
          '2aS': 'complete',
        },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.completed_groups, 2);
  assert.equal(response.body.progress_status, 'completed');
  assert.ok(Object.prototype.hasOwnProperty.call(response.body, 'activeStudentId'));
  assert.equal(response.body.activeStudentId, null);

  const [[instance]] = await db.query(
    `SELECT completed_groups, progress_status, active_student_id
     FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instance.completed_groups), 2);
  assert.equal(instance.progress_status, 'completed');

  assert.equal(instance.active_student_id, null);
});

test('submit-group recomputes total groups from source before marking completion', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student');
  const studentB = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    groupNumber: 1,
    totalGroups: 3,
    completedGroups: 2,
    progressStatus: 'in_progress',
    activeStudentId: studentA.id,
    activeRotationMode: 'submit',
  });
  await addGroupMember({ instanceId, studentId: studentA.id, role: 'facilitator', connected: true, lastHeartbeat: '2026-05-01 12:00:00' });
  await addGroupMember({ instanceId, studentId: studentB.id, role: 'analyst', connected: true, lastHeartbeat: '2026-05-01 12:00:01' });

  const contentText = [
    '\\questiongroup{One}',
    '\\question{Q1}',
    '\\textresponse{1}',
    '\\endquestion',
    '\\endquestiongroup',
    '\\questiongroup{Two}',
    '\\question{Q2}',
    '\\textresponse{1}',
    '\\endquestion',
    '\\endquestiongroup',
    '\\questiongroup{Three}',
    '\\question{Q3}',
    '\\textresponse{1}',
    '\\endquestion',
    '\\endquestiongroup',
    '\\questiongroup{Four}',
    '\\question{Q4}',
    '\\textresponse{1}',
    '\\endquestion',
    '\\endquestiongroup',
  ].join('\n');

  await db.query(
    `UPDATE pogil_activities
        SET source_type = 'local',
            content_text = ?
      WHERE id = ?`,
    [contentText, activityId]
  );

  await db.query(
    `INSERT INTO responses (activity_instance_id, question_id, response, response_type, answered_by_user_id)
     VALUES
       (?, '1state', 'complete', 'text', ?),
       (?, '2state', 'complete', 'text', ?)`,
    [instanceId, studentA.id, instanceId, studentA.id]
  );

  const response = await requestJson(studentA, `/api/activity-instances/${instanceId}/submit-group`, {
    method: 'POST',
    body: {
      studentId: studentA.id,
      groupNum: 3,
      retriesRequired: 1,
      attempt: {
        submissionString: '3a=done',
        blocked: false,
        canAdvance: true,
        unanswered: [],
        answers: {
          '3a': 'done',
          '3aS': 'complete',
        },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.completed_groups, 3);
  assert.equal(response.body.progress_status, 'in_progress');
  assert.equal(response.body.activeStudentId, studentB.id);

  const [[instance]] = await db.query(
    `SELECT total_groups, completed_groups, progress_status, active_student_id
     FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instance.total_groups), 4);
  assert.equal(Number(instance.completed_groups), 3);
  assert.equal(instance.progress_status, 'in_progress');
  assert.equal(Number(instance.active_student_id), studentB.id);
});

test('heartbeat does not reactivate a completed activity instance', async () => {
  const student = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: student.id, classId });
  const activityId = await createActivity({ classId, createdBy: student.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    totalGroups: 2,
    completedGroups: 2,
    progressStatus: 'completed',
    activeStudentId: student.id,
  });
  await addGroupMember({
    instanceId,
    studentId: student.id,
    role: 'facilitator',
    connected: true,
    lastHeartbeat: '2026-05-01 12:00:00',
  });

  const response = await requestJson(student, `/api/activity-instances/${instanceId}/heartbeat`, {
    method: 'POST',
    body: {
      userId: student.id,
      timerInfo: {},
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.becameActive, false);
  assert.equal(response.body.activeStudentId, null);

  const [[instance]] = await db.query(
    `SELECT active_student_id, progress_status
     FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(instance.progress_status, 'completed');
  assert.equal(instance.active_student_id, null);
});

test('active-student returns null for completed activity instances and clears stale active user', async () => {
  const student = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: student.id, classId });
  const activityId = await createActivity({ classId, createdBy: student.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    totalGroups: 2,
    completedGroups: 2,
    progressStatus: 'completed',
    activeStudentId: student.id,
  });

  const response = await requestJson(student, `/api/activity-instances/${instanceId}/active-student`);

  assert.equal(response.status, 200);
  assert.equal(response.body.activeStudentId, null);

  const [[instance]] = await db.query(
    `SELECT active_student_id, progress_status
     FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(instance.progress_status, 'completed');
  assert.equal(instance.active_student_id, null);
});

test('active-student reassigns a stale active user to the most recent present member', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student');
  const studentB = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    totalGroups: 2,
    activeStudentId: studentA.id,
  });

  await addGroupMember({ instanceId, studentId: studentA.id, connected: true });
  await addGroupMember({ instanceId, studentId: studentB.id, connected: true });

  await db.query(
    `UPDATE group_members
        SET last_heartbeat = DATE_SUB(NOW(), INTERVAL 3 MINUTE)
      WHERE activity_instance_id = ? AND student_id = ?`,
    [instanceId, studentA.id]
  );
  await db.query(
    `UPDATE group_members
        SET last_heartbeat = DATE_SUB(NOW(), INTERVAL 30 SECOND)
      WHERE activity_instance_id = ? AND student_id = ?`,
    [instanceId, studentB.id]
  );

  const response = await requestJson(studentB, `/api/activity-instances/${instanceId}/active-student`);

  assert.equal(response.status, 200);
  assert.equal(Number(response.body.activeStudentId), studentB.id);

  const [[instance]] = await db.query(
    `SELECT active_student_id
       FROM activity_instances
      WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instance.active_student_id), studentB.id);
});

test('demo-roster reset clears demo activity groups, responses, and drafts', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student');
  const studentB = await createUser('student');
  const classId = await createClassRecord({ demoMode: true });
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceOne = await createInstance({ activityId, courseId, groupNumber: 1 });
  const instanceTwo = await createInstance({ activityId, courseId, groupNumber: 2 });

  await addGroupMember({ instanceId: instanceOne, studentId: studentA.id, role: 'facilitator', connected: true });
  await addGroupMember({ instanceId: instanceTwo, studentId: studentB.id, role: 'analyst', connected: true });

  await db.query(
    `INSERT INTO responses
       (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, '1a', 'text', 'hello', ?)`,
    [instanceOne, studentA.id]
  );
  await db.query(
    `INSERT INTO response_drafts
       (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, '1a', 'text', 'draft', ?)`,
    [instanceTwo, studentB.id]
  );

  const response = await requestJson(
    instructor,
    `/api/activity-instances/by-activity/${courseId}/${activityId}/demo-roster`,
    { method: 'DELETE' }
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(Number(response.body.clearedInstances), 2);
  assert.equal(Number(response.body.clearedMembers), 2);
  assert.equal(Number(response.body.clearedResponses), 1);
  assert.equal(Number(response.body.clearedDrafts), 1);

  const [[instanceCount]] = await db.query(
    `SELECT COUNT(*) AS count
       FROM activity_instances
      WHERE course_id = ? AND activity_id = ?`,
    [courseId, activityId]
  );
  assert.equal(Number(instanceCount.count), 0);

  const [[memberCount]] = await db.query(
    `SELECT COUNT(*) AS count
       FROM group_members
      WHERE activity_instance_id IN (?, ?)`,
    [instanceOne, instanceTwo]
  );
  assert.equal(Number(memberCount.count), 0);

  const [[responseCount]] = await db.query(
    `SELECT COUNT(*) AS count
       FROM responses
      WHERE activity_instance_id IN (?, ?)`,
    [instanceOne, instanceTwo]
  );
  assert.equal(Number(responseCount.count), 0);

  const [[draftCount]] = await db.query(
    `SELECT COUNT(*) AS count
       FROM response_drafts
      WHERE activity_instance_id IN (?, ?)`,
    [instanceOne, instanceTwo]
  );
  assert.equal(Number(draftCount.count), 0);
});

test('clear responses resets progress and timer fields on the instance', async () => {
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    totalGroups: 4,
    completedGroups: 3,
    progressStatus: 'completed',
    sectionTimerKey: 'section-3',
    sectionTimerDurationMinutes: 7,
    sectionTimerStartedAt: '2026-05-01 09:00:00',
    sectionTimerPaused: 1,
    sectionTimerPausedAt: '2026-05-01 09:04:00',
  });

  await db.query(
    `INSERT INTO responses (activity_instance_id, question_id, submit_id, response_type, response, answered_by_user_id)
     VALUES (?, '1a', 'submit-1', 'text', 'saved', ?)`,
    [instanceId, instructor.id]
  );

  const response = await requestJson(instructor, `/api/activity-instances/${instanceId}/responses`, {
    method: 'DELETE',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.cleared, 1);

  const [[instance]] = await db.query(
    `SELECT completed_groups, progress_status, section_timer_key, section_timer_duration_minutes,
            section_timer_started_at, section_timer_paused, section_timer_paused_at
     FROM activity_instances WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instance.completed_groups), 0);
  assert.equal(instance.progress_status, 'in_progress');
  assert.equal(instance.section_timer_key, null);
  assert.equal(instance.section_timer_duration_minutes, null);
  assert.equal(instance.section_timer_started_at, null);
  assert.equal(Number(instance.section_timer_paused), 0);
  assert.equal(instance.section_timer_paused_at, null);
});

test('students cannot fetch a hidden instance, but instructors still can', async () => {
  const instructor = await createUser('instructor');
  const student = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId });

  await db.query(
    `UPDATE activity_instances
        SET hidden = 1
      WHERE id = ?`,
    [instanceId]
  );

  const studentResponse = await requestJson(student, `/api/activity-instances/${instanceId}`);
  assert.equal(studentResponse.status, 403);
  assert.equal(studentResponse.body.error, 'This activity is currently hidden.');

  const instructorResponse = await requestJson(instructor, `/api/activity-instances/${instanceId}`);
  assert.equal(instructorResponse.status, 200);
  assert.equal(instructorResponse.body.id, instanceId);
  assert.equal(Number(instructorResponse.body.hidden), 1);
});

test('setup-groups returns 409 when group 1 already exists for the activity', async () => {
  const instructor = await createUser('instructor');
  const student = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  await createInstance({ activityId, courseId, groupNumber: 1 });

  const response = await requestJson(instructor, '/api/activity-instances/setup-groups', {
    method: 'POST',
    body: {
      activityId,
      courseId,
      groups: [
        {
          members: [{ student_id: student.id, role: 'facilitator' }],
        },
      ],
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'Groups already exist for this activity.');

  const [[countRow]] = await db.query(
    `SELECT COUNT(*) AS instance_count
       FROM activity_instances
      WHERE activity_id = ? AND course_id = ?`,
    [activityId, courseId]
  );
  assert.equal(Number(countRow.instance_count), 1);
});

test('submit-test regrade fails cleanly when legacy ownership is ambiguous', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student');
  const studentB = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId });

  await addGroupMember({ instanceId, studentId: studentA.id, role: 'facilitator', connected: true });
  await addGroupMember({ instanceId, studentId: studentB.id, role: 'analyst', connected: true });

  const response = await requestJson(instructor, `/api/activity-instances/${instanceId}/submit-test`, {
    method: 'POST',
    body: {
      regrade: true,
      answers: {},
      questions: [],
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Cannot determine which student owns this test attempt.');

  const [[instance]] = await db.query(
    `SELECT submitted_by_user_id
       FROM activity_instances
      WHERE id = ?`,
    [instanceId]
  );
  assert.equal(instance.submitted_by_user_id, null);
});

test('rotate-active-student returns 404 when no recent group members are present', async () => {
  const instructor = await createUser('instructor');
  const studentA = await createUser('student');
  const studentB = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({
    activityId,
    courseId,
    activeStudentId: studentA.id,
  });

  await addGroupMember({ instanceId, studentId: studentA.id, role: 'facilitator', connected: false });
  await addGroupMember({ instanceId, studentId: studentB.id, role: 'analyst', connected: false });

  const response = await requestJson(instructor, `/api/activity-instances/${instanceId}/rotate-active-student`, {
    method: 'POST',
    body: { currentStudentId: studentA.id },
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'No active group members');

  const [[instance]] = await db.query(
    `SELECT active_student_id
       FROM activity_instances
      WHERE id = ?`,
    [instanceId]
  );
  assert.equal(Number(instance.active_student_id), studentA.id);
});

test('test-settings rejects invalid scheduling payloads without changing stored values', async () => {
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId });

  await db.query(
    `UPDATE activity_instances
        SET test_start_at = '2026-05-01 13:00:00',
            test_duration_minutes = 30,
            test_reopen_until = '2026-05-01 13:20:00'
      WHERE id = ?`,
    [instanceId]
  );

  const response = await requestJson(instructor, `/api/activity-instances/${instanceId}/test-settings`, {
    method: 'POST',
    body: {
      testStartAt: 'not-a-date',
      testDurationMinutes: 25,
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Invalid testStartAt');

  const [[instance]] = await db.query(
    `SELECT test_start_at, test_duration_minutes, test_reopen_until
       FROM activity_instances
      WHERE id = ?`,
    [instanceId]
  );
  assert.equal(String(instance.test_start_at).slice(0, 19), '2026-05-01 13:00:00');
  assert.equal(Number(instance.test_duration_minutes), 30);
  assert.equal(String(instance.test_reopen_until).slice(0, 19), '2026-05-01 13:20:00');
});

test('reopen rejects already-submitted timed tests so instructors must clear answers first', async () => {
  const instructor = await createUser('instructor');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId });

  await db.query(
    `UPDATE activity_instances
        SET test_start_at = '2026-05-01 13:00:00',
            test_duration_minutes = 30,
            submitted_at = '2026-05-01 13:25:00',
            test_reopen_until = NULL
      WHERE id = ?`,
    [instanceId]
  );

  const response = await requestJson(instructor, `/api/activity-instances/${instanceId}/reopen`, {
    method: 'POST',
    body: { minutes: 15 },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Test already submitted; clear answers to reopen.');

  const [[instance]] = await db.query(
    `SELECT test_reopen_until
       FROM activity_instances
      WHERE id = ?`,
    [instanceId]
  );
  assert.equal(instance.test_reopen_until, null);
});

test("classifyProgressStatus respects the active-thinking guard and feedback/fall-behind states", async () => {
  const { classifyProgressStatus } = await import(pathToFileURL(path.join(__dirname, "..", "..", "client/src/pages/run-activity/useRunActivitySync.js")).href);

  const activity = {
    progress_status: "in_progress",
    section_timer_started_at: "2026-05-01 12:00:00",
    section_timer_duration_minutes: 10,
    section_timer_paused: 0,
  };

  assert.equal(
    classifyProgressStatus({
      now: new Date("2026-05-01T12:02:00Z").getTime(),
      activity,
      currentTimedSection: { minutes: 10 },
      groupMembers: [{ connected: false, last_heartbeat: "2026-05-01 12:01:45" }],
      latestDraftAt: "2026-05-01 12:01:50",
      latestSubmissionAt: null,
      latestFeedbackAt: null,
      submittedQuestionCount: 0,
      currentQuestionCount: 2,
      peerSignals: [],
    }),
    "active_thinking"
  );

  assert.equal(
    classifyProgressStatus({
      now: new Date("2026-05-01T12:06:30Z").getTime(),
      activity,
      currentTimedSection: { minutes: 10 },
      groupMembers: [{ connected: false, last_heartbeat: "2026-05-01 12:01:45" }],
      latestDraftAt: "2026-05-01 12:01:50",
      latestSubmissionAt: null,
      latestFeedbackAt: "2026-05-01 12:04:00",
      submittedQuestionCount: 0,
      currentQuestionCount: 2,
      peerSignals: [],
    }),
    "stuck_after_feedback"
  );

  assert.equal(
    classifyProgressStatus({
      now: new Date("2026-05-01T12:09:30Z").getTime(),
      activity,
      currentTimedSection: { minutes: 10 },
      groupMembers: [{ connected: false, last_heartbeat: "2026-05-01 12:00:30" }],
      latestDraftAt: "2026-05-01 12:00:45",
      latestSubmissionAt: null,
      latestFeedbackAt: null,
      submittedQuestionCount: 0,
      currentQuestionCount: 2,
      peerSignals: [
        { latestDraftAt: "2026-05-01 12:08:45", latestSubmissionAt: "2026-05-01 12:08:45" },
        { latestDraftAt: "2026-05-01 12:08:30", latestSubmissionAt: "2026-05-01 12:08:30" },
      ],
    }),
    "falling_behind"
  );
});

test("progress status changes broadcast to the room and are written to audit_log", async () => {
  const instructor = await createUser("instructor");
  const student = await createUser("student");
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, activeStudentId: student.id });
  await addGroupMember({ instanceId, studentId: student.id, connected: true });

  const server = await createTestServer(instructor, true);
  const socketIoClient = require(require.resolve("socket.io-client", { paths: [path.join(__dirname, "..", "..", "client")] }));
  const teammateSocket = socketIoClient.io(server.baseUrl, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });

  try {
    await new Promise((resolve, reject) => {
      teammateSocket.once("connect", resolve);
      teammateSocket.once("connect_error", reject);
    });
    teammateSocket.emit("instance:join", { instanceId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const eventPromise = new Promise((resolve) => {
      teammateSocket.once("progress:status", resolve);
    });

    const response = await fetch(server.baseUrl + "/api/activity-instances/" + instanceId + "/progress-monitor/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        previousStatus: "active_thinking",
        newStatus: "needs_check_in",
      }),
    });

    assert.equal(response.status, 200);
    const responseBody = await response.json();
    assert.equal(responseBody.ok, true);
    assert.equal(responseBody.emitted, true);
    assert.equal(responseBody.status, "needs_check_in");

    const event = await eventPromise;
    assert.equal(Number(event.instanceId), instanceId);
    assert.equal(Number(event.activityInstanceId), instanceId);
    assert.equal(event.previousStatus, "active_thinking");
    assert.equal(event.newStatus, "needs_check_in");

    const [[auditRow]] = await db.query(
      "SELECT event_type, details FROM audit_log WHERE activity_instance_id = ? ORDER BY id DESC LIMIT 1",
      [instanceId]
    );

    assert.equal(auditRow.event_type, "progress_status_change");
    assert.deepEqual(JSON.parse(auditRow.details), {
      previous_status: "active_thinking",
      new_status: "needs_check_in",
      activity_instance_id: instanceId,
    });
  } finally {
    teammateSocket.close();
    await server.close();
  }
});

test("progress monitor board returns the latest status rows and relays live updates", async () => {
  const instructor = await createUser("instructor");
  const student = await createUser("student");
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, activeStudentId: student.id });
  await addGroupMember({ instanceId, studentId: student.id, connected: true });

  const server = await createTestServer(instructor, true);
  const socketIoClient = require(require.resolve("socket.io-client", { paths: [path.join(__dirname, "..", "..", "client")] }));
  const dashboardSocket = socketIoClient.io(server.baseUrl, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });

  try {
    await new Promise((resolve, reject) => {
      dashboardSocket.once("connect", resolve);
      dashboardSocket.once("connect_error", reject);
    });

    dashboardSocket.emit("progress-monitor:join", { courseId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const liveEventPromise = new Promise((resolve) => {
      dashboardSocket.once("progress:status", resolve);
    });

    const postResponse = await fetch(server.baseUrl + "/api/activity-instances/" + instanceId + "/progress-monitor/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        previousStatus: "active_thinking",
        newStatus: "needs_check_in",
      }),
    });

    assert.equal(postResponse.status, 200);
    const postBody = await postResponse.json();
    assert.equal(postBody.ok, true);
    assert.equal(postBody.emitted, true);

    const liveEvent = await liveEventPromise;
    assert.equal(Number(liveEvent.instanceId), instanceId);
    assert.equal(Number(liveEvent.courseId), courseId);
    assert.equal(liveEvent.newStatus, "needs_check_in");

    const boardResponse = await fetch(server.baseUrl + "/api/progress-monitor/statuses?courseId=" + courseId, {
      credentials: "include",
    });
    assert.equal(boardResponse.status, 200);
    const board = await boardResponse.json();
    assert.equal(board.scope.courseId, courseId);
    assert.equal(board.summary.totalGroups, 1);
    assert.equal(board.summary.byStatus.needs_check_in, 1);
    assert.equal(board.rows.length, 1);
    assert.equal(board.rows[0].activityInstanceId, instanceId);
    assert.equal(board.rows[0].currentStatus, "needs_check_in");
    assert.ok(board.rows[0].statusAgeMs >= 0);

  } finally {
    dashboardSocket.close();
    await server.close();
  }
});


test('progress monitor suggestion pipeline stores a suggestion and lets instructors act on it', async () => {
  const originalLLM = aiController.callLLMJsonStrict;
  aiController.callLLMJsonStrict = async () => ({ suggestion: 'Ask the facilitator to restate the goal.' });

  const instructor = await createUser('instructor');
  const student = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, activeStudentId: student.id });
  await addGroupMember({ instanceId, studentId: student.id, connected: true });

  const submitId = uniqueValue('submit');
  await db.query(
    `INSERT INTO responses (activity_instance_id, question_id, submit_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, ?, 'text', ?, ?)`,
    [instanceId, '1a', submitId, 'We are still thinking about the pattern.', student.id]
  );
  await db.query(
    `INSERT INTO feedback (response_id, feedback_text) VALUES ((SELECT id FROM responses WHERE activity_instance_id = ? AND question_id = ? ORDER BY id DESC LIMIT 1), ?)`,
    [instanceId, '1a', 'Focus on the goal before choosing an operation.']
  );
  await db.query(
    `INSERT INTO followups (response_id, followup_prompt, followup_generated) VALUES ((SELECT id FROM responses WHERE activity_instance_id = ? AND question_id = ? ORDER BY id DESC LIMIT 1), ?, ?)`,
    [instanceId, '1a', 'What changed after the last attempt?', 'Ask the analyst what changed after the last attempt.']
  );

  const server = await createTestServer(instructor, true);
  try {
    const response = await fetch(`${server.baseUrl}/api/activity-instances/${instanceId}/progress-monitor/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ previousStatus: 'active_thinking', newStatus: 'needs_check_in' }),
    });
    assert.equal(response.status, 200);

    let board = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const boardResponse = await fetch(`${server.baseUrl}/api/progress-monitor/statuses?courseId=${courseId}`, {
        credentials: 'include',
      });
      board = await boardResponse.json();
      const suggestion = board.rows?.[0]?.suggestion;
      if (suggestion?.text === 'Ask the facilitator to restate the goal.') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const [suggestionRows] = await db.query(
      'SELECT * FROM progress_monitor_suggestions WHERE activity_instance_id = ? ORDER BY id DESC',
      [instanceId]
    );
    assert.equal(suggestionRows.length, 1, `expected a generated suggestion row; board=${JSON.stringify(board)}`);
    assert.equal(suggestionRows[0].suggestion_text, 'Ask the facilitator to restate the goal.');
    const suggestionId = suggestionRows[0].id;
    const dismissResponse = await fetch(`${server.baseUrl}/api/progress-monitor/suggestions/${suggestionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'dismissed' }),
    });
    assert.equal(dismissResponse.status, 200);
    const dismissed = await dismissResponse.json();
    assert.equal(dismissed.suggestion.state, 'dismissed');

    const [afterDismissRows] = await db.query(
      'SELECT suggestion_state FROM progress_monitor_suggestions WHERE id = ?',
      [suggestionId]
    );
    assert.equal(afterDismissRows[0].suggestion_state, 'dismissed');
  } finally {
    aiController.callLLMJsonStrict = originalLLM;
    await server.close();
  }
});

test('progress monitor suggestion debounce prevents duplicate rapid triggers', async () => {
  const originalLLM = aiController.callLLMJsonStrict;
  let calls = 0;
  aiController.callLLMJsonStrict = async () => {
    calls += 1;
    return { suggestion: 'Give a time warning.' };
  };

  const instructor = await createUser('instructor');
  const student = await createUser('student');
  const classId = await createClassRecord();
  const courseId = await createCourse({ instructorId: instructor.id, classId });
  const activityId = await createActivity({ classId, createdBy: instructor.id });
  const instanceId = await createInstance({ activityId, courseId, activeStudentId: student.id });
  await addGroupMember({ instanceId, studentId: student.id, connected: true });

  const server = await createTestServer(instructor);
  try {
    const body = { previousStatus: 'active_thinking', newStatus: 'falling_behind' };
    const one = fetch(`${server.baseUrl}/api/activity-instances/${instanceId}/progress-monitor/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const two = fetch(`${server.baseUrl}/api/activity-instances/${instanceId}/progress-monitor/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    assert.equal((await one).status, 200);
    assert.equal((await two).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const [suggestions] = await db.query(
      'SELECT * FROM progress_monitor_suggestions WHERE activity_instance_id = ?',
      [instanceId]
    );
    assert.equal(suggestions.length, 1);
    assert.equal(calls, 1);
  } finally {
    aiController.callLLMJsonStrict = originalLLM;
    await server.close();
  }
});

test('progress monitor suggestion sanitizer rejects answer-like phrasing', () => {
  const { sanitizeSuggestionText } = require('../progress_monitor/service');
  assert.equal(sanitizeSuggestionText('The answer is 42.'), null);
  assert.equal(sanitizeSuggestionText('Ask the group to compare the last attempt.'), 'Ask the group to compare the last attempt.');
});
