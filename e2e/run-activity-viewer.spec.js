const { test, expect } = require('@playwright/test');
const bcrypt = require('../server/node_modules/bcryptjs');
const db = require('../server/db');

const PASSWORD = 'RunActivityE2E-password-1!';
const E2E_API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:4174';

function uniquePrefix() {
  return `e2e-runactivity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function localActivityContent() {
  return [
    '\\title{coLearn-AI Demo: Spiral Reasoning}',
    '\\mode{group}',
    '\\activitycontext{Students reason about spirals using text and Python turtle.}',
    '\\studentlevel{introductory programming}',
    '\\aicodeguidance{Accept concise answers that directly address the prompt.}',
    '',
    '\\questiongroup{Predict the spiral}',
    '\\question{In one sentence, explain why increasing the turn angle changes the spiral shape.}',
    '\\textresponse{3}',
    '\\sampleresponses{The angle changes how sharply the turtle turns, so each step rotates into a different spiral path.}',
    '\\feedbackprompt{Accept any concrete explanation about turn angle changing direction or curvature.}',
    '\\followupprompt{No follow-ups}',
    '\\endquestion',
    '\\endquestiongroup',
    '',
    '\\questiongroup{Draw and explain}',
    '\\question{Edit the turtle program so it draws a visible spiral, then describe what your loop changes each step.}',
    '\\textresponse{3}',
    '\\pythonturtle{width=320,height=220,timelimit=5000}',
    'import turtle',
    't = turtle.Turtle()',
    't.speed(0)',
    'for i in range(18):',
    '    t.forward(8 + i * 4)',
    '    t.right(35)',
    '\\endpythonturtle',
    '\\sampleresponses{The loop increases the distance while turning by a fixed angle, creating the spiral.}',
    '\\feedbackprompt{Accept a runnable turtle loop and a short explanation of changing distance or angle.}',
    '\\followupprompt{No follow-ups}',
    '\\endquestion',
    '\\endquestiongroup',
  ].join('\n');
}

async function seedRunActivityFixture() {
  const prefix = uniquePrefix();
  const passwordHash = bcrypt.hashSync(PASSWORD, 4);
  const ids = {
    prefix,
    users: [],
    classes: [],
    courses: [],
    activities: [],
    instances: [],
  };

  const instructorEmail = `${prefix}-instructor@example.com`;
  const studentEmail = `${prefix}-student@example.com`;

  const [instructorResult] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [`${prefix} Instructor`, instructorEmail, passwordHash, 'instructor']
  );
  const instructorId = Number(instructorResult.insertId);
  ids.users.push(instructorId);

  const [studentResult] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [`${prefix} Student`, studentEmail, passwordHash, 'student']
  );
  const studentId = Number(studentResult.insertId);
  ids.users.push(studentId);

  const [classResult] = await db.query(
    'INSERT INTO pogil_classes (name, description, created_by) VALUES (?, ?, ?)',
    [`${prefix} Class`, 'Temporary RunActivity E2E class', instructorId]
  );
  const classId = Number(classResult.insertId);
  ids.classes.push(classId);

  const [courseResult] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`${prefix} Course`, prefix.slice(-8).toUpperCase(), 'E2E', 'spring', 2026, instructorId, classId]
  );
  const courseId = Number(courseResult.insertId);
  ids.courses.push(courseId);

  await db.query(
    'INSERT INTO course_enrollments (course_id, student_id) VALUES (?, ?)',
    [courseId, studentId]
  ).catch((err) => {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
  });

  const [activityResult] = await db.query(
    `INSERT INTO pogil_activities
       (name, title, sheet_url, source_type, content_text, class_id, order_index, created_by, is_test)
     VALUES (?, ?, ?, 'local', ?, ?, ?, ?, ?)`,
    [
      `${prefix}-activity`,
      'coLearn-AI Demo: Spiral Reasoning',
      null,
      localActivityContent(),
      classId,
      1,
      instructorId,
      0,
    ]
  );
  const activityId = Number(activityResult.insertId);
  ids.activities.push(activityId);

  const [instanceResult] = await db.query(
    `INSERT INTO activity_instances
       (activity_id, course_id, status, group_number, total_groups, completed_groups,
        progress_status, active_student_id, active_rotation_mode)
     VALUES (?, ?, 'in_progress', ?, ?, ?, 'in_progress', ?, 'submit')`,
    [activityId, courseId, 1, 2, 0, studentId]
  );
  const instanceId = Number(instanceResult.insertId);
  ids.instances.push(instanceId);

  await db.query(
    `INSERT INTO group_members
       (activity_instance_id, student_id, role, connected, last_heartbeat)
     VALUES (?, ?, ?, ?, NOW())`,
    [instanceId, studentId, 'facilitator', 1]
  );

  return {
    ids,
    instructor: { id: instructorId, email: instructorEmail },
    student: { id: studentId, email: studentEmail },
    classId,
    courseId,
    activityId,
    instanceId,
  };
}

async function cleanupFixture(ids) {
  if (!ids) return;
  const { prefix } = ids;

  try {
    if (ids.instances?.length) {
      await db.query('DELETE FROM response_drafts WHERE activity_instance_id IN (?)', [ids.instances]);
      await db.query('DELETE FROM responses WHERE activity_instance_id IN (?)', [ids.instances]);
      await db.query('DELETE FROM activity_heartbeats WHERE activity_instance_id IN (?)', [ids.instances]).catch(() => {});
      await db.query('DELETE FROM event_log WHERE activity_instance_id IN (?)', [ids.instances]).catch(() => {});
      await db.query('DELETE FROM group_members WHERE activity_instance_id IN (?)', [ids.instances]);
      await db.query('DELETE FROM activity_instances WHERE id IN (?)', [ids.instances]);
    }
    if (ids.courses?.length) {
      await db.query('DELETE FROM course_enrollments WHERE course_id IN (?)', [ids.courses]).catch(() => {});
    }
    if (ids.activities?.length) {
      await db.query('DELETE FROM pogil_activities WHERE id IN (?)', [ids.activities]);
    }
    if (ids.courses?.length) {
      await db.query('DELETE FROM courses WHERE id IN (?)', [ids.courses]);
    }
    if (ids.classes?.length) {
      await db.query('DELETE FROM pogil_classes WHERE id IN (?)', [ids.classes]);
    }
    if (ids.users?.length) {
      await db.query('DELETE FROM users WHERE id IN (?)', [ids.users]);
    }

    await db.query('DELETE FROM users WHERE email LIKE ?', [`${prefix}-%@example.com`]).catch(() => {});
    await db.query('DELETE FROM pogil_classes WHERE name LIKE ?', [`${prefix}%`]).catch(() => {});
  } catch (err) {
    console.error('[run-activity-e2e] cleanup failed', err);
    throw err;
  }
}

async function login(page, email) {
  const response = await page.request.post(`${E2E_API_BASE_URL}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
}

