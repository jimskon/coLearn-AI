// server/activity_instances/controller.js
const db = require('../db');
const { google } = require('googleapis');
const { authorize } = require('../utils/googleAuth');
const { inferActivityTypeFromActivity, inferActivityTypeFromLines } = require('../utils/activityType');
const { loadActivitySourceLines } = require('../utils/activityContent');
const { gradeTestQuestion } = require('../ai/controller');
const { randomUUID } = require('crypto');
const { JSDOM } = require('jsdom');

function escapeRegExp(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSectionTimerPayload(raw = {}) {
  const key = String(raw.sectionTimerKey || '').trim();
  const minutes = Number(raw.sectionTimerDurationMinutes);

  if (!key || !Number.isFinite(minutes) || minutes <= 0) {
    return {
      key: null,
      durationMinutes: null,
    };
  }

  return {
    key,
    durationMinutes: Math.round(minutes),
  };
}

function toDbNowString(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeActiveRotationMode(raw) {
  return String(raw || '').trim().toLowerCase() === 'group' ? 'group' : 'submit';
}

async function resolveTestOwnerStudentId(conn, instanceId, fallbackUserId = null) {
  const [[inst]] = await conn.query(
    `SELECT submitted_by_user_id
       FROM activity_instances
      WHERE id = ?`,
    [instanceId]
  );

  if (!inst) {
    return { studentId: null, source: null, reason: 'instance_not_found' };
  }

  if (inst.submitted_by_user_id) {
    return {
      studentId: Number(inst.submitted_by_user_id),
      source: 'submitted_by_user_id',
      reason: null,
    };
  }

  const [members] = await conn.query(
    `SELECT DISTINCT student_id
       FROM group_members
      WHERE activity_instance_id = ?
      ORDER BY id ASC`,
    [instanceId]
  );

  if (members.length === 1 && members[0].student_id) {
    return {
      studentId: Number(members[0].student_id),
      source: 'single_group_member',
      reason: null,
    };
  }

  const [answerers] = await conn.query(
    `SELECT answered_by_user_id AS student_id, COUNT(*) AS response_count
       FROM responses
      WHERE activity_instance_id = ?
        AND answered_by_user_id IS NOT NULL
      GROUP BY answered_by_user_id
      ORDER BY response_count DESC, answered_by_user_id ASC`,
    [instanceId]
  );

  if (answerers.length === 1 && answerers[0].student_id) {
    return {
      studentId: Number(answerers[0].student_id),
      source: 'single_response_owner',
      reason: null,
    };
  }

  if (!members.length && !answerers.length && fallbackUserId) {
    return {
      studentId: Number(fallbackUserId),
      source: 'fallback_user',
      reason: null,
    };
  }

  return {
    studentId: null,
    source: null,
    reason: members.length > 1 || answerers.length > 1 ? 'ambiguous' : 'missing',
  };
}

async function appendResponse(conn, instanceId, submitId, qid, value, {
  type = 'text',
  answeredBy,
  allowEmpty = false,
} = {}) {
  const v = value == null ? '' : String(value);
  if (!allowEmpty && !v.trim()) return;

  await conn.query(
    `INSERT INTO responses
       (activity_instance_id, question_id, submit_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [instanceId, qid, submitId, type, v, answeredBy]
  );
}

// ========== DOC PARSING ==========
function parseGoogleDocHTML(html) {
  const dom = new JSDOM(html);
  const body = dom.window.document.body;
  const blocks = [];

  let currentEnv = null, envBuffer = [], currentQuestion = null;

  const formatText = (text) =>
    text.replace(/\\textit\{([^}]+)\}/g, '<em>$1</em>')
      .replace(/\\textbf\{([^}]+)\}/g, '<strong>$1</strong>');

  const finalizeEnvironment = () => {
    if (currentEnv) {
      blocks.push({ type: currentEnv, content: envBuffer.map(formatText) });
      currentEnv = null;
      envBuffer = [];
    }
  };

  const finalizeQuestion = () => {
    if (currentQuestion) {
      blocks.push({ type: 'question', ...currentQuestion });
      currentQuestion = null;
    }
  };

  for (const el of body.children) {
    const text = el.textContent.trim();
    if (!text) continue;

    const envMatch = text.match(/^\\begin\{(content|process|knowledge)\}$/);
    if (envMatch) { finalizeEnvironment(); currentEnv = envMatch[1]; continue; }
    if (currentEnv && text === `\\end{${currentEnv}}`) { finalizeEnvironment(); continue; }

    if (currentEnv) {
      envBuffer.push(text.startsWith('\\item') ? `<li>${formatText(text.replace(/^\\item\s*/, ''))}</li>` : text);
      continue;
    }

    if (/^\\(title|name|section)\{/.test(text)) {
      const type = text.match(/^\\(\w+)\{/)[1];
      const value = text.match(/\\\w+\{(.+?)\}/)?.[1];
      blocks.push({ type: 'header', field: type, content: value });
      continue;
    }

    if (text.startsWith('\\questiongroup')) {
      blocks.push({ type: 'questiongroup', title: text.match(/\\questiongroup\{(.+?)\}/)?.[1] });
      continue;
    }

    if (text.startsWith('\\question')) {
      finalizeQuestion();
      currentQuestion = { id: '', text: text.replace('\\question', '').trim(), samples: [], feedback: [], followups: [], responseLines: 1 };
      continue;
    }

    if (text.startsWith('\\textresponse')) {
      const match = text.match(/\\textresponse\{(\d+)\}/);
      if (match) currentQuestion.responseLines = parseInt(match[1]);
      continue;
    }

    if (text === '\\endquestiongroup') { finalizeQuestion(); continue; }

    if (currentQuestion) {
      currentQuestion.text += ' ' + formatText(text);
      continue;
    }

    blocks.push({ type: 'info', content: formatText(text) });
  }

  finalizeQuestion();
  finalizeEnvironment();
  return blocks;
}


// ======== Helpers for timed tests ========

function computeTestWindow(instance) {
  const { test_start_at, test_duration_minutes, test_reopen_until } = instance || {};
  if (!test_start_at || !test_duration_minutes) return null;

  const now = new Date();
  const start = new Date(test_start_at);
  const baseEnd = new Date(start.getTime() + test_duration_minutes * 60000);

  let end = baseEnd;
  if (test_reopen_until) {
    const reopenUntil = new Date(test_reopen_until);
    if (reopenUntil > end) end = reopenUntil;
  }

  return { now, start, end };
}


// ========== ROUTE CONTROLLERS ==========

// Clear all responses for an instance and reset submission/reopen info
async function clearResponsesForInstance(req, res) {
  const instanceId = Number(req.params.instanceId);
  if (!instanceId) return res.status(400).json({ error: 'Bad instance id' });

  try {
    const [del] = await db.query(
      `DELETE FROM responses WHERE activity_instance_id = ?`,
      [instanceId]
    );

    // Reset submission + reopen state so instructor can restart
    await db.query(
	      `UPDATE activity_instances
	   SET submitted_at      = NULL,
	       graded_at         = NULL,
	       review_complete   = 0,
	       reviewed_at       = NULL,
	       points_earned     = NULL,
	       points_possible   = NULL,
	       progress_status   = 'in_progress',
	       section_timer_key = NULL,
	       section_timer_duration_minutes = NULL,
	       section_timer_started_at = NULL,
	       section_timer_paused = 0,
	       section_timer_paused_at = NULL,
	       test_reopen_until = NULL,
	       completed_groups  = 0
	   WHERE id = ?`,
      [instanceId]
    );
    global.emitInstanceState?.(instanceId, {
      submitted_at: null,
      graded_at: null,
      review_complete: 0,
      reviewed_at: null,
	      points_earned: null,
	      points_possible: null,
	      progress_status: 'in_progress',
	      section_timer_key: null,
	      section_timer_duration_minutes: null,
	      section_timer_started_at: null,
	      section_timer_paused: 0,
	      section_timer_paused_at: null,
	      test_reopen_until: null,
      completed_groups: 0, // only if you also want to reset it; if not, omit
    });


    res.json({ ok: true, cleared: del.affectedRows || 0 });
  } catch (e) {
    console.error('clearResponsesForInstance error:', e);
    res.status(500).json({ error: 'Failed to clear responses' });
  }
}


async function getParsedActivityDoc(req, res) {
  const { instanceId } = req.params;
  try {
    const [rows] = await db.query(`
      SELECT a.id, a.sheet_url, a.source_type, a.content_text
      FROM activity_instances ai
      JOIN pogil_activities a ON ai.activity_id = a.id
      WHERE ai.id = ?
    `, [instanceId]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Activity source not found' });
    }

    const lines = await loadActivitySourceLines(rows[0]);

    res.json({ lines });
  } catch (err) {
    console.error("❌ Error parsing activity doc:", err);
    res.status(500).json({ error: 'Failed to load document' });
  }
}


async function createActivityInstance(req, res) {
  const { activityId, courseId } = req.body;
  try {
    const [result] = await db.query(
      `INSERT INTO activity_instances (activity_id, course_id, active_rotation_mode) VALUES (?, ?, 'submit')`,
      [activityId, courseId]
    );
    res.status(201).json({ instanceId: result.insertId });
  } catch (err) {
    console.error("❌ Failed to create activity instance:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function ensureDemoInstance(req, res) {
  const activityId = Number(req.params.activityId);
  const courseId = Number(req.params.courseId);
  const userId = Number(req.user?.id);
  const userRole = String(req.user?.role || '');

  if (!activityId || !courseId || !userId) {
    return res.status(400).json({ error: 'Missing activity, course, or user.' });
  }

  const conn = await db.getConnection();
  const lockName = `ensureDemoInstance:${courseId}:${activityId}:${userId}`;

  try {
    const [[lockRow]] = await conn.query(`SELECT GET_LOCK(?, 5) AS got`, [lockName]);
    if (!lockRow?.got) {
      return res.status(409).json({ error: 'Someone else is opening this demo right now.' });
    }

    const [[activityRow]] = await conn.query(
      `SELECT id, is_test, sheet_url, source_type, content_text
         FROM pogil_activities
        WHERE id = ?`,
      [activityId]
    );

    if (!activityRow) {
      return res.status(404).json({ error: 'Activity not found.' });
    }

    const activityType = await inferActivityTypeFromActivity(activityRow);
    if (activityType !== 'demo') {
      return res.status(400).json({ error: 'This activity is not a demo.' });
    }

    if (userRole === 'student') {
      const [[enrollment]] = await conn.query(
        `SELECT 1
           FROM course_enrollments
          WHERE course_id = ? AND student_id = ?
          LIMIT 1`,
        [courseId, userId]
      );
      if (!enrollment) {
        return res.status(403).json({ error: 'Student is not enrolled in this course.' });
      }
    }

    const [[existing]] = await conn.query(
      `SELECT ai.id AS instance_id
         FROM activity_instances ai
         JOIN group_members gm ON gm.activity_instance_id = ai.id
        WHERE ai.course_id = ?
          AND ai.activity_id = ?
          AND gm.student_id = ?
        ORDER BY ai.id ASC
        LIMIT 1`,
      [courseId, activityId, userId]
    );

    if (existing?.instance_id) {
      return res.json({ instanceId: Number(existing.instance_id), created: false });
    }

    const [[nextRow]] = await conn.query(
      `SELECT COALESCE(MAX(group_number), 0) + 1 AS next_group_number
         FROM activity_instances
        WHERE course_id = ? AND activity_id = ?`,
      [courseId, activityId]
    );

    const [instanceResult] = await conn.query(
      `INSERT INTO activity_instances
         (course_id, activity_id, status, group_number, total_groups, completed_groups, progress_status, active_student_id, active_rotation_mode)
       VALUES (?, ?, 'in_progress', ?, 0, 0, 'not_started', ?, 'submit')`,
      [courseId, activityId, Number(nextRow?.next_group_number) || 1, userId]
    );

    await conn.query(
      `INSERT INTO group_members (activity_instance_id, student_id, role, connected)
       VALUES (?, ?, NULL, 0)`,
      [instanceResult.insertId, userId]
    );

    return res.status(201).json({ instanceId: Number(instanceResult.insertId), created: true });
  } catch (err) {
    console.error('❌ ensureDemoInstance:', err);
    return res.status(500).json({ error: 'Failed to open demo.' });
  } finally {
    try {
      await conn.query(`SELECT RELEASE_LOCK(?)`, [lockName]);
    } catch (_) {
      // ignore release errors
    }
    conn.release();
  }
}

async function getActivityInstanceById(req, res) {
  const { id } = req.params;

  try {
    const [[instance]] = await db.query(
      `SELECT
         ai.id,
         ai.course_id,
         ai.submitted_by_user_id,
         ai.group_number,
         ai.status,
         ai.total_groups,
         ai.completed_groups,
         ai.progress_status,
         ai.section_timer_key,
         ai.section_timer_duration_minutes,
         ai.section_timer_started_at,
         ai.section_timer_paused,
         ai.section_timer_paused_at,
         ai.test_start_at,
         ai.test_duration_minutes,
         ai.test_reopen_until,
         ai.submitted_at,
         ai.hidden,
         a.title       AS title,
         a.name        AS activity_name,
         a.sheet_url
       FROM activity_instances ai
       JOIN pogil_activities a ON ai.activity_id = a.id
       WHERE ai.id = ?`,
      [id]
    );

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    if (instance.hidden && req.user?.role === 'student') {
      return res.status(403).json({ error: 'This activity is currently hidden.' });
    }


    res.json(instance);
  } catch (err) {
    console.error('❌ Failed to fetch activity instance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}


async function getEnrolledStudents(req, res) {
  const { id } = req.params;
  try {
    const [[instance]] = await db.query(`SELECT course_id FROM activity_instances WHERE id = ?`, [id]);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });

    const [students] = await db.query(
      `SELECT u.id, u.name, u.email FROM course_enrollments ce JOIN users u ON ce.student_id = u.id
       WHERE ce.course_id = ? AND u.role = 'student'`,
      [instance.course_id]
    );
    res.json({ students });
  } catch (err) {
    console.error("❌ getEnrolledStudents:", err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
}

async function recordHeartbeat(req, res) {
  const { instanceId } = req.params;
  const { userId } = req.body;
  const timerInfo = normalizeSectionTimerPayload(req.body || {});

  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const ACTIVE_WINDOW_SEC = 60; // presence window

  try {
    const [[userRow]] = await db.query(`SELECT role FROM users WHERE id = ?`, [userId]);
    if (!userRow) {
      return res.json({ success: true, becameActive: false });
    }

    const [[inst]] = await db.query(
      `SELECT active_student_id,
              section_timer_key,
              section_timer_duration_minutes,
              section_timer_started_at,
              section_timer_paused,
              section_timer_paused_at
       FROM activity_instances
       WHERE id = ?`,
      [instanceId]
    );
    if (!inst) return res.status(404).json({ error: 'Instance not found' });

    let timerPatch = null;
    const currentKey = String(inst.section_timer_key || '').trim() || null;
    const currentDuration = Number(inst.section_timer_duration_minutes) || null;
    const currentStartedAt = inst.section_timer_started_at || null;
    const currentPaused = Number(inst.section_timer_paused) === 1;

    // The timer is DB-backed instance state: store only the section key,
    // duration, and the shared UTC start anchor. Clients derive display text.
    if (timerInfo.key) {
      const timerChanged =
        currentKey !== timerInfo.key ||
        currentDuration !== timerInfo.durationMinutes;

      if (!currentPaused && (timerChanged || !currentStartedAt)) {
        await db.query(
          `UPDATE activity_instances
           SET section_timer_key = ?,
               section_timer_duration_minutes = ?,
               section_timer_started_at = UTC_TIMESTAMP()
           WHERE id = ?`,
          [timerInfo.key, timerInfo.durationMinutes, instanceId]
        );

        timerPatch = {
          section_timer_key: timerInfo.key,
          section_timer_duration_minutes: timerInfo.durationMinutes,
          section_timer_started_at: toDbNowString(),
        };
      }
    } else if (currentKey || currentDuration || currentStartedAt) {
      await db.query(
        `UPDATE activity_instances
         SET section_timer_key = NULL,
             section_timer_duration_minutes = NULL,
             section_timer_started_at = NULL
         WHERE id = ?`,
        [instanceId]
      );

      timerPatch = {
        section_timer_key: null,
        section_timer_duration_minutes: null,
        section_timer_started_at: null,
      };
    }

    if (userRow.role !== 'student') {
      if (timerPatch) {
        global.emitInstanceState?.(Number(instanceId), timerPatch);
      }
      return res.json({ success: true, becameActive: false, ...(timerPatch || {}) });
    }

    const [[isMember]] = await db.query(
      `SELECT student_id FROM group_members
       WHERE activity_instance_id = ? AND student_id = ?`,
      [instanceId, userId]
    );
    if (!isMember) {
      if (timerPatch) {
        global.emitInstanceState?.(Number(instanceId), timerPatch);
      }
      return res.json({ success: true, becameActive: false, ...(timerPatch || {}) });
    }

    await db.query(
      `UPDATE group_members
       SET last_heartbeat = NOW(), connected = TRUE
       WHERE activity_instance_id = ? AND student_id = ?`,
      [instanceId, userId]
    );

    let activePresent = false;
    if (inst.active_student_id) {
      const [[row]] = await db.query(
        `SELECT (last_heartbeat IS NOT NULL AND last_heartbeat >= DATE_SUB(NOW(), INTERVAL ? SECOND)) AS present
         FROM group_members
         WHERE activity_instance_id = ? AND student_id = ?`,
        [ACTIVE_WINDOW_SEC, instanceId, inst.active_student_id]
      );
      activePresent = !!row?.present;
    }

    if (!inst.active_student_id || !activePresent) {
      const [[presentCaller]] = await db.query(
        `SELECT student_id FROM group_members
         WHERE activity_instance_id = ?
           AND student_id = ?
           AND last_heartbeat >= DATE_SUB(NOW(), INTERVAL ? SECOND)
         LIMIT 1`,
        [instanceId, userId, ACTIVE_WINDOW_SEC]
      );

      let newActiveId = presentCaller?.student_id;
      if (!newActiveId) {
        const [[anyPresent]] = await db.query(
          `SELECT student_id FROM group_members
           WHERE activity_instance_id = ?
             AND last_heartbeat >= DATE_SUB(NOW(), INTERVAL ? SECOND)
           ORDER BY last_heartbeat DESC
           LIMIT 1`,
          [instanceId, ACTIVE_WINDOW_SEC]
        );
        newActiveId = anyPresent?.student_id || null;
      }

      if (newActiveId) {
        await db.query(
          `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
          [newActiveId, instanceId]
        );
        global.emitInstanceState?.(Number(instanceId), {
          ...(timerPatch || {}),
          activeStudentId: newActiveId,
        });
        return res.json({
          success: true,
          becameActive: true,
          activeStudentId: newActiveId,
          ...(timerPatch || {}),
        });
      }
    }

    if (timerPatch) {
      global.emitInstanceState?.(Number(instanceId), timerPatch);
    }

    return res.json({
      success: true,
      becameActive: false,
      activeStudentId: inst.active_student_id,
      ...(timerPatch || {}),
    });
  } catch (err) {
    console.error("❌ recordHeartbeat error:", err);
    return res.status(500).json({ error: 'Failed to record heartbeat' });
  }
}


