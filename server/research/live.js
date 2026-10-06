'use strict';

// Live activity timeline for the instructor's View Groups page (Observation
// view): per group, active/idle slices, submit markers, section windows (for
// "past this section's time"), and the time of last activity (idle timer).

const { buildSubmits } = require('./reconstruct');
const { loadMeta } = require('./trace');
const { SLICE_SECONDS } = require('./activityRecorder');
const { pauseIntervals } = require('./pauses');

const FLAG_ACTIVE = 1;  // edits, runs, submits by the group
const FLAG_SANDBOX = 2; // Local Sandbox work by other members
const FLAG_AI_WAIT = 4; // AI evaluation in progress (not idle)

const toMs = (value) => (value == null ? null : new Date(value).getTime());

/**
 * Pure: one group's live timeline.
 * @param {object} p
 * @param {Array} p.rows       responses rows (<n>state, attempt:<n>) {id, submitId, questionId, response, userId, at}
 * @param {Array} p.events     audit events {type, at, details}
 * @param {Array} p.slices     [{at, edits, runs, submits, sandbox, aiWaits}]
 * @param {object} p.meta      activity metadata (groups, sections, plannedMinutes)
 */
function buildLiveGroup({ rows = [], events = [], slices = [], observations = [], meta }) {
  const submits = buildSubmits([...rows].sort((a, b) => a.id - b.id));
  const turnEvents = events.filter((e) => e.type === 'active_student_changed').sort((a, b) => a.at - b.at);
  const forceAdvances = events.filter((e) => e.type === 'instructor_force_advance');

  const sliceList = slices
    .map((s) => ({
      at: s.at,
      flags:
        (s.edits || s.runs || s.submits ? FLAG_ACTIVE : 0) |
        (s.sandbox ? FLAG_SANDBOX : 0) |
        (s.aiWaits ? FLAG_AI_WAIT : 0),
    }))
    .filter((s) => s.flags)
    .sort((a, b) => a.at - b.at);

  const starts = [turnEvents[0]?.at, sliceList[0]?.at, submits[0]?.at].filter((t) => t != null);
  const startAt = starts.length ? Math.min(...starts) : null;

  // Last time the group did something (the idle timer counts from here).
  const lastSlice = [...sliceList].reverse().find((s) => s.flags & (FLAG_ACTIVE | FLAG_AI_WAIT));
  const lastCandidates = [lastSlice ? lastSlice.at + SLICE_SECONDS * 1000 : null, submits[submits.length - 1]?.at]
    .filter((t) => t != null);
  const lastActivityAt = lastCandidates.length ? Math.max(...lastCandidates) : null;

  // When each question group was left, then when each section was entered.
  const exitAt = new Map();
  for (const s of submits) if (s.advanced && !exitAt.has(s.groupNum)) exitAt.set(s.groupNum, s.at);
  for (const e of forceAdvances) {
    const g = Number(e.details?.groupNum);
    if (g && !exitAt.has(g)) exitAt.set(g, e.at);
  }

  const sections = [];
  const groups = meta?.groups || [];
  groups.forEach((group, index) => {
    const enteredAt = index === 0 ? startAt : exitAt.get(groups[index - 1].groupNum) ?? null;
    if (enteredAt == null) return;
    const last = sections[sections.length - 1];
    if (last && last.sectionIndex === group.sectionIndex) return;
    const section = meta.sections?.[group.sectionIndex] || null;
    sections.push({
      sectionIndex: group.sectionIndex,
      title: section?.title ?? null,
      minutes: section?.minutes ?? null,
      enteredAt,
    });
  });

  return {
    startAt,
    lastActivityAt,
    plannedMinutes: meta?.plannedMinutes ?? null,
    slices: sliceList.map((s) => [s.at, s.flags]),
    submits: submits.map((s) => [s.at, s.advanced ? 'advanced' : s.sentBack.length ? 'sent_back' : 'other']),
    sections,
    groupsCompleted: exitAt.size,
    tags: [...observations].sort((a, b) => a.at - b.at).map((o) => [o.at, o.label]),
    // Instructor pauses: [start, end|null]. Paused time is never idle.
    pauses: pauseIntervals(events),
  };
}

