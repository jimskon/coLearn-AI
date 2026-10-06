// Research instrumentation for turn-taking and instructor actions.
//
// The response trace records who submitted, but not who was *asked* to act or
// what the instructor did. These events fill that gap so turns, skipped turns,
// reassignments, and interventions can be reconstructed (docs/research-statistics.md).
// They are fire-and-forget: recording never blocks or fails a request.
const { recordAuditEvent } = require('./auditLogger');

// Why the active student changed.
const TURN_REASONS = Object.freeze({
  ROTATION_AFTER_SUBMIT: 'rotation_after_submit', // system rotation after a group submit
  INSTRUCTOR_ROTATE: 'instructor_rotate',         // instructor pressed "rotate" on View Groups
  ABSENT_REASSIGNED: 'absent_reassigned',         // active student's heartbeat went stale
  ALL_ABSENT: 'all_absent',                       // active student gone and nobody else present; turn cleared
  CLAIMED: 'claimed',                             // no one was active; a present member took the turn
  GROUP_SETUP: 'group_setup',                     // set when the instance was created
  SOLO_JOIN: 'solo_join',                         // a student started a solo instance
  CLEARED_ON_COMPLETION: 'cleared_on_completion', // activity completed; no active student
});

function toId(value) {
  const n = Number(value);
  return value == null || !Number.isFinite(n) || n <= 0 ? null : n;
}

/** Log a change of active student. No-op when nothing changed. */
function recordTurnChange(req, instanceId, fromStudentId, toStudentId, reason) {
  const from = toId(fromStudentId);
  const to = toId(toStudentId);
  if (from === to) return;
  // Nobody received the turn: it was cleared, not reassigned.
  const effectiveReason = reason === TURN_REASONS.ABSENT_REASSIGNED && to == null
    ? TURN_REASONS.ALL_ABSENT
    : reason;
  void recordAuditEvent('active_student_changed', {
    req,
    activityInstanceId: toId(instanceId),
    details: { from, to, reason: effectiveReason },
  });
}

/** Log an instructor pushing a group past a question group. */
function recordInstructorForceAdvance(req, instanceId, details) {
  void recordAuditEvent('instructor_force_advance', {
    req,
    activityInstanceId: toId(instanceId),
    details,
  });
}

/** Log an instructor pausing or resuming a run (paused time is excluded from durations). */
function recordPauseChange(req, instanceId, paused) {
  void recordAuditEvent(paused ? 'activity_paused' : 'activity_resumed', {
    req,
    activityInstanceId: toId(instanceId),
  });
}

module.exports = { TURN_REASONS, recordTurnChange, recordInstructorForceAdvance, recordPauseChange };