// In getActiveStudent function in controller.js

async function getActiveStudent(req, res) {
  const { instanceId } = req.params;

  try {
    const [[instance]] = await db.query(
      `SELECT active_student_id FROM activity_instances WHERE id = ?`,
      [instanceId]
    );

    if (!instance) {
      return res.status(404).json({ error: 'Activity instance not found' });
    }

    const activeStudentId = instance.active_student_id;
    //console.log("Active student ID for instance", instanceId, "is", activeStudentId);
    res.json({ activeStudentId });
  } catch (err) {
    console.error("❌ getActiveStudent error:", err);
    res.status(500).json({ error: 'Failed to fetch active student' });
  }
}


async function rotateActiveStudent(req, res) {
  const { instanceId } = req.params;
  const { currentStudentId } = req.body;

  const [members] = await db.query(
    `SELECT student_id FROM group_members
     WHERE activity_instance_id = ? AND connected = TRUE`,
    [instanceId]
  );

  if (!currentStudentId) return res.status(400).json({ error: 'Missing currentStudentId' });

  try {
    if (!members.length) return res.status(404).json({ error: 'No connected group members' });

    const others = members.filter(m => m.student_id !== currentStudentId);
    const next = others.length ? others[Math.floor(Math.random() * others.length)] : members[0];

    await db.query(`UPDATE activity_instances SET active_student_id = ? WHERE id = ?`, [next.student_id, instanceId]);
    global.emitInstanceState?.(Number(instanceId), { activeStudentId: next.student_id });
    res.json({ activeStudentId: next.student_id });
  } catch (err) {
    console.error("❌ rotateActiveStudent:", err);
    res.status(500).json({ error: 'Failed to rotate' });
  }
}