/** All non-sandbox runs of one activity in one course. */
async function liveForActivity(db, courseId, activityId) {
  const [instances] = await db.query(
    `SELECT id, group_number AS groupNumber, active_student_id AS activeStudentId,
            completed_groups AS completedGroups, total_groups AS totalGroups, progress_status AS progressStatus
       FROM activity_instances
      WHERE course_id = ? AND activity_id = ? AND sandbox_owner_id IS NULL`,
    [courseId, activityId]
  );
  const [[activity]] = await db.query(
    `SELECT id, sheet_url, source_type, content_text, source_revision, source_updated_at
       FROM pogil_activities WHERE id = ?`,
    [activityId]
  );
  const meta = activity ? await loadMeta(activity) : { groups: [], sections: [], plannedMinutes: null };
  const result = { now: Date.now(), sliceSeconds: SLICE_SECONDS, slicesAvailable: true, observationsAvailable: true, groups: [] };
  if (!instances.length) return result;
  const ids = instances.map((i) => i.id);

  const [rows] = await db.query(
    `SELECT id, activity_instance_id AS instanceId, submit_id AS submitId, question_id AS questionId,
            response, answered_by_user_id AS userId, submitted_at AS submittedAt
       FROM responses
      WHERE activity_instance_id IN (?) AND (question_id REGEXP '^[0-9]+state$' OR question_id LIKE 'attempt:%')`,
    [ids]
  );
  const [events] = await db.query(
    `SELECT activity_instance_id AS instanceId, event_type AS type, details, created_at AS createdAt
       FROM audit_log
      WHERE activity_instance_id IN (?)
        AND event_type IN ('active_student_changed', 'instructor_force_advance', 'activity_paused', 'activity_resumed')`,
    [ids]
  );
  let sliceRows = [];
  try {
    [sliceRows] = await db.query(
      `SELECT activity_instance_id AS instanceId, slice_start AS sliceStart,
              MAX(edits) AS edits, MAX(runs) AS runs, MAX(submits) AS submits,
              MAX(sandbox) AS sandbox, MAX(ai_waits) AS aiWaits
         FROM group_activity_slices
        WHERE activity_instance_id IN (?)
        GROUP BY activity_instance_id, slice_start`,
      [ids]
    );
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    result.slicesAvailable = false; // migration 025 not run yet
  }

  let observationRows = [];
  try {
    [observationRows] = await db.query(
      `SELECT activity_instance_id AS instanceId, label, observed_at AS observedAt
         FROM instructor_observations
        WHERE activity_instance_id IN (?)`,
      [ids]
    );
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    result.observationsAvailable = false; // migration 026 not run yet
  }

  const byInstance = (list) => {
    const map = new Map();
    for (const item of list) {
      if (!map.has(item.instanceId)) map.set(item.instanceId, []);
      map.get(item.instanceId).push(item);
    }
    return map;
  };
  const rowsBy = byInstance(rows.map((r) => ({ ...r, at: toMs(r.submittedAt) })));
  const eventsBy = byInstance(events.map((e) => {
    let details = null;
    try { details = e.details ? JSON.parse(e.details) : null; } catch { details = null; }
    return { instanceId: e.instanceId, type: e.type, at: toMs(e.createdAt), details };
  }));
  const slicesBy = byInstance(sliceRows.map((s) => ({ ...s, at: toMs(s.sliceStart) })));
  const observationsBy = byInstance(observationRows.map((o) => ({ ...o, at: toMs(o.observedAt) })));
  const groupHasCode = (groupNum) => [...(meta.questions?.values?.() || [])].some((q) => q.groupNum === groupNum && q.hasCode);

  result.groups = instances.map((inst) => {
    const currentGroupNum = Math.min((inst.completedGroups || 0) + 1, inst.totalGroups || Infinity);
    return {
      instanceId: inst.id,
      groupNumber: inst.groupNumber,
      activeStudentId: inst.activeStudentId,
      progressStatus: inst.progressStatus,
      currentGroupNum,
      currentGroupHasCode: groupHasCode(currentGroupNum),
      totalGroups: inst.totalGroups,
      ...buildLiveGroup({
        rows: rowsBy.get(inst.id) || [],
        events: eventsBy.get(inst.id) || [],
        slices: slicesBy.get(inst.id) || [],
        observations: observationsBy.get(inst.id) || [],
        meta,
      }),
    };
  });
  return result;
}

module.exports = { buildLiveGroup, liveForActivity, FLAG_ACTIVE, FLAG_SANDBOX, FLAG_AI_WAIT };
