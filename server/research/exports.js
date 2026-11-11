'use strict';

// Row-level research datasets, built from reconstructed runs (./reconstruct.js).
// Pure functions: the caller supplies the runs, labels, and a pseudonym
// function. Students, groups (runs), and instructors appear only as
// pseudonymous IDs (./pseudonym.js); names and emails are never exported.
// Answer and feedback text is exported only in feedback_revision_pairs and
// response_history (JSON Lines, one record per question per group, for coding
// answers by hand or with an AI).

const { balanceIndex } = require('../stats/compute');
const { compareVersions } = require('./reconstruct');
const { pausedWithin } = require('./pauses');

const DATASETS = ['question_attempts', 'feedback_revision_pairs', 'group_participation', 'student_longitudinal', 'response_history'];
// Datasets exported as JSON Lines (nested, long text) rather than CSV.
const JSONL_DATASETS = new Set(['response_history']);

const iso = (ms) => (ms == null ? '' : new Date(ms).toISOString());
const secs = (ms) => (ms == null ? '' : Math.round(ms / 100) / 10);
const round = (x, digits = 4) => (x == null || !Number.isFinite(x) ? '' : Number(x.toFixed(digits)));
const bool = (b) => (b == null ? '' : b ? 1 : 0);

function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Activity order within each course, by the date of its first included run
// (the same rule as the Over Time breakdown).
function activitySequence(runs) {
  const firstRun = new Map();
  for (const run of runs) {
    const k = `${run.courseId}|${run.activityId}`;
    firstRun.set(k, Math.min(firstRun.get(k) ?? Infinity, run.startAt ?? Infinity));
  }
  const sequence = new Map();
  const perCourse = new Map();
  for (const [k, at] of [...firstRun.entries()].sort((a, b) => a[1] - b[1])) {
    void at;
    const course = k.split('|')[0];
    const n = (perCourse.get(course) || 0) + 1;
    perCourse.set(course, n);
    sequence.set(k, n);
  }
  return sequence;
}

/** Columns shared by every dataset, identifying the run. */
function runColumns(run, ctx) {
  return {
    course_id: run.courseId,
    course: ctx.courseLabels.get(run.courseId) || '',
    activity_id: run.activityId,
    activity: ctx.activityTitles.get(run.activityId) || '',
    activity_seq: ctx.sequence.get(`${run.courseId}|${run.activityId}`) ?? '',
    group_id: ctx.pseudonym('group', run.instanceId),
    group_size: run.groupSize,
    run_start: iso(run.rec.timing.startAt ?? run.startAt),
    run_status: run.status || '',
    turn_coverage: run.rec.turnCoverage,
  };
}

const personId = (ctx, run, userId) =>
  (userId == null ? '' : ctx.pseudonym(run.studentIds.has(userId) ? 'student' : 'instructor', userId));

// Answer as students last saw it at or before a given submit (versions carry
// forward parts not rewritten), as one text: written answer, then code.
function answerAt(question, submitOrder, order) {
  let found = null;
  for (const v of question.versions) {
    if ((submitOrder.get(v.submitId) ?? Infinity) <= order) found = v;
  }
  return found;
}
const answerText = (v) => (v ? [v.text, v.code].filter((x) => x != null && x !== '').join('\n') : '');

function questionAttemptRows(run, ctx) {
  const base = runColumns(run, ctx);
  const rows = [];
  for (const q of run.rec.questions) {
    q.attempts.forEach((a, i) => {
      const previous = q.attempts[i - 1];
      rows.push({
        ...base,
        qid: q.qid,
        question_group: q.groupNum,
        question_type: q.questionType,
        has_code: bool(q.hasCode),
        attempt_number: a.number,
        attempt_at: iso(a.at),
        submitted_by: personId(ctx, run, a.userId),
        submitter_is_student: bool(run.studentIds.has(a.userId)),
        decision: a.decision,
        feedback_chars: a.feedback ? a.feedback.length : 0,
        seconds_since_previous_attempt: previous ? secs(q.attemptGaps[i - 1]?.ms) : '',
        is_last_attempt: bool(i === q.attempts.length - 1),
        question_outcome: q.outcome,
        attempts_to_acceptance: q.attemptsToAcceptance ?? '',
        max_retries_reached: bool(q.maxRetriesReached),
      });
    });
  }
  return rows;
}