// Body:
// Non-test: { activityId, courseId, groups: [ { members: [ { student_id, role } ] } ] }
// Test:     { activityId, courseId, selectedStudentIds: [id...], testStartAt, testDurationMinutes, lockedBeforeStart, lockedAfterEnd }
async function setupMultipleGroupInstances(req, res) {
  const {
    activityId,
    courseId,
    groups,
    selectedStudentIds,
    testStartAt,
    testDurationMinutes,
    lockedBeforeStart,
    lockedAfterEnd,
  } = req.body;

  if (!activityId || !courseId) {
    return res.status(400).json({ error: 'ZZZ_NEW_GUARD activityId and courseId are required' });
  }

  const lockName = `setupGroups:${courseId}:${activityId}`;
  const conn = await db.getConnection();

  try {
    // ✅ serialize setup for this course+activity
    const [[lockRow]] = await conn.query(`SELECT GET_LOCK(?, 10) AS got`, [lockName]);
    if (!lockRow?.got) {
      return res.status(409).json({ error: 'Someone else is setting up groups right now.' });
    }

    await conn.beginTransaction();

    // ✅ GUARD: if group 1 exists, do NOT create a second set
    // Put this BEFORE any deletes/inserts.
    const [[g1]] = await conn.query(
      `SELECT id
       FROM activity_instances
       WHERE course_id = ? AND activity_id = ? AND group_number = 1
       LIMIT 1`,
      [courseId, activityId]
    );

    if (g1) {
      await conn.rollback();
      return res.status(409).json({ error: 'Groups already exist for this activity.' });
    }

    // Look up DB truth
    const [[activityRow]] = await conn.query(
      `SELECT is_test, sheet_url, source_type, content_text FROM pogil_activities WHERE id = ?`,
      [activityId]
    );

    // Decide test vs non-test
    const activityType = await inferActivityTypeFromActivity(activityRow || {});
    const dbIsTest = activityType === 'test';
    const hasTiming = !!testStartAt && Number(testDurationMinutes) > 0;
    const isTest = dbIsTest || hasTiming;

    // For NON-tests, we require groups[]
    if (!isTest) {
      if (!Array.isArray(groups) || groups.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'groups are required for non-test activities' });
      }
    } else {
      // For TESTS, we require selectedStudentIds[]
      if (!Array.isArray(selectedStudentIds) || selectedStudentIds.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'selectedStudentIds are required for tests' });
      }
      if (!testStartAt || !(Number(testDurationMinutes) > 0)) {
        await conn.rollback();
        return res.status(400).json({ error: 'testStartAt and positive testDurationMinutes are required for tests' });
      }
    }

    // Normalize incoming testStartAt (ISO) -> MySQL DATETIME string
    let testStartForDb = null;
    let effectiveDuration = 0;

    if (isTest && testStartAt && Number(testDurationMinutes) > 0) {
      const d = new Date(testStartAt);
      if (!Number.isNaN(d.getTime())) {
        testStartForDb = d.toISOString().slice(0, 19).replace('T', ' ');
        effectiveDuration = Number(testDurationMinutes);
      }
    }

    // ✅ Compute total_groups from doc (used by BOTH tests and non-tests)
    let computedTotalGroups = 1;
    try {
      const lines = await loadActivitySourceLines(activityRow || {});
      const groupCount = lines.filter(line => line.startsWith('\\questiongroup')).length;
      computedTotalGroups = groupCount > 0 ? groupCount : 1;
    } catch (e) {
      console.warn('⚠️ setupMultipleGroupInstances: failed to compute total_groups; defaulting to 1', e);
      computedTotalGroups = 1;
    }

    // 🔥 IMPORTANT: you said you want to back out if group 1 exists.
    // That means you should NOT be deleting old instances anymore.
    // You can either delete this whole block, or keep it as dead code.
    // I'd remove it to avoid accidental overwrites.

    // Remove existing instances + members for this course+activity
    // const [oldInstances] = await conn.query(
    //   `SELECT id FROM activity_instances WHERE course_id = ? AND activity_id = ?`,
    //   [courseId, activityId]
    // );
    // const instanceIds = oldInstances.map(r => r.id);
    // if (instanceIds.length > 0) {
    //   await conn.query(`DELETE FROM group_members WHERE activity_instance_id IN (?)`, [instanceIds]);
    //   await conn.query(`DELETE FROM activity_instances WHERE id IN (?)`, [instanceIds]);
    // }

    async function insertInstance({ group_number }) {
      const [instanceResult] = await conn.query(
        `INSERT INTO activity_instances
           (course_id, activity_id, status, group_number, total_groups, completed_groups, progress_status,
            test_start_at, test_duration_minutes, locked_before_start, locked_after_end, active_rotation_mode)
         VALUES (?, ?, 'in_progress', ?, ?, 0, 'not_started', ?, ?, ?, ?, 'submit')`,
        [
          courseId,
          activityId,
          group_number,
          computedTotalGroups,
          isTest ? testStartForDb : null,
          isTest ? effectiveDuration : 0,
          isTest ? (lockedBeforeStart ? 1 : 0) : 0,
          isTest ? (lockedAfterEnd ? 1 : 0) : 0,
        ]
      );
      return instanceResult.insertId;
    }

    // ===== CREATE INSTANCES =====
    if (isTest) {
      for (let i = 0; i < selectedStudentIds.length; i++) {
        const student_id = Number(selectedStudentIds[i]);
        if (!student_id) continue;

        const instanceId = await insertInstance({ group_number: i + 1 });

        await conn.query(
          `INSERT INTO group_members (activity_instance_id, student_id, role)
           VALUES (?, ?, NULL)`,
          [instanceId, student_id]
        );

        await conn.query(
          `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
          [student_id, instanceId]
        );
      }
    } else {
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const group_number = i + 1;

        const instanceId = await insertInstance({ group_number });

        if (Array.isArray(group.members)) {
          for (const member of group.members) {
            if (!member.student_id) continue;

            const cleanRole =
              member.role && ['facilitator', 'analyst', 'qc', 'spokesperson'].includes(member.role)
                ? member.role
                : null;

            await conn.query(
              `INSERT INTO group_members (activity_instance_id, student_id, role)
               VALUES (?, ?, ?)`,
              [instanceId, member.student_id, cleanRole]
            );
          }
        }
      }
    }

    await conn.commit();
    return res.json({
      success: true,
      isTest,
      total_groups: computedTotalGroups,
      instance_count: isTest ? selectedStudentIds.length : groups.length,
    });
  } catch (err) {
    try { await conn.rollback(); } catch { }
    console.error('❌ Error setting up groups/tests:', err);

    return res.status(500).json({
      error: 'Failed to setup instances',
      details: err?.sqlMessage || err?.message || String(err),
      code: err?.code,
    });
  } finally {
    // ✅ always release lock + connection
    try { await conn.query(`SELECT RELEASE_LOCK(?)`, [lockName]); } catch { }
    conn.release();
  }
}



async function submitGroupResponses(req, res) {
  const instanceId = Number(req.params.instanceId);
  const studentId = Number(req.body?.studentId);
  const groupNum = Number(req.body?.groupNum);
  const retriesRequired = Number(req.body?.retriesRequired || 1);
  const forceOverride = !!req.body?.forceOverride;

  const attempt = req.body?.attempt || {};
  const submissionString = String(attempt?.submissionString || '');
  const blocked = !!attempt?.blocked;
  const canAdvance = !!attempt?.canAdvance;
  const unanswered = Array.isArray(attempt?.unanswered) ? attempt.unanswered : [];
  const answers =
    attempt?.answers && typeof attempt.answers === 'object'
      ? attempt.answers
      : {};

  let emitPatch = null;
  const submitId = randomUUID();

  if (!instanceId || !studentId || !answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Missing instanceId, studentId, or answers' });
  }
  if (!Number.isFinite(groupNum) || groupNum <= 0) {
    return res.status(400).json({ error: 'Missing/invalid groupNum' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const normalizeStatus = (raw) => {
      const s = String(raw ?? '').trim().toLowerCase();
      if (s === 'complete' || s === 'completed') return 'complete';
      if (s === 'inprogress' || s === 'in_progress') return 'inprogress';
      return s || 'inprogress';
    };

    const submittedStatusEntries = Object.entries(answers).filter(([qidRaw]) => {
      const qid = String(qidRaw || '').trim();
      return new RegExp(`^${groupNum}[A-Za-z][A-Za-z0-9_]*S$`).test(qid);
    });

    // ---- 1) insert all submitted answer fields as-is ----
    // (These include: 2a, 2aF1, 2aFA1, etc.)
    for (const [qidRaw, valueRaw] of Object.entries(answers)) {
      const qid = String(qidRaw || '').trim();
      if (!qid) continue;

      // Group state is derived on the server from submitted question status rows.
      // Do not persist a client-computed `${groupNum}state` row.
      if (/^[0-9]+state$/i.test(qid)) continue;

      const value = valueRaw == null ? '' : String(valueRaw);

      await appendResponse(conn, instanceId, submitId, qid, value, {
        type: 'text',
        answeredBy: studentId,
        allowEmpty: true,
      });
    }
    // ---- 1a) append one marker row for this attempt click ----
    await appendResponse(
      conn,
      instanceId,
      submitId,
      `attempt:${groupNum}`,
      JSON.stringify({
        kind: 'group_attempt',
        groupNum,
        blocked,
        canAdvance,
        forceOverride,
        retriesRequired,
        unanswered,
        submissionString,
      }),
      {
        type: 'text',
        answeredBy: studentId,
        allowEmpty: true,
      }
    );

    const shouldAdvance =
      !!forceOverride ||
      (
        submittedStatusEntries.length > 0 &&
        submittedStatusEntries.every(([, response]) => normalizeStatus(response) === 'complete')
      );

    // ---- 1b) always write the current group state for this attempt ----
    await appendResponse(
      conn,
      instanceId,
      submitId,
      `${groupNum}state`,
      shouldAdvance ? 'complete' : 'inprogress',
      {
        type: 'text',
        answeredBy: studentId,
        allowEmpty: true,
      }
    );

    // ---- 4) Recompute cached progress from i=1..total_groups using istate ----
    const [[meta]] = await conn.query(
      `SELECT total_groups, active_rotation_mode FROM activity_instances WHERE id = ?`,
      [instanceId]
    );
    const totalGroups = Number(meta?.total_groups) || 0;
    const activeRotationMode = normalizeActiveRotationMode(meta?.active_rotation_mode);

    let completedGroups = 0;
    if (totalGroups > 0) {
      const [stateRows] = await conn.query(
        `SELECT r.question_id, r.response
   FROM responses r
   JOIN (
     SELECT question_id, MAX(id) AS max_id
     FROM responses
     WHERE activity_instance_id = ?
       AND question_id REGEXP '^[0-9]+state$'
     GROUP BY question_id
   ) latest
     ON r.question_id = latest.question_id AND r.id = latest.max_id
   WHERE r.activity_instance_id = ?`,
        [instanceId, instanceId]
      );

      const stateMap = new Map(
        stateRows.map(r => [String(r.question_id), String(r.response || '').toLowerCase()])
      );

      for (let i = 1; i <= totalGroups; i++) {
        if (stateMap.get(`${i}state`) === 'complete') completedGroups++;
        else break; // sequential contract
      }
    }

    const progressStatus =
      totalGroups > 0 && completedGroups >= totalGroups ? 'completed' : 'in_progress';

    await conn.query(
      `UPDATE activity_instances
       SET completed_groups = ?, progress_status = ?
       WHERE id = ?`,
      [completedGroups, progressStatus, instanceId]
    );

    emitPatch = { completed_groups: completedGroups, progress_status: progressStatus };


    const shouldRotateActive =
      progressStatus !== 'completed' &&
      (
        activeRotationMode === 'submit' ||
        (activeRotationMode === 'group' && shouldAdvance)
      );

    // ---- 5) Rotate active student among connected members ----
    const [connected] = await conn.query(
      `SELECT student_id
       FROM group_members
       WHERE activity_instance_id = ? AND connected = TRUE`,
      [instanceId]
    );

    if (shouldRotateActive && connected.length > 0) {
      const eligible = connected.filter(m => Number(m.student_id) !== studentId);
      const pickFrom = eligible.length ? eligible : connected;
      const next = pickFrom[Math.floor(Math.random() * pickFrom.length)].student_id;

      await conn.query(
        `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
        [next, instanceId]
      );

      emitPatch = { ...(emitPatch || {}), activeStudentId: next };
    }

    await conn.commit();

    // 🔥 NEW: clear drafts after successful submit
    await db.query(
      `DELETE FROM response_drafts
   WHERE activity_instance_id = ?`,
      [instanceId]
    );

    if (emitPatch) global.emitInstanceState?.(instanceId, emitPatch);

    return res.json({
      success: true, completed_groups: completedGroups, progress_status: progressStatus,
      ...(emitPatch?.activeStudentId ? { activeStudentId: emitPatch.activeStudentId } : {}),

    });
  } catch (err) {
    await conn.rollback();
    console.error('❌ submitGroupResponses:', err);
    return res.status(500).json({ error: 'Failed to save responses' });
  } finally {
    conn.release();
  }
}