async function installAcceptedAIRoutes(page, calls = []) {
  await page.route('**/api/ai/evaluate-response', async (route) => {
    calls.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accepted: true,
        feedback: null,
        canContinue: true,
        retryCount: 0,
        retriesRequired: 1,
      }),
    });
  });

  await page.route('**/api/ai/evaluate-code', async (route) => {
    calls.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accepted: true,
        feedback: null,
        canContinue: true,
        retryCount: 0,
        retriesRequired: 1,
      }),
    });
  });
}

async function responseCount(instanceId) {
  const [[row]] = await db.query(
    'SELECT COUNT(*) AS count FROM responses WHERE activity_instance_id = ?',
    [instanceId]
  );
  return Number(row.count);
}

async function draftCount(instanceId) {
  const [[row]] = await db.query(
    'SELECT COUNT(*) AS count FROM response_drafts WHERE activity_instance_id = ?',
    [instanceId]
  );
  return Number(row.count);
}

async function latestResponses(instanceId) {
  const [rows] = await db.query(
    `SELECT r.question_id, r.response
       FROM responses r
       JOIN (
         SELECT question_id, MAX(id) AS max_id
           FROM responses
          WHERE activity_instance_id = ?
          GROUP BY question_id
       ) latest ON latest.question_id = r.question_id AND latest.max_id = r.id
      WHERE r.activity_instance_id = ?`,
    [instanceId, instanceId]
  );
  return Object.fromEntries(rows.map((row) => [row.question_id, row.response]));
}

async function openRun(page, instanceId, mode) {
  const apiFailures = [];
  const consoleMessages = [];
  const pageErrors = [];
  const responseListener = (response) => {
    const url = response.url();
    if (url.includes('/api/') && response.status() >= 400) {
      apiFailures.push(`${response.status()} ${url}`);
    }
  };

  const consoleListener = (msg) => {
    if (['error', 'warning'].includes(msg.type())) {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    }
  };
  const pageErrorListener = (err) => {
    pageErrors.push(err?.stack || err?.message || String(err));
  };

  page.on('response', responseListener);
  page.on('console', consoleListener);
  page.on('pageerror', pageErrorListener);
  try {
    await page.goto(`/run/${instanceId}?mode=${mode}`);
    try {
      await expect(page.locator('textarea[data-response-key="1a"]')).toBeVisible();
    } catch (err) {
      const text = await page.locator('body').innerText().catch(() => '');
      throw new Error([
        `RunActivity did not render the first response field for mode ${mode}.`,
        apiFailures.length ? `API failures:\n${apiFailures.join('\n')}` : 'API failures: none observed',
        pageErrors.length ? `Page errors:\n${pageErrors.join('\n---\n')}` : 'Page errors: none observed',
        consoleMessages.length ? `Console warnings/errors:\n${consoleMessages.join('\n')}` : 'Console warnings/errors: none observed',
        `Page HTML:\n${(await page.content()).slice(0, 2000)}`,
        `Page text:\n${text.slice(0, 2000)}`,
        `Original error: ${err?.message || err}`,
      ].join('\n\n'));
    }
  } finally {
    page.off('response', responseListener);
    page.off('console', consoleListener);
    page.off('pageerror', pageErrorListener);
  }
}

