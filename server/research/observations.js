'use strict';

// Instructor classroom observations (migration 026): a tag an instructor gives
// a group in the Observation view, stored with what the system knew at that
// moment so tags can later be compared with pause and activity data.

const { loadMeta } = require('./trace');
const { filterAccessibleCourses } = require('./access');
const { SLICE_SECONDS } = require('./activityRecorder');

const LABELS = ['talk', 'code', 'watch', 'quiet', 'help', 'frustrated', 'off_task', 'uncertain'];
const UNDO_WINDOW_SECONDS = 60; // the UI offers undo for 10 s; the server allows a grace period

class ObservationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const tableMissing = (err) => err?.code === 'ER_NO_SUCH_TABLE';

async function optionalQuery(db, sql, params) {
  try {
    const [rows] = await db.query(sql, params);
    return rows;
  } catch (err) {
    if (tableMissing(err)) return [];
    throw err;
  }
}

/** What the system knew about the group when the tag was given. */
async function observationContext(db, inst) {
  const groupNum = Math.min((inst.completedGroups || 0) + 1, inst.totalGroups || Infinity);

  const [[activity]] = await db.query(
    `SELECT id, sheet_url, source_type, content_text, source_revision, source_updated_at
       FROM pogil_activities WHERE id = ?`,
    [inst.activityId]
  );
  const meta = activity ? await loadMeta(activity) : null;
  const hasCode = !!meta && [...meta.questions.values()].some((q) => q.groupNum === groupNum && q.hasCode);

  const [lastSlice] = await optionalQuery(
    db,
    `SELECT MAX(slice_start) AS at FROM group_activity_slices
      WHERE activity_instance_id = ? AND (edits OR runs OR submits OR ai_waits)`,
    [inst.id]
  );
  const [[lastSubmit]] = await db.query(
    `SELECT MAX(submitted_at) AS at FROM responses
      WHERE activity_instance_id = ? AND question_id REGEXP '^[0-9]+state$'`,
    [inst.id]
  );
  const times = [
    lastSlice?.at ? new Date(lastSlice.at).getTime() + SLICE_SECONDS * 1000 : null,
    lastSubmit?.at ? new Date(lastSubmit.at).getTime() : null,
  ].filter((t) => t != null);
  const lastActivityAt = times.length ? Math.max(...times) : null;

  const [aiWait] = await optionalQuery(
    db,
    `SELECT 1 AS waiting FROM group_activity_slices
      WHERE activity_instance_id = ? AND ai_waits = 1
        AND slice_start >= DATE_SUB(NOW(), INTERVAL ? SECOND)
      LIMIT 1`,
    [inst.id, SLICE_SECONDS * 2]
  );

  const [[lastDecision]] = await db.query(
    `SELECT question_id AS questionId, response FROM responses
      WHERE activity_instance_id = ? AND BINARY question_id REGEXP '^[0-9]+[a-z]+(FM|CodeAccepted)$'
      ORDER BY id DESC LIMIT 1`,
    [inst.id]
  );
  const decision = (() => {
    const value = String(lastDecision?.response ?? '').trim();
    if (value === 'accepted' || value === 'true') return 'accepted';
    if (value === 'needsRevision' || value === 'false') return 'rejected';
    return null;
  })();

  return {
    groupNum,
    hasCode,
    activeStudentId: inst.activeStudentId ?? null,
    secondsSinceActivity: lastActivityAt != null ? Math.max(0, Math.round((Date.now() - lastActivityAt) / 1000)) : null,
    aiWaitInProgress: !!aiWait,
    lastAiDecision: decision ? { questionId: lastDecision.questionId, decision } : null,
  };
}

async function createObservation(db, user, { instanceId, label }) {
  const id = Number(instanceId);
  if (!Number.isInteger(id) || id <= 0) throw new ObservationError(400, 'Invalid group');
  if (!LABELS.includes(label)) throw new ObservationError(400, 'Unknown observation label');

  const [[inst]] = await db.query(
    `SELECT id, course_id AS courseId, activity_id AS activityId, completed_groups AS completedGroups,
            total_groups AS totalGroups, active_student_id AS activeStudentId
       FROM activity_instances WHERE id = ?`,
    [id]
  );
  if (!inst) throw new ObservationError(404, 'Group not found');
  const allowed = await filterAccessibleCourses(db, user, [inst.courseId]);
  if (!allowed.length) throw new ObservationError(403, 'No access to this course');

  const context = await observationContext(db, inst);
  try {
    const [result] = await db.query(
      `INSERT INTO instructor_observations (activity_instance_id, observer_id, label, observed_at, context)
       VALUES (?, ?, ?, NOW(3), ?)`,
      [id, user.id, label, JSON.stringify(context)]
    );
    return { id: result.insertId, observedAt: Date.now(), label, context };
  } catch (err) {
    if (tableMissing(err)) throw new ObservationError(503, 'Observations are not set up on this server yet (database migration 026).');
    throw err;
  }
}

/** Undo: only the observer's own tag, shortly after it was given. */
async function deleteObservation(db, user, observationId) {
  const id = Number(observationId);
  if (!Number.isInteger(id) || id <= 0) throw new ObservationError(400, 'Invalid observation');
  const [result] = await db.query(
    `DELETE FROM instructor_observations
      WHERE id = ? AND observer_id = ? AND observed_at >= DATE_SUB(NOW(3), INTERVAL ? SECOND)`,
    [id, user.id, UNDO_WINDOW_SECONDS]
  );
  if (!result.affectedRows) throw new ObservationError(409, 'This tag can no longer be undone.');
}

module.exports = { LABELS, ObservationError, createObservation, deleteObservation, observationContext };