async function getInstanceGroups(req, res) {
  const { instanceId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT gm.student_id, gm.role, u.name AS student_name, u.email AS student_email
       FROM group_members gm
       JOIN users u ON gm.student_id = u.id
       WHERE gm.activity_instance_id = ?
       ORDER BY gm.role`,
      [instanceId]
    );

    const roleLabels = { qc: 'Quality Control' };

    res.json({
      groups: [{
        group_id: instanceId,
        group_number: 1,
        members: rows.map(r => ({
          student_id: r.student_id,
          name: r.student_name,
          email: r.student_email,
          role: roleLabels[r.role] || r.role
        }))
      }]
    });
  } catch (err) {
    console.error("❌ getInstanceGroups:", err);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
}

async function getInstancesForActivityInCourse(req, res) {
  const { courseId, activityId } = req.params;
  try {
    const [[course]] = await db.query(`SELECT name FROM courses WHERE id = ?`, [courseId]);
    const [[activity]] = await db.query(`SELECT title FROM pogil_activities WHERE id = ?`, [activityId]);

    const courseName = course?.name || 'Unknown Course';
    const activityTitle = activity?.title || '';

    const [instances] = await db.query(
	      `SELECT id AS instance_id,
	              group_number,
                active_rotation_mode,
	              active_student_id,
	              total_groups,
	              completed_groups,
	              progress_status,
	              section_timer_key,
	              section_timer_duration_minutes,
	              section_timer_started_at,
                section_timer_paused,
                section_timer_paused_at,
	              test_start_at,
              test_duration_minutes,
              test_reopen_until,
              submitted_at,
              graded_at,
              review_complete,
              reviewed_at,
              points_earned,
              points_possible
       FROM activity_instances
       WHERE course_id = ? AND activity_id = ?
       ORDER BY group_number`,
      [courseId, activityId]
    );


    const groups = [];
    for (const inst of instances) {
      const [members] = await db.query(
        `SELECT gm.student_id, gm.role, u.name AS student_name, u.email AS student_email, gm.connected
         FROM group_members gm
         JOIN users u ON gm.student_id = u.id
         WHERE gm.activity_instance_id = ?
         ORDER BY gm.role`,
        [inst.instance_id]
      );
      const memberIds = new Set(members.map(m => m.student_id));
      let activeId = inst.active_student_id;

      if (!activeId || !memberIds.has(activeId)) {
        const connectedMember = members.find(m => !!m.connected);
        const fallback = connectedMember?.student_id ?? members[0]?.student_id ?? null;

        if (fallback !== null && fallback !== activeId) {
          await db.query(
            `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
            [fallback, inst.instance_id]
          );
          activeId = fallback;
          global.emitInstanceState?.(inst.instance_id, { activeStudentId: activeId });

        }
      }

      const [submitCounts] = await db.query(
        `SELECT CAST(SUBSTRING_INDEX(question_id, ':', -1) AS UNSIGNED) AS question_group,
                COUNT(*) AS submit_count
         FROM responses
         WHERE activity_instance_id = ?
           AND question_id LIKE 'attempt:%'
         GROUP BY CAST(SUBSTRING_INDEX(question_id, ':', -1) AS UNSIGNED)
         ORDER BY question_group`,
        [inst.instance_id]
      );

      const groupSubmitCounts = {};
      submitCounts.forEach((row) => {
        if (!Number.isFinite(Number(row.question_group))) return;
        groupSubmitCounts[String(Number(row.question_group))] = Number(row.submit_count) || 0;
      });

      const roleLabels = { qc: 'Quality Control' };
      groups.push({
        instance_id: inst.instance_id,
        group_number: inst.group_number,
        active_rotation_mode: normalizeActiveRotationMode(inst.active_rotation_mode),
        active_student_id: activeId,

        // ✅ THE DB TRUTH FIELDS YOUR UI WANTS
	        total_groups: inst.total_groups,
	        completed_groups: inst.completed_groups,
	        progress_status: inst.progress_status,
	        section_timer_key: inst.section_timer_key,
	        section_timer_duration_minutes: inst.section_timer_duration_minutes,
	        section_timer_started_at: inst.section_timer_started_at,
          section_timer_paused: Number(inst.section_timer_paused) === 1,
          section_timer_paused_at: inst.section_timer_paused_at,

        // Optional convenience label for UI (derived *from* DB truth)
        // progress: progress,  // you can keep or delete this

        test_start_at: inst.test_start_at,
        test_duration_minutes: inst.test_duration_minutes,
        test_reopen_until: inst.test_reopen_until,
        submitted_at: inst.submitted_at,
        graded_at: inst.graded_at,
        review_complete: inst.review_complete,
        reviewed_at: inst.reviewed_at,
        points_earned: inst.points_earned,
        points_possible: inst.points_possible,
        group_submit_counts: groupSubmitCounts,
        members: members.map(m => ({
          student_id: m.student_id,
          name: m.student_name,
          email: m.student_email,
          role: roleLabels[m.role] || m.role,
          connected: !!m.connected
        }))
      });
    }

    res.json({ courseName, activityTitle, groups });
  } catch (err) {
    console.error("❌ getInstancesForActivityInCourse:", err);
    res.status(500).json({ error: 'Failed to fetch instances' });
  }
}