function feedbackRevisionRows(run, ctx) {
  const base = runColumns(run, ctx);
  const submitOrder = new Map(run.rec.submits.map((s, i) => [s.submitId, i]));
  const rows = [];
  for (const q of run.rec.questions) {
    q.attempts.forEach((a, i) => {
      if (a.decision !== 'rejected') return;
      const next = q.attempts[i + 1] || null;
      const before = answerAt(q, submitOrder, submitOrder.get(a.submitId) ?? -1);
      // Without a next evaluated attempt, "after" is the last answer submitted.
      const after = next
        ? answerAt(q, submitOrder, submitOrder.get(next.submitId) ?? Infinity)
        : q.versions[q.versions.length - 1] || null;
      const changed = before && after && after !== before;
      const diff = changed ? compareVersions(before, after, q.hasCode) : null;
      rows.push({
        ...base,
        qid: q.qid,
        question_group: q.groupNum,
        question_type: q.questionType,
        has_code: bool(q.hasCode),
        attempt_number: a.number,
        attempt_at: iso(a.at),
        submitted_by: personId(ctx, run, a.userId),
        answer_before: answerText(before),
        feedback: a.feedback || '',
        answer_after: changed ? answerText(after) : '',
        revised: bool(!!changed),
        revised_by: changed ? personId(ctx, run, after.userId) : '',
        next_attempt_at: iso(next?.at),
        next_decision: next ? next.decision : 'none',
        seconds_to_next_attempt: next ? secs(q.attemptGaps[i]?.ms) : '',
        chars_before: diff?.charsBefore ?? '',
        chars_after: diff?.charsAfter ?? '',
        edit_distance: diff?.editDistance ?? '',
        normalized_edit_distance: round(diff?.normalizedEditDistance),
        lines_added: diff?.linesAdded ?? '',
        lines_removed: diff?.linesRemoved ?? '',
        question_outcome: q.outcome,
      });
    });
  }
  return rows;
}

function groupParticipationRow(run, ctx) {
  const { rec } = run;
  const students = [...run.studentIds];
  const counts = students.map((id) => rec.participation.submitsByStudent.get(id) || 0);
  const total = rec.submits.length;
  const studentSubmits = counts.reduce((a, b) => a + b, 0);
  const turns = rec.turnsRecorded ? rec.turns.filter((t) => t.isStudent && !t.transient) : [];
  const closed = turns.filter((t) => t.endAt != null);
  const turnCounts = students.map((id) => turns.filter((t) => t.studentId === id).length);
  const scored = rec.questions.filter((q) => !q.isSurvey);
  const outcome = (o) => scored.filter((q) => q.outcome === o).length;
  const interventions = rec.turnsRecorded ? rec.interventions : [];
  const lastAt = rec.timing.lastActivityAt;
  return {
    ...runColumns(run, ctx),
    submits: total,
    student_submits: studentSubmits,
    members_who_submitted: counts.filter((c) => c > 0).length,
    submit_balance_0_1: run.studentIds.size >= 2 && studentSubmits ? round(balanceIndex(counts)) : '',
    top_member_share: studentSubmits ? round(Math.max(...counts) / studentSubmits) : '',
    longest_submit_streak: rec.participation.longestSubmitStreak,
    turns: rec.turnsRecorded ? turns.length : '',
    turn_balance_0_1: rec.turnsRecorded && run.studentIds.size >= 2 && turnCounts.some((c) => c > 0) ? round(balanceIndex(turnCounts)) : '',
    skipped_turns: rec.turnsRecorded ? closed.filter((t) => t.skipped).length : '',
    instructor_reassigned_turns: rec.turnsRecorded ? closed.filter((t) => t.reassignedByInstructor).length : '',
    median_seconds_to_first_submit: rec.turnsRecorded ? secs(median(turns.map((t) => t.latencyMs))) : '',
    interventions_force_advance: rec.turnsRecorded ? interventions.filter((i) => i.type === 'force_advance').length : '',
    interventions_rotate: rec.turnsRecorded ? interventions.filter((i) => i.type === 'rotate_active').length : '',
    questions: scored.length,
    questions_evaluated: scored.filter((q) => q.attempts.length).length,
    outcome_ai_accepted: outcome('ai_accepted'),
    outcome_continued: outcome('continued'),
    outcome_instructor_advanced: outcome('instructor_advanced'),
    outcome_advanced_other: outcome('advanced_other'),
    outcome_unresolved: outcome('unresolved'),
    outcome_not_attempted: outcome('not_attempted'),
    rejected_attempts: scored.reduce((n, q) => n + q.rejectedAttempts, 0),
    active_seconds: rec.timing.startKnown ? secs(rec.timing.durationMs) : '',
    wall_clock_seconds: rec.timing.startKnown ? secs(rec.timing.wallClockMs) : '',
    submit_span_seconds: secs(rec.timing.submitSpanMs),
    pauses: rec.pauses.length,
    paused_seconds: rec.pauses.length
      ? secs(pausedWithin(rec.pauses, rec.timing.startAt ?? rec.timing.firstActivityAt, lastAt, lastAt))
      : 0,
    in_class_end: rec.inClass?.endAt != null ? new Date(rec.inClass.endAt).toISOString() : '',
    in_class_end_reason: rec.inClass?.endReason ?? '',
    after_class_activity: rec.inClass?.afterClassActivity ? 1 : 0,
    after_class_submits_set_aside: rec.inClass?.afterClassSubmits ?? 0,
  };
}

