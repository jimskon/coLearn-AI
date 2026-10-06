'use strict';

// Loads the raw trace for a set of courses in a fixed number of batched
// queries (no per-instance queries), applies the research exclusions, and
// counts what was excluded. Reconstruction happens in ./reconstruct.js.

const { extractActivityResearchMeta } = require('../../shared/activityResearchMeta.cjs');
const { linesFromStoredText, loadActivitySourceLines } = require('../utils/activityContent');

// Response keys the analytics read. Everything else (drafts, AI chat turns,
// table cells, retry bookkeeping) is not loaded.
const RESEARCH_KEY_REGEXP =
  '^([0-9]+state|attempt:[0-9]+|[0-9]+[a-z]+(code[0-9]+|output|Output|FM|CodeAccepted|F1|CodeFeedback|S)?)$';

const AUDIT_TYPES = ['active_student_changed', 'instructor_force_advance', 'activity_paused', 'activity_resumed'];

// Activity metadata is cached per source revision so repeated statistics
// requests don't refetch remote documents.
const metaCache = new Map();

async function loadMeta(activity) {
  const key = `${activity.id}:${activity.source_revision ?? ''}:${activity.source_updated_at ?? ''}`;
  if (metaCache.has(key)) return metaCache.get(key);
  let lines = [];
  let available = true;
  try {
    lines = activity.content_text
      ? linesFromStoredText(activity.content_text)
      : await loadActivitySourceLines(activity);
  } catch {
    available = false;
  }
  const meta = { ...extractActivityResearchMeta(lines), available: available && lines.length > 0 };
  metaCache.set(key, meta);
  return meta;
}

const toMs = (value) => (value == null ? null : new Date(value).getTime());

/**
 * @param {object} db  mysql2 pool
 * @param {{courseIds:number[], from?:Date, to?:Date}} scope
 */