async function setTimerPauseForActivity(req, res) {
  const { courseId, activityId } = req.params;
  const paused = !!req.body?.paused;

  try {
    const [instances] = await db.query(
      `SELECT id
       FROM activity_instances
       WHERE course_id = ? AND activity_id = ?`,
      [courseId, activityId]
    );

    if (!instances.length) {
      return res.json({ ok: true, paused, updated: 0 });
    }

    if (paused) {
      await db.query(
        `UPDATE activity_instances
         SET section_timer_paused = 1,
             section_timer_paused_at = COALESCE(section_timer_paused_at, UTC_TIMESTAMP())
         WHERE course_id = ? AND activity_id = ?`,
        [courseId, activityId]
      );
    } else {
      await db.query(
        `UPDATE activity_instances
         SET section_timer_started_at = CASE
               WHEN section_timer_paused = 1
                AND section_timer_paused_at IS NOT NULL
                AND section_timer_started_at IS NOT NULL
               THEN DATE_ADD(
                 section_timer_started_at,
                 INTERVAL TIMESTAMPDIFF(SECOND, section_timer_paused_at, UTC_TIMESTAMP()) SECOND
               )
               ELSE section_timer_started_at
             END,
             section_timer_paused = 0,
             section_timer_paused_at = NULL
         WHERE course_id = ? AND activity_id = ?`,
        [courseId, activityId]
      );
    }

    const [updatedRows] = await db.query(
      `SELECT id,
              section_timer_started_at,
              section_timer_paused,
              section_timer_paused_at
       FROM activity_instances
       WHERE course_id = ? AND activity_id = ?`,
      [courseId, activityId]
    );

    updatedRows.forEach((inst) => {
      global.emitInstanceState?.(Number(inst.id), {
        section_timer_started_at: inst.section_timer_started_at,
        section_timer_paused: Number(inst.section_timer_paused) === 1 ? 1 : 0,
        section_timer_paused_at: inst.section_timer_paused_at,
      });
    });

    res.json({ ok: true, paused, updated: instances.length });
  } catch (err) {
    console.error('❌ setTimerPauseForActivity:', err);
    res.status(500).json({ error: 'Failed to update timer pause state' });
  }
}

async function setActiveRotationModeForActivity(req, res) {
  const { courseId, activityId } = req.params;
  const mode = normalizeActiveRotationMode(req.body?.mode);

  try {
    const [result] = await db.query(
      `UPDATE activity_instances
       SET active_rotation_mode = ?
       WHERE course_id = ? AND activity_id = ?`,
      [mode, courseId, activityId]
    );

    res.json({ ok: true, mode, updated: result.affectedRows || 0 });
  } catch (err) {
    console.error('❌ setActiveRotationModeForActivity:', err);
    res.status(500).json({ error: 'Failed to update active rotation mode' });
  }
}

// NEW route: GET /api/responses/:instanceId
async function getInstanceResponses(req, res) {
  const { instanceId } = req.params;

  try {
    const [submittedRows] = await db.query(
      `SELECT r.question_id, r.response, r.response_type
       FROM responses r
       JOIN (
         SELECT question_id, MAX(id) AS max_id
         FROM responses
         WHERE activity_instance_id = ?
         GROUP BY question_id
       ) latest
         ON r.question_id = latest.question_id AND r.id = latest.max_id
       WHERE r.activity_instance_id = ?`,
      [instanceId, instanceId]
    );

    const [draftRows] = await db.query(
      `SELECT question_id, response, response_type
       FROM response_drafts
       WHERE activity_instance_id = ?`,
      [instanceId]
    );

    const responses = {};

    for (const row of submittedRows) {
      responses[row.question_id] = {
        response: row.response,
        type: row.response_type
      };
    }

    for (const row of draftRows) {
      responses[row.question_id] = {
        response: row.response,
        type: row.response_type
      };
    }

    res.json(responses);
  } catch (err) {
    console.error("❌ getInstanceResponses error:", err);
    res.status(500).json({ error: 'Failed to fetch responses' });
  }
}