function studentLongitudinalRows(run, ctx) {
  const { rec } = run;
  const base = runColumns(run, ctx);
  const totalStudentSubmits = [...run.studentIds].reduce((n, id) => n + (rec.participation.submitsByStudent.get(id) || 0), 0);
  const attempts = rec.questions.filter((q) => !q.isSurvey).flatMap((q) => q.attempts);
  const turns = rec.turnsRecorded ? rec.turns.filter((t) => t.isStudent && !t.transient) : [];
  return [...run.studentIds].sort((a, b) => a - b).map((id) => {
    const submits = rec.participation.submitsByStudent.get(id) || 0;
    const mine = attempts.filter((a) => a.userId === id);
    const myTurns = turns.filter((t) => t.studentId === id);
    return {
      student_id: ctx.pseudonym('student', id),
      ...base,
      submits,
      share_of_group_submits: totalStudentSubmits ? round(submits / totalStudentSubmits) : '',
      evaluated_attempts: mine.length,
      first_attempts_accepted: mine.filter((a) => a.number === 1 && a.decision === 'accepted').length,
      attempts_accepted: mine.filter((a) => a.decision === 'accepted').length,
      attempts_rejected: mine.filter((a) => a.decision === 'rejected').length,
      turns: rec.turnsRecorded ? myTurns.length : '',
      turns_with_submit: rec.turnsRecorded ? myTurns.filter((t) => t.submits > 0).length : '',
      skipped_turns: rec.turnsRecorded ? myTurns.filter((t) => t.endAt != null && t.skipped).length : '',
      median_seconds_to_first_submit: rec.turnsRecorded ? secs(median(myTurns.map((t) => t.latencyMs))) : '',
    };
  });
}