async function loadResearchTrace(db, { courseIds, from = null, to = null }) {
  const excluded = {
    tests: 0,
    sandboxRuns: 0,
    demoClasses: 0,
    noStudentMembers: 0,
    outsideDateRange: 0,
    duplicateRows: 0,
  };

  const [courses] = await db.query(
    `SELECT c.id, c.name, c.code, c.section, c.semester, c.year, c.class_id AS classId,
            COALESCE(pc.demo_mode, 0) AS demoMode
       FROM courses c
       LEFT JOIN pogil_classes pc ON pc.id = c.class_id
      WHERE c.id IN (?)`,
    [courseIds]
  );

  const [allInstances] = await db.query(
    `SELECT ai.id, ai.course_id AS courseId, ai.activity_id AS activityId,
            ai.group_number AS groupNumber, ai.start_time AS startTime,
            ai.sandbox_owner_id AS sandboxOwnerId, COALESCE(a.is_test, 0) AS isTest
       FROM activity_instances ai
       JOIN pogil_activities a ON a.id = ai.activity_id
      WHERE ai.course_id IN (?)`,
    [courseIds]
  );

  const demoCourse = new Set(courses.filter((c) => Number(c.demoMode) === 1).map((c) => c.id));
  let instances = allInstances.filter((i) => {
    if (Number(i.isTest) === 1) { excluded.tests += 1; return false; }
    if (i.sandboxOwnerId != null) { excluded.sandboxRuns += 1; return false; }
    if (demoCourse.has(i.courseId)) { excluded.demoClasses += 1; return false; }
    const start = toMs(i.startTime);
    if ((from && start < from.getTime()) || (to && start > to.getTime())) {
      excluded.outsideDateRange += 1;
      return false;
    }
    return true;
  });

  const empty = {
    courses, instances: [], activities: new Map(), membersByInstance: new Map(),
    rowsByInstance: new Map(), eventsByInstance: new Map(), users: new Map(), excluded,
  };
  if (!instances.length) return empty;

  let instanceIds = instances.map((i) => i.id);
  const [members] = await db.query(
    `SELECT gm.activity_instance_id AS instanceId, gm.student_id AS studentId, gm.role, u.role AS userRole
       FROM group_members gm
       JOIN users u ON u.id = gm.student_id
      WHERE gm.activity_instance_id IN (?)`,
    [instanceIds]
  );
  const membersByInstance = new Map();
  for (const m of members) {
    if (!membersByInstance.has(m.instanceId)) membersByInstance.set(m.instanceId, []);
    membersByInstance.get(m.instanceId).push({
      studentId: m.studentId,
      groupRole: m.role,
      isStudent: m.userRole === 'student',
    });
  }

  // Groups with no student-role members (instructor tests, demo accounts).
  instances = instances.filter((i) => {
    const ok = (membersByInstance.get(i.id) || []).some((m) => m.isStudent);
    if (!ok) excluded.noStudentMembers += 1;
    return ok;
  });
  if (!instances.length) return { ...empty, excluded };
  instanceIds = instances.map((i) => i.id);

  const [rows] = await db.query(
    `SELECT id, activity_instance_id AS instanceId, submit_id AS submitId, question_id AS questionId,
            response, answered_by_user_id AS userId, submitted_at AS submittedAt
       FROM responses
      WHERE activity_instance_id IN (?) AND BINARY question_id REGEXP ?`,
    [instanceIds, RESEARCH_KEY_REGEXP]
  );
  const rowsByInstance = new Map();
  const seen = new Set();
  for (const r of rows) {
    // A submit writes each key once; a repeat is a duplicated/replayed row.
    const dedupeKey = r.submitId ? `${r.instanceId}|${r.submitId}|${r.questionId}` : null;
    if (dedupeKey && seen.has(dedupeKey)) { excluded.duplicateRows += 1; continue; }
    if (dedupeKey) seen.add(dedupeKey);
    if (!rowsByInstance.has(r.instanceId)) rowsByInstance.set(r.instanceId, []);
    rowsByInstance.get(r.instanceId).push({
      id: r.id, submitId: r.submitId, questionId: r.questionId,
      response: r.response, userId: r.userId, at: toMs(r.submittedAt),
    });
  }

  const [events] = await db.query(
    `SELECT id, activity_instance_id AS instanceId, event_type AS type, user_id AS userId,
            role, details, created_at AS createdAt
       FROM audit_log
      WHERE activity_instance_id IN (?) AND event_type IN (?)`,
    [instanceIds, AUDIT_TYPES]
  );
  const eventsByInstance = new Map();
  for (const e of events) {
    let details = null;
    try { details = e.details ? JSON.parse(e.details) : null; } catch { details = null; }
    if (!eventsByInstance.has(e.instanceId)) eventsByInstance.set(e.instanceId, []);
    eventsByInstance.get(e.instanceId).push({
      id: e.id, type: e.type, userId: e.userId, role: e.role, at: toMs(e.createdAt), details,
    });
  }

  const activityIds = [...new Set(instances.map((i) => i.activityId))];
  const [activityRows] = await db.query(
    `SELECT id, name, title, sheet_url, source_type, content_text, source_revision, source_updated_at
       FROM pogil_activities WHERE id IN (?)`,
    [activityIds]
  );
  const activities = new Map();
  for (const a of activityRows) {
    activities.set(a.id, { id: a.id, name: a.name, title: a.title, meta: await loadMeta(a) });
  }

  const userIds = new Set();
  for (const list of membersByInstance.values()) for (const m of list) userIds.add(m.studentId);
  const users = new Map();
  if (userIds.size) {
    const [userRows] = await db.query('SELECT id, role FROM users WHERE id IN (?)', [[...userIds]]);
    for (const u of userRows) users.set(u.id, { id: u.id, role: u.role });
  }

  return {
    courses,
    instances: instances.map((i) => ({ ...i, startAt: toMs(i.startTime) })),
    activities,
    membersByInstance,
    rowsByInstance,
    eventsByInstance,
    users,
    excluded,
  };
}

module.exports = { loadResearchTrace, loadMeta, RESEARCH_KEY_REGEXP };