async function refreshTotalGroups(req, res) {
  const { instanceId } = req.params;

  try {
    // 1) Look up the activity source for this instance
    const [[row]] = await db.query(
      `SELECT ai.activity_id, a.sheet_url, a.source_type, a.content_text, a.is_test
       FROM activity_instances ai
       JOIN pogil_activities a ON ai.activity_id = a.id
       WHERE ai.id = ?`,
      [instanceId]
    );

    if (!row) {
      return res.status(404).json({ error: 'Activity instance not found' });
    }

    const lines = await loadActivitySourceLines(row);

    let groupCount = lines.filter(line => line.startsWith('\\questiongroup')).length;
    if (groupCount <= 0) groupCount = 1;

    const activityType = inferActivityTypeFromLines(lines, {
      fallbackIsTest: Number(row.is_test) === 1,
    });
    const isTest = activityType === 'test';

    await db.query(
      `UPDATE activity_instances
       SET total_groups = ?
       WHERE id = ?`,
      [groupCount, instanceId]
    );

    // Keep the legacy flag aligned with the current document type.
    await db.query(
      `UPDATE pogil_activities
       SET is_test = ?
       WHERE id = ?`,
      [isTest ? 1 : 0, row.activity_id]
    );

    return res.json({ success: true, groupCount, isTest, activityType });
  } catch (err) {
    console.error('❌ refreshTotalGroups:', err);
    return res.status(500).json({ error: 'Failed to refresh total_groups' });
  }
}

// POST /api/activity-instances/:instanceId/test-settings
// Body: { testStartAt, testDurationMinutes }
async function updateTestSettings(req, res) {
  const { instanceId } = req.params;
  const { testStartAt, testDurationMinutes } = req.body || {};

  if (!instanceId) return res.status(400).json({ error: 'Missing instanceId' });

  const minutes = Number(testDurationMinutes);
  if (!testStartAt || !Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ error: 'testStartAt and positive testDurationMinutes required' });
  }

  const d = new Date(testStartAt);
  if (Number.isNaN(d.getTime())) {
    return res.status(400).json({ error: 'Invalid testStartAt' });
  }

  // Store as UTC datetime string for MySQL
  const startForDb = d.toISOString().slice(0, 19).replace('T', ' ');

  try {
    // Optional: wipe reopen window when you change the base window
    await db.query(
      `UPDATE activity_instances
       SET test_start_at = ?,
           test_duration_minutes = ?,
           test_reopen_until = NULL
       WHERE id = ?`,
      [startForDb, minutes, instanceId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ updateTestSettings error:', err);
    return res.status(500).json({ error: 'Failed to update test settings' });
  }
}

// NEW: Reopen a timed test for an instance
async function reopenInstance(req, res) {
  const { instanceId } = req.params;   // ✅ correct param
  const { minutes } = req.body || {};  // optional override

  if (!instanceId) {
    return res.status(400).json({ error: 'Missing instanceId' });
  }

  try {
    const [[instance]] = await db.query(
      `SELECT test_start_at, test_duration_minutes, test_reopen_until, submitted_at
       FROM activity_instances
       WHERE id = ?`,
      [instanceId]
    );

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    if (!instance.test_start_at || !instance.test_duration_minutes) {
      return res.status(400).json({ error: 'Not a timed test instance' });
    }

    // If you want to block reopen when already submitted, enforce here
    if (instance.submitted_at) {
      return res.status(400).json({ error: 'Test already submitted; clear answers to reopen.' });
    }

    const extendMinutes =
      minutes && minutes > 0 ? minutes : instance.test_duration_minutes;

    const now = new Date();
    const reopenUntil = new Date(now.getTime() + extendMinutes * 60000);

    await db.query(
      `UPDATE activity_instances
       SET test_reopen_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
       WHERE id = ?`,
      [extendMinutes, instanceId]
    );

    return res.json({ ok: true, test_reopen_until: reopenUntil });
  } catch (err) {
    console.error('❌ reopenInstance error:', err);
    return res.status(500).json({ error: 'Failed to reopen test.' });
  }
}

// Helper: parse score specs from either style:
//   \score{10,code} or \score{6,response}
//   \score{code=4,output=2,response=4}
function parseScoreSpec(specRaw) {
  const spec = String(specRaw || '').trim();
  const out = {};

  // style A: "code=4,output=2,response=4"
  if (spec.includes('=')) {
    for (const part of spec.split(/[;,]/)) {
      const [kRaw, vRaw] = part.split('=');
      if (!kRaw || !vRaw) continue;
      const k = kRaw.trim().toLowerCase();
      const v = Number(String(vRaw).trim());
      if (!Number.isFinite(v)) continue;

      if (k === 'code' || k === 'codes') out.code = v;
      else if (k === 'output' || k === 'run') out.output = v;
      else if (k === 'response') out.response = v;
    }
    return out;
  }

  // style B: "10,code" (or "6,response")
  // allow whitespace: "10, code"
  const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const pts = Number(parts[0]);
    const bucket = parts[1].toLowerCase();

    if (Number.isFinite(pts)) {
      if (bucket === 'code') out.code = pts;
      else if (bucket === 'output' || bucket === 'run') out.output = pts;
      else if (bucket === 'response') out.response = pts;
    }
  }

  return out;
}

// Helper: flatten Google doc into trimmed lines (same as you already do)
async function loadTestQuestionsForInstance(instanceId) {
  const [[row]] = await db.query(
    `SELECT ai.activity_id, a.sheet_url, a.source_type, a.content_text
     FROM activity_instances ai
     JOIN pogil_activities a ON ai.activity_id = a.id
     WHERE ai.id = ?`,
    [instanceId]
  );

  if (!row) throw new Error(`Activity instance ${instanceId} not found`);
  const lines = await loadActivitySourceLines(row);

  const questions = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    let qIndex = 0;
    // New question
    // New question (must be \question{...})
    if (/^\\question\{/.test(line)) {
      if (current) questions.push(current);

      const m = line.match(/^\\question\{([\s\S]*?)\}\s*$/);
      const qText = m ? m[1].trim() : ''; // if multi-paragraph, you'll append later
      current = { id: null, text: qText, scores: {} };
      continue;
    }

    // Skip question groups entirely
    if (/^\\questiongroup\{/.test(line)) {
      continue;
    }


    // Score tag
    if (line.startsWith('\\score') && current) {
      const m = line.match(/^\\score\{([^}]*)\}/);
      console.log('SCORE LINE for Q', qIndex, 'RAW=', line, 'PARSED=', m?.[1]);

      if (m) {
        current.scores = parseScoreSpec(m[1]);
      }
      continue;
    }

    // Accumulate extra lines into question text (optional)
    if (current) {
      // Stop at end markers if you want; but keeping it simple:
      if (!line.startsWith('\\end')) {
        current.text = current.text ? (current.text + ' ' + line) : line;
      }
      continue;
    }
  }

  if (current) questions.push(current);
  return questions;
}

async function getBaseQidsFirstSeen(conn, instanceId) {
  const [all] = await conn.query(
    `SELECT id, question_id
     FROM responses
     WHERE activity_instance_id = ?
     ORDER BY id ASC`,
    [instanceId]
  );

  const isBaseCandidate = (qidRaw) => {
    const qid = String(qidRaw || '').trim();
    if (!qid) return false;

    // global keys
    if (qid === 'testTotalScore' || qid === 'testMaxScore' || qid === 'testSummary') return false;

    // artifacts written by submit/regrade
    if (/CodeScore$/i.test(qid)) return false;
    if (/RunScore$/i.test(qid)) return false;
    if (/ResponseScore$/i.test(qid)) return false;
    if (/CodeFeedback$/i.test(qid)) return false;
    if (/RunFeedback$/i.test(qid)) return false;
    if (/ResponseFeedback$/i.test(qid)) return false;
    if (/Output$/i.test(qid)) return false;

    // code cell answers: 1code1, 2acode2, etc.
    if (/code\d+$/i.test(qid)) return false;

    // per-question / per-group state markers (your collaborative flow)
    if (/^\d+state$/i.test(qid)) return false;
    if (/^[0-9]+[a-zA-Z]S$/i.test(qid)) return false;

    return true;
  };

  const firstSeen = new Map();
  for (const r of all) {
    const qid = String(r.question_id || '').trim();
    if (!isBaseCandidate(qid)) continue;
    if (!firstSeen.has(qid)) firstSeen.set(qid, r.id);
  }

  return [...firstSeen.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([qid]) => qid);
}