test.describe('unified RunActivity viewer', () => {
  let fixture;

  test.afterEach(async () => {
    await cleanupFixture(fixture?.ids);
    fixture = null;
  });

  test.afterAll(async () => {
    await db.end();
  });

  test('runs student, instructor, preview, and creator sandbox modes against one local activity instance', async ({ page }) => {
    fixture = await seedRunActivityFixture();

    const aiCalls = [];
    await installAcceptedAIRoutes(page, aiCalls);

    await login(page, fixture.student.email);
    await openRun(page, fixture.instanceId, 'student_run');

    await page.locator('textarea[data-response-key="1a"]').fill(
      'A larger turn angle changes the direction more each step, so the path curls into a tighter spiral.'
    );
    await page.getByRole('button', { name: 'Submit and Continue' }).click();

    await expect(page.locator('textarea[data-response-key="2a"]')).toBeVisible();
    await page.locator('textarea[data-response-key="2a"]').fill(
      'The loop increases the forward distance each time while keeping a steady turn, so each segment expands outward.'
    );
    await page.getByRole('button', { name: 'Edit Code' }).click();
    await page.locator('textarea[data-response-key="2acode1"]:visible').fill([
      'import turtle',
      't = turtle.Turtle()',
      't.speed(0)',
      'for i in range(24):',
      '    t.forward(6 + i * 5)',
      '    t.right(37)',
    ].join('\n'));
    await page.getByRole('button', { name: 'Done Editing' }).click();
    await page.getByRole('button', { name: 'Submit and Continue' }).click();

    await expect(page.getByText('Activity is complete! Review your responses above.')).toBeVisible();

    const persisted = await latestResponses(fixture.instanceId);
    expect(persisted['1a']).toContain('larger turn angle');
    expect(persisted['2a']).toContain('loop increases the forward distance');
    expect(persisted['2acode1']).toContain('for i in range(24)');
    expect(persisted['1state']).toBe('complete');
    expect(persisted['2state']).toBe('complete');
    await expect.poll(() => responseCount(fixture.instanceId)).toBeGreaterThan(0);
    expect(await draftCount(fixture.instanceId)).toBe(0);

    await page.request.post(`${E2E_API_BASE_URL}/api/auth/logout`);
    await login(page, fixture.instructor.email);
    await openRun(page, fixture.instanceId, 'instructor_view');
    await expect(page.locator('textarea[data-response-key="1a"]')).toHaveValue(/larger turn angle/);
    await expect(page.locator('textarea[data-response-key="2a"]')).toHaveValue(/loop increases/);
    await expect(page.locator('textarea[data-response-key="1a"]')).toHaveJSProperty('readOnly', true);
    await expect(page.getByRole('button', { name: 'Submit and Continue' })).toHaveCount(0);

    const countAfterInstructor = await responseCount(fixture.instanceId);

    await openRun(page, fixture.instanceId, 'activity_preview');
    await expect(page.locator('textarea[data-response-key="1a"]')).toHaveValue('');
    await expect(page.locator('textarea[data-response-key="1a"]')).toHaveJSProperty('readOnly', true);
    await expect(page.getByRole('button', { name: 'Submit and Continue' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit Group' })).toHaveCount(0);
    expect(await responseCount(fixture.instanceId)).toBe(countAfterInstructor);

    const countBeforeSandbox = await responseCount(fixture.instanceId);
    await openRun(page, fixture.instanceId, 'creator_sandbox');
    await expect(page.getByText('Sandbox mode is using the shared activity workspace with local edits only.')).toBeVisible();
    await page.locator('[data-sandbox-group="0"] textarea[data-response-key="1a"]').fill(
      'Sandbox-only answer about angle and curvature.'
    );
    await page.locator('[data-sandbox-group="0"]').getByRole('button', { name: 'Submit Group' }).click();
    await expect(page.locator('[data-sandbox-group="0"]').getByText('Accepted')).toBeVisible();

    const sandboxCall = aiCalls.find((call) => call.body?.studentAnswer === 'Sandbox-only answer about angle and curvature.');
    expect(sandboxCall?.body?.dryRun).toBe(true);
    expect(await responseCount(fixture.instanceId)).toBe(countBeforeSandbox);
    expect(await draftCount(fixture.instanceId)).toBe(0);

    const afterSandbox = await latestResponses(fixture.instanceId);
    expect(afterSandbox['1a']).toContain('larger turn angle');
    expect(Object.keys(afterSandbox).filter((key) => key.startsWith('Rcnt:') || key.startsWith('Rmax:') || key.startsWith('Rhash:'))).toHaveLength(0);
  });
});