// One record per question per group run: the question's markup, then every
// submitted version and AI decision in order. In-class work only (the same
// window as every statistic). Surveys and questions never answered are left out.
function responseHistoryRows(run, ctx) {
  const base = runColumns(run, ctx);
  const meta = ctx.activityMeta?.get(run.activityId);
  const submitOrder = new Map(run.rec.submits.map((s, i) => [s.submitId, i]));
  const rows = [];
  for (const q of run.rec.questions) {
    if (q.isSurvey || (!q.versions.length && !q.attempts.length)) continue;
    const mq = meta?.questions?.get(q.qid);
    const group = meta?.groups?.find((g) => g.groupNum === q.groupNum);
    const attemptBySubmit = new Map(q.attempts.map((a) => [a.submitId, a]));
    const versionBySubmit = new Map(q.versions.map((v, i) => [v.submitId, { ...v, number: i + 1 }]));
    const submitIds = [...new Set([...q.versions.map((v) => v.submitId), ...q.attempts.map((a) => a.submitId)])]
      .sort((a, b) => (submitOrder.get(a) ?? 0) - (submitOrder.get(b) ?? 0));
    let previousAt = null;
    let currentVersion = null;
    const history = submitIds.map((id) => {
      const v = versionBySubmit.get(id);
      const a = attemptBySubmit.get(id);
      const at = a?.at ?? v?.at ?? null;
      const changed = !!v;
      if (v) currentVersion = v;
      const step = {
        submit: (submitOrder.get(id) ?? 0) + 1,
        at: iso(at),
        seconds_since_previous: previousAt != null && at != null ? secs(at - previousAt) : null,
        submitted_by: personId(ctx, run, a?.userId ?? v?.userId),
        answer_changed: changed,
        version: currentVersion?.number ?? null,
        answer_text: currentVersion?.text ?? null,
        answer_code: currentVersion?.code ?? null,
        program_output: currentVersion?.output ?? null,
        ai_decision: a?.decision ?? null,
        ai_feedback: a?.feedback ?? null,
      };
      previousAt = at;
      return step;
    });
    rows.push({
      record: 'question_history',
      ...base,
      qid: q.qid,
      question_group: q.groupNum,
      question_type: q.questionType,
      has_code: q.hasCode,
      question_markup: mq?.source ?? null,
      question_group_context: group?.intro || null,
      outcome: q.outcome,
      first_decision: q.firstDecision,
      attempts: q.attempts.length,
      attempts_to_acceptance: q.attemptsToAcceptance,
      versions: q.versions.length,
      history,
    });
  }
  return rows;
}

// One record per activity with its full markup, ahead of its question histories.
function activityRecords(runs, ctx) {
  const seen = new Set();
  const out = [];
  for (const run of runs) {
    if (seen.has(run.activityId)) continue;
    seen.add(run.activityId);
    const meta = ctx.activityMeta?.get(run.activityId);
    out.push({
      record: 'activity',
      course_id: run.courseId,
      course: ctx.courseLabels.get(run.courseId) || '',
      activity_id: run.activityId,
      activity: ctx.activityTitles.get(run.activityId) || '',
      activity_seq: ctx.sequence.get(`${run.courseId}|${run.activityId}`) ?? '',
      activity_markup: meta?.sourceText || null,
    });
  }
  return out;
}

const BUILDERS = {
  question_attempts: questionAttemptRows,
  feedback_revision_pairs: feedbackRevisionRows,
  group_participation: (run, ctx) => [groupParticipationRow(run, ctx)],
  student_longitudinal: studentLongitudinalRows,
  response_history: responseHistoryRows,
};

/**
 * @param {string} dataset  one of DATASETS
 * @param {Array} runs  from service.buildRuns (+ applyFilters)
 * @param {{courseLabels:Map, activityTitles:Map, pseudonym:(kind,id)=>string}} ctx
 */
function buildDataset(dataset, runs, { courseLabels = new Map(), activityTitles = new Map(), activityMeta = new Map(), pseudonym }) {
  const build = BUILDERS[dataset];
  if (!build) throw new Error(`Unknown dataset: ${dataset}`);
  const ordered = [...runs].sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0) || a.instanceId - b.instanceId);
  const ctx = { courseLabels, activityTitles, activityMeta, pseudonym, sequence: activitySequence(runs) };
  const rows = ordered.flatMap((run) => build(run, ctx));
  if (dataset !== 'response_history') return rows;
  // Activity records first, then question histories grouped by activity.
  const order = (r) => [ctx.sequence.get(`${r.course_id}|${r.activity_id}`) ?? 0, r.record === 'activity' ? 0 : 1];
  return [...activityRecords(ordered, ctx), ...rows].sort((a, b) => {
    const [sa, ra] = order(a);
    const [sb, rb] = order(b);
    return a.course_id - b.course_id || sa - sb || ra - rb;
  });
}

/** Records -> JSON Lines text (one JSON object per line). */
function toJsonl(rows) {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows (objects with the same keys) -> CSV text. */
function toCsv(rows, columns = rows[0] ? Object.keys(rows[0]) : []) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n');
}

module.exports = { DATASETS, JSONL_DATASETS, buildDataset, toCsv, toJsonl, activitySequence };