async function submitTest(req, res) {
  const { instanceId } = req.params;
  const { studentId, answers, questions = [], regrade = false } = req.body || {};
  const isRegrade = regrade === true;
  const submitId = randomUUID();

  if (!instanceId || !answers || (!studentId && !isRegrade)) {
    return res.status(400).json({ error: 'Missing instanceId, studentId, or answers' });
  }

  console.log('[SUBMIT_TEST] ENTER', {
    instanceId,
    isRegrade,
    studentId,
    qCount: Array.isArray(questions) ? questions.length : 0,
    aCount: answers ? Object.keys(answers).length : 0,
    t: new Date().toISOString(),
  });

  // ✅ Regrade: instructor/root/creator only
  if (isRegrade) {
    const role = req.user?.role;
    const ok = role === 'instructor' || role === 'root' || role === 'creator';
    if (!ok) return res.status(403).json({ error: 'Forbidden (regrade requires instructor)' });
  }

  const lockName = `submitTest:${instanceId}`;
  const conn = await db.getConnection();

  try {
    // ✅ Serialize grading for this instanceId
    const [[lockRow]] = await conn.query(`SELECT GET_LOCK(?, 5) AS got`, [lockName]);
    if (!lockRow?.got) {
      return res.status(409).json({
        error: 'This test is currently being submitted/graded by someone else. Try again in a moment.',
      });
    }

    await conn.beginTransaction();

    let resolvedStudentId = Number(studentId) || null;
    let ownerSource = resolvedStudentId ? 'request' : null;

    if (!resolvedStudentId) {
      const resolved = await resolveTestOwnerStudentId(conn, instanceId, req.user?.id || null);
      resolvedStudentId = resolved.studentId;
      ownerSource = resolved.source;

      if (!resolvedStudentId) {
        await conn.rollback();
        return res.status(400).json({
          error:
            resolved.reason === 'ambiguous'
              ? 'Cannot determine which student owns this test attempt.'
              : 'Cannot determine which student owns this test attempt.',
        });
      }
    }

    let totalEarnedPoints = 0;
    let totalMaxPoints = 0;
    const questionResults = [];

    // -------- grade each question --------
    for (const q of questions) {
      // Your client sends {qid, questionText, ...}
      const baseId = q.qid || q.id;
      if (!baseId) {
        console.error('❌ submitTest: question missing qid/id:', q);
        continue;
      }

      const text = q.questionText || q.text || '';
      const scores = q.scores || {};

      const bucketPoints = (bucket) => {
        if (!bucket) return 0;
        if (typeof bucket === 'number') return bucket;
        if (typeof bucket === 'object' && typeof bucket.points === 'number') return bucket.points;
        return 0;
      };

      const maxCodePts = bucketPoints(scores.code);
      const maxRunPts = bucketPoints(scores.output);
      const maxRespPts = bucketPoints(scores.response);

      // Snapshot artifacts from `answers`
      const written = String(answers[baseId] || '').trim();

      // --- code cells ---
      const codeCells = [];
      // old style: 2acode1
      const rxOld = new RegExp(`^${escapeRegExp(baseId)}code(\\d+)$`, 'i');
      // new style: 2a-code-1 (if you ever use it)
      const rxNew = new RegExp(`^${escapeRegExp(baseId)}-code-(\\d+)$`, 'i');

      for (const [key, value] of Object.entries(answers)) {
        if (!value || !String(value).trim()) continue;
        let m = String(key).match(rxOld);
        if (!m) m = String(key).match(rxNew);
        if (!m) continue;

        const n = m[1];
        codeCells.push({
          qid: key,                 // store exact response key
          code: String(value),
          lang: 'cpp',              // you’re currently forcing cpp; fine for now
          label: `code ${n}`,
        });
      }

      // --- output snapshot ---
      let outputText = '';
      const outputPrefix = (baseId + 'output').toLowerCase();
      for (const [key, value] of Object.entries(answers)) {
        const lowerKey = String(key).toLowerCase();
        if (lowerKey === outputPrefix || lowerKey.startsWith(outputPrefix)) {
          outputText = String(value || '').trim();
          break;
        }
      }

      // Persist raw artifacts
      await appendResponse(conn, instanceId, submitId, baseId, written, {
        type: 'text',
        answeredBy: studentId
      });

      for (const cell of codeCells) {
        await appendResponse(conn, instanceId, submitId, cell.qid, cell.code, {
          type: 'code',
          answeredBy: studentId
        });
      }

      if (outputText) {
        await appendResponse(conn, instanceId, submitId, `${baseId}Output`, outputText, {
          type: 'run_output',
          answeredBy: studentId
        });
      }

      console.log('[SUBMIT_TEST] artifacts', {
        baseId,
        writtenPresent: !!written,
        codeCellsCount: codeCells.length,
        hasOutput: !!outputText,
        maxCodePts,
        maxRunPts,
        maxRespPts,
      });

      // Skip grading if no points
      if (maxCodePts <= 0 && maxRunPts <= 0 && maxRespPts <= 0) {
        console.log('[SUBMIT_TEST] skip grading (no points configured)', baseId);
        continue;
      }

      // Grade
      const {
        codeScore,
        codeFeedback,
        runScore,
        runFeedback,
        responseScore,
        responseFeedback,
      } = await gradeTestQuestion({
        questionText: text,
        scores,
        responseText: written,
        codeCells,
        outputText,
        rubric: scores,
      });

      const earned =
        (codeScore || 0) + (runScore || 0) + (responseScore || 0);
      const maxPts = maxCodePts + maxRunPts + maxRespPts;

      totalEarnedPoints += earned;
      totalMaxPoints += maxPts;

      questionResults.push({
        qid: baseId,
        maxCodePts,
        maxRunPts,
        maxRespPts,
        codeScore: codeScore || 0,
        runScore: runScore || 0,
        responseScore: responseScore || 0,
        codeFeedback: codeFeedback || '',
        runFeedback: runFeedback || '',
        responseFeedback: responseFeedback || '',
      });

      // Store per-band grading outputs (all as text)
      await appendResponse(conn, instanceId, submitId, `${baseId}CodeScore`, codeScore, {
        type: 'text',
        answeredBy: resolvedStudentId,
        allowEmpty: true,
      });
      await appendResponse(conn, instanceId, submitId, `${baseId}CodeFeedback`, codeFeedback, {
        type: 'text',
        answeredBy: resolvedStudentId,
        allowEmpty: true,
      });

      await appendResponse(conn, instanceId, submitId, `${baseId}RunScore`, runScore, {
        type: 'text',
        answeredBy: resolvedStudentId,
        allowEmpty: true,
      });

      await appendResponse(conn, instanceId, submitId, `${baseId}RunFeedback`, runFeedback, {
        type: 'text',
        answeredBy: resolvedStudentId,
        allowEmpty: true,
      });

      await appendResponse(conn, instanceId, submitId, `${baseId}ResponseScore`, responseScore, {
        type: 'text',
        answeredBy: resolvedStudentId,
        allowEmpty: true,
      });

      await appendResponse(conn, instanceId, submitId, `${baseId}ResponseFeedback`, responseFeedback, {
        type: 'text',
        answeredBy: resolvedStudentId,
        allowEmpty: true,
      });

    }


    // -------- summary --------
    const lines = [];
    for (const qr of questionResults) {
      const {
        qid,
        maxCodePts = 0, maxRunPts = 0, maxRespPts = 0,
        codeScore = 0, runScore = 0, responseScore = 0,
        codeFeedback = '', runFeedback = '', responseFeedback = '',
      } = qr;

      const qMax = maxCodePts + maxRunPts + maxRespPts;
      const qScore = codeScore + runScore + responseScore;

      lines.push(`Question ${qid} – Total ${qScore}/${qMax}`);

      const bandParts = [];
      if (maxCodePts > 0) bandParts.push(`Code ${codeScore}/${maxCodePts}`);
      if (maxRunPts > 0) bandParts.push(`Run ${runScore}/${maxRunPts}`);
      if (maxRespPts > 0) bandParts.push(`Response ${responseScore}/${maxRespPts}`);
      if (bandParts.length) lines.push(`  ${bandParts.join(' · ')}`);

      if (maxCodePts > 0 && codeScore < maxCodePts && codeFeedback) {
        lines.push(`  Code feedback: ${codeFeedback}`);
      }
      if (maxRunPts > 0 && runScore < maxRunPts && runFeedback) {
        lines.push(`  Run feedback: ${runFeedback}`);
      }
      if (maxRespPts > 0 && responseScore < maxRespPts && responseFeedback) {
        lines.push(`  Response feedback: ${responseFeedback}`);
      }

      lines.push('');
    }

    lines.push(`Overall: ${totalEarnedPoints}/${totalMaxPoints}`);
    if (isRegrade) lines.push(`(Regraded at ${new Date().toISOString()})`);

    const summaryText = lines.join('\n');

    // Test summary
    await appendResponse(conn, instanceId, submitId, 'testTotalScore', totalEarnedPoints, {
      type: 'text',
      answeredBy: resolvedStudentId,
      allowEmpty: true,
    });
    await appendResponse(conn, instanceId, submitId, 'testMaxScore', totalMaxPoints, {
      type: 'text',
      answeredBy: resolvedStudentId,
      allowEmpty: true,
    });
    await appendResponse(conn, instanceId, submitId, 'testSummary', summaryText, {
      type: 'text',
      answeredBy: resolvedStudentId,
      allowEmpty: true,
    });

    // ✅ Update activity_instances:
    // - On first submit: set submitted_at + submitted_by_user_id if missing
    // - On regrade: DO NOT touch submitted_at or submitted_by_user_id
    if (isRegrade) {
      await conn.query(
        `
        UPDATE activity_instances
        SET
          points_earned    = ?,
          points_possible  = ?,
          graded_at        = UTC_TIMESTAMP(),
          submitted_by_user_id = COALESCE(submitted_by_user_id, ?)
        WHERE id = ?
        `,
        [totalEarnedPoints, totalMaxPoints, resolvedStudentId, instanceId]
      );
    } else {
      await conn.query(
        `
        UPDATE activity_instances
        SET
          points_earned    = ?,
          points_possible  = ?,
          progress_status  = 'completed',
          submitted_at     = COALESCE(submitted_at, UTC_TIMESTAMP()),
          graded_at        = UTC_TIMESTAMP(),
          submitted_by_user_id = COALESCE(submitted_by_user_id, ?)
        WHERE id = ?
        `,
        [totalEarnedPoints, totalMaxPoints, resolvedStudentId, instanceId]
      );
    }

    global.emitInstanceState?.(Number(instanceId), {
      points_earned: totalEarnedPoints,
      points_possible: totalMaxPoints,
      progress_status: 'completed',
    });

    await conn.commit();

    // clear drafts after successful submit/regrade
    await db.query(
      `DELETE FROM response_drafts
   WHERE activity_instance_id = ?`,
      [instanceId]
    );

    global.emitInstanceState?.(Number(instanceId), {
      points_earned: totalEarnedPoints,
      points_possible: totalMaxPoints,
      progress_status: 'completed',
    });

    console.log('[SUBMIT_TEST] EXIT OK', {
      instanceId,
      isRegrade,
      studentId: resolvedStudentId,
      ownerSource,
      totalEarnedPoints,
      totalMaxPoints,
    });

    return res.json({
      ok: true,
      earned: totalEarnedPoints,
      max: totalMaxPoints,
      questions: questionResults,
      summary: summaryText,
      regrade: isRegrade,
    });
  } catch (err) {
    try { await conn.rollback(); } catch { }
    console.error('❌ submitTest failed:', err);
    return res.status(500).json({ error: 'submit-test failed' });
  } finally {
    try { await conn.query(`SELECT RELEASE_LOCK(?)`, [lockName]); } catch { }
    conn.release();
  }
}

async function recomputeTestTotals(req, res) {
  const { instanceId } = req.params;

  const role = req.user?.role;
  const ok = role === 'instructor' || role === 'root' || role === 'creator';
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  const conn = await db.getConnection();
  const submitId = randomUUID();
  const lockName = `recomputeTestTotals:${instanceId}`;


  try {
    const [[lockRow]] = await conn.query(`SELECT GET_LOCK(?, 5) AS got`, [lockName]);
    if (!lockRow?.got) {
      return res.status(409).json({
        error: 'This test is currently being recomputed by someone else. Try again in a moment.',
      });
    }
    await conn.beginTransaction();

    // 1) Pick an answer owner (must be non-null)
    const [[inst]] = await conn.query(
      `SELECT submitted_by_user_id, points_possible
       FROM activity_instances
       WHERE id = ?`,
      [instanceId]
    );

    if (!inst) {
      await conn.rollback();
      return res.status(404).json({ error: 'Instance not found' });
    }

    let answererId = inst.submitted_by_user_id;

    if (!answererId) {
      const [[m]] = await conn.query(
        `SELECT student_id
         FROM group_members
         WHERE activity_instance_id = ?
         ORDER BY id ASC
         LIMIT 1`,
        [instanceId]
      );
      answererId = m?.student_id || req.user?.id || null;
    }

    if (!answererId) {
      await conn.rollback();
      return res.status(400).json({ error: 'Cannot determine answered_by_user_id for totals' });
    }

    // 2) Load latest responses
    const [rows] = await conn.query(
      `SELECT r.question_id, r.response, r.response_type
   FROM responses r
   JOIN (
     SELECT question_id, MAX(id) AS max_id
     FROM responses
     WHERE activity_instance_id = ?
     GROUP BY question_id
   ) latest
     ON r.question_id = latest.question_id AND r.id = latest.max_id
   WHERE r.activity_instance_id = ?`,
      [instanceId, instanceId]
    );

    const map = Object.create(null);
    for (const r of rows) map[r.question_id] = r.response;

    // 3) Sum scores
    const baseQids = new Set();
    for (const k of Object.keys(map)) {
      const m = String(k).match(/^(\d+[a-z]+)(CodeScore|RunScore|ResponseScore)$/);
      if (m) baseQids.add(m[1]);
    }

    let earned = 0;
    for (const qid of baseQids) {
      const c = Number(map[`${qid}CodeScore`] || 0) || 0;
      const r = Number(map[`${qid}RunScore`] || 0) || 0;
      const t = Number(map[`${qid}ResponseScore`] || 0) || 0;
      earned += (c + r + t);
    }

    const possible = Number(inst.points_possible || 0) || 0;

    // 4) Update cached totals on activity_instances
    await conn.query(
      `UPDATE activity_instances
       SET points_earned = ?,
           graded_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [earned, instanceId]
    );

    // 5) Mirror totals into responses table (optional, but you’re doing it)
    await appendResponse(conn, instanceId, submitId, 'testTotalScore', String(earned), {
      type: 'text',
      answeredBy: answererId,
      allowEmpty: true,
    });

    await appendResponse(conn, instanceId, submitId, 'testMaxScore', String(possible), {
      type: 'text',
      answeredBy: answererId,
      allowEmpty: true,
    });

    await conn.commit();
    global.emitInstanceState?.(Number(instanceId), {
      points_earned: earned,
      points_possible: possible,
      // don’t lie about graded_at: DB sets it; this is fine as “changed now”
    });


    return res.json({ ok: true, earned, possible });
  } catch (e) {
    try { await conn.rollback(); } catch { }
    console.error('recomputeTestTotals failed:', e);
    return res.status(500).json({ error: 'recompute failed' });
  } finally {
    try { await conn.query(`SELECT RELEASE_LOCK(?)`, [lockName]); } catch { }
    conn.release();
  }
}

async function getInstanceResponseHistory(req, res) {
  const { instanceId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT
         r.id,
         r.submit_id,
         r.question_id,
         r.response_type,
         r.response,
         r.answered_by_user_id,
         r.submitted_at,
         r.updated_at
       FROM responses r
       WHERE r.activity_instance_id = ?
       ORDER BY r.id ASC`,
      [instanceId]
    );

    res.json({ rows });
  } catch (err) {
    console.error('❌ getInstanceResponseHistory error:', err);
    res.status(500).json({ error: 'Failed to fetch response history' });
  }
}

// Export it as part of the module
module.exports = {
  clearResponsesForInstance,
  getParsedActivityDoc,
  createActivityInstance,
  ensureDemoInstance,
  getActivityInstanceById,
  getEnrolledStudents,
  recordHeartbeat,
  getActiveStudent,
  rotateActiveStudent,
  setupMultipleGroupInstances,
  submitGroupResponses,
  getInstanceGroups,
  getInstancesForActivityInCourse,
  setTimerPauseForActivity,
  setActiveRotationModeForActivity,
  getInstanceResponses,
  refreshTotalGroups,
  reopenInstance,
  submitTest,
  updateTestSettings,
  recomputeTestTotals,
  getInstanceResponseHistory,
};
