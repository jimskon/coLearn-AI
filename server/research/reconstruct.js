'use strict';

// Rebuilds what happened in one group's activity run from the raw trace.
// Pure functions: no database access, so every rule here is unit-tested.
// Definitions are documented in docs/research-statistics.md; keep them in sync.
//
// Trace conventions (see server/activity_instances/controller.js):
// - A group submit is the set of `responses` rows sharing a submit_id that
//   includes a "<groupNum>state" row ('complete' = the group advanced).
// - "attempt:<groupNum>" (JSON) records forceOverride (the Continue button) and
//   `unanswered` tags: "1a (AI)" / "1b (needs revision)" = sent back by the AI.
// - "<qid>FM" = AI decision on written answers ('accepted' | 'needsRevision');
//   "<qid>CodeAccepted" = 'true' | 'false' for code questions.
// - Answer rows ("<qid>", "<qid>code<n>") are appended only when changed.
// - audit_log 'active_student_changed' {from, to, reason} and
//   'instructor_force_advance' {groupNum} (recorded from Phase 2 onward).

const text = require('./text');

const DEFAULT_OPTIONS = Object.freeze({
  // Gaps between activity points longer than this count only up to this much
  // toward time on task (default 10 minutes).
  idleThresholdMs: 10 * 60 * 1000,
  // An intervention "after inactivity" follows at least this long with no
  // submit or turn change (default 3 minutes).
  interventionInactivityMs: 3 * 60 * 1000,
  // An intervention "after repeated failed attempts" follows at least this
  // many consecutive sent-back submits for the current question group.
  interventionRejectionStreak: 2,
  // Instructor rotations closer together than this are one intervention
  // (an instructor clicking rotate repeatedly to reach a particular student).
  rotationBurstMs: 10 * 1000,
});

const STATE_KEY = /^(\d+)state$/;
const ATTEMPT_KEY = /^attempt:(\d+)$/;
const SENT_BACK_TAG = /^(\S+) \((?:AI|needs revision)\)$/;
const EVAL_ERROR_TAG = /^(\S+) \(evaluation error\)$/;

function parseJson(value) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return null;
  }
}

function asText(value) {
  return value == null ? '' : String(value);
}

// Time on task between start and end, counting each gap between consecutive
// activity points (and the ends) only up to the idle threshold.
function cappedSpan(startAt, endAt, points, idleThresholdMs) {
  if (startAt == null || endAt == null || endAt < startAt) return null;
  const inside = points.filter((t) => t > startAt && t < endAt).sort((a, b) => a - b);
  const marks = [startAt, ...inside, endAt];
  let total = 0;
  for (let i = 1; i < marks.length; i += 1) total += Math.min(marks[i] - marks[i - 1], idleThresholdMs);
  return total;
}

/** Group submits, in order. Rows that are not part of a group submit are ignored. */
function buildSubmits(rows) {
  const bySubmit = new Map();
  for (const row of rows) {
    const key = row.submitId || `row:${row.id}`;
    if (!bySubmit.has(key)) bySubmit.set(key, []);
    bySubmit.get(key).push(row);
  }

  const submits = [];
  for (const [submitId, group] of bySubmit) {
    const stateRow = group.find((r) => STATE_KEY.test(r.questionId));
    if (!stateRow) continue;
    const attemptRow = group.find((r) => ATTEMPT_KEY.test(r.questionId));
    const attempt = parseJson(attemptRow?.response) || {};
    const unanswered = Array.isArray(attempt.unanswered) ? attempt.unanswered.map(String) : [];

    const byKey = new Map();
    for (const r of group) if (!byKey.has(r.questionId)) byKey.set(r.questionId, r);

    submits.push({
      submitId,
      firstRowId: Math.min(...group.map((r) => r.id)),
      at: Math.min(...group.map((r) => r.at)),
      userId: stateRow.userId,
      groupNum: Number(STATE_KEY.exec(stateRow.questionId)[1]),
      advanced: String(stateRow.response || '').trim().toLowerCase() === 'complete',
      forceOverride: !!attempt.forceOverride,
      retriesRequired: Number.isFinite(Number(attempt.retriesRequired)) ? Number(attempt.retriesRequired) : null,
      sentBack: unanswered.map((u) => SENT_BACK_TAG.exec(u)?.[1]).filter(Boolean),
      evalErrors: unanswered.map((u) => EVAL_ERROR_TAG.exec(u)?.[1]).filter(Boolean),
      byKey,
    });
  }
  return submits.sort((a, b) => a.firstRowId - b.firstRowId);
}

function decisionFor(qid, submit) {
  if (submit.sentBack.includes(qid)) return 'rejected';
  const fm = asText(submit.byKey.get(`${qid}FM`)?.response).trim();
  if (fm === 'needsRevision') return 'rejected';
  if (fm === 'accepted') return 'accepted';
  const code = asText(submit.byKey.get(`${qid}CodeAccepted`)?.response).trim().toLowerCase();
  if (code === 'false') return 'rejected';
  if (code === 'true') return 'accepted';
  return null; // not evaluated in this submit
}

function answerSnapshot(qid, submit) {
  const codeKey = new RegExp(`^${qid}code(\\d+)$`);
  let answerText = null;
  const cells = [];
  let output = null;
  for (const [key, row] of submit.byKey) {
    if (key === qid) answerText = asText(row.response);
    else if (codeKey.test(key)) cells.push([Number(codeKey.exec(key)[1]), asText(row.response)]);
    else if (key === `${qid}output` || key === `${qid}Output`) output = asText(row.response);
  }
  if (answerText == null && !cells.length) return null;
  cells.sort((a, b) => a[0] - b[0]);
  return {
    text: answerText,
    code: cells.length ? cells.map(([, c]) => c).join('\n') : null,
    output,
  };
}

function compareVersions(before, after, hasCode) {
  const combined = (v) => [v.text, v.code].filter((x) => x != null).join('\n');
  const a = combined(before);
  const b = combined(after);
  const edit = text.editDistance(a, b);
  const norm = text.normalizedEditDistance(a, b);
  const lines = hasCode && (before.code != null || after.code != null)
    ? text.lineChanges(before.code ?? '', after.code ?? '')
    : text.lineChanges(a, b);
  return {
    charsBefore: text.charCount(a),
    charsAfter: text.charCount(b),
    charDelta: text.charCount(b) - text.charCount(a),
    wordsBefore: text.wordCount(a),
    wordsAfter: text.wordCount(b),
    editDistance: edit.distance,
    normalizedEditDistance: norm.value,
    editDistanceApproximate: edit.approximate,
    linesAdded: lines.linesAdded,
    linesRemoved: lines.linesRemoved,
    outputChanged:
      before.output != null && after.output != null ? before.output !== after.output : null,
  };
}

/**
 * @param {object} input
 * @param {{id:number, startAt:number|null}} input.instance
 * @param {Array<{studentId:number, isStudent:boolean}>} input.members
 * @param {Array<{id, submitId, questionId, response, userId, at}>} input.rows  (at = epoch ms)
 * @param {Array<{id, type, at, userId, details}>} input.events
 * @param {{questions: Map}} input.meta  from shared/activityResearchMeta.cjs
 */
function reconstructInstance({ instance, members = [], rows = [], events = [], meta, options = {} }) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sortedRows = [...rows].sort((a, b) => a.id - b.id);
  const submits = buildSubmits(sortedRows);
  const sortedEvents = [...events].sort((a, b) => a.at - b.at || a.id - b.id);
  const turnEvents = sortedEvents.filter((e) => e.type === 'active_student_changed');
  const forceAdvances = sortedEvents.filter((e) => e.type === 'instructor_force_advance');

  const activityPoints = [
    ...submits.map((s) => s.at),
    ...turnEvents.map((e) => e.at),
    ...forceAdvances.map((e) => e.at),
  ].sort((a, b) => a - b);
  const startAt = instance?.startAt ?? activityPoints[0] ?? null;
  const firstActivityAt = activityPoints[0] ?? null;
  const lastActivityAt = activityPoints[activityPoints.length - 1] ?? null;

  // When each question group became current, and how it was left.
  const groupNums = [...new Set([...meta.questions.values()].map((q) => q.groupNum))].sort((a, b) => a - b);
  const groupExit = new Map(); // groupNum -> { at, how: 'submit' | 'continue' | 'instructor' }
  for (const s of submits) {
    if (s.advanced && !groupExit.has(s.groupNum)) {
      groupExit.set(s.groupNum, { at: s.at, how: s.forceOverride ? 'continue' : 'submit' });
    }
  }
  for (const e of forceAdvances) {
    const g = Number(e.details?.groupNum);
    if (g && !groupExit.has(g)) groupExit.set(g, { at: e.at, how: 'instructor' });
  }
  const groupEntry = (g) => {
    if (g === groupNums[0] || g === 1) return firstActivityAt;
    return groupExit.get(g - 1)?.at ?? null;
  };

  // ---- Questions ----
  const questions = [];
  for (const q of meta.questions.values()) {
    const attempts = [];
    const versions = [];
    let accepted = null;

    for (const s of submits) {
      if (s.groupNum !== q.groupNum) continue;

      const snap = answerSnapshot(q.qid, s);
      if (snap) {
        const last = versions[versions.length - 1];
        // Carry forward parts not rewritten in this submit.
        const merged = last
          ? { text: snap.text ?? last.text, code: snap.code ?? last.code, output: snap.output ?? last.output }
          : snap;
        versions.push({ submitId: s.submitId, at: s.at, userId: s.userId, ...merged });
      }

      if (accepted) continue; // evaluations after acceptance are repeats
      const decision = decisionFor(q.qid, s);
      if (!decision) continue;
      const feedbackRow = s.byKey.get(`${q.qid}F1`) || s.byKey.get(`${q.qid}CodeFeedback`);
      const attempt = {
        number: attempts.length + 1,
        submitId: s.submitId,
        at: s.at,
        userId: s.userId,
        decision,
        feedback: asText(feedbackRow?.response).trim() || null,
      };
      attempts.push(attempt);
      if (decision === 'accepted') accepted = attempt;
    }

    const exit = groupExit.get(q.groupNum) || null;
    let outcome;
    if (q.isSurvey) outcome = 'survey';
    else if (accepted) outcome = 'ai_accepted';
    else if (exit?.how === 'continue') outcome = 'continued';
    else if (exit?.how === 'instructor') outcome = 'instructor_advanced';
    else if (exit) outcome = 'advanced_other';
    else if (attempts.length) outcome = 'unresolved';
    else outcome = 'not_attempted';

    const rejected = attempts.filter((a) => a.decision === 'rejected').length;
    const retriesRequired = submits.find((s) => s.groupNum === q.groupNum && s.retriesRequired != null)?.retriesRequired ?? null;

    const enteredAt = groupEntry(q.groupNum);
    const resolvedAt = accepted?.at ?? exit?.at ?? null;
    const revisions = [];
    for (let i = 1; i < versions.length; i += 1) {
      revisions.push({
        fromVersion: i,
        toVersion: i + 1,
        at: versions[i].at,
        ...compareVersions(versions[i - 1], versions[i], q.hasCode),
      });
    }

    questions.push({
      qid: q.qid,
      groupNum: q.groupNum,
      sectionIndex: q.sectionIndex,
      questionType: q.questionType || 'unknown',
      hasCode: !!q.hasCode,
      isSurvey: !!q.isSurvey,
      attempts,
      versions,
      revisions,
      outcome,
      firstDecision: attempts[0]?.decision ?? null,
      attemptsToAcceptance: accepted ? accepted.number : null,
      rejectedAttempts: rejected,
      // Group-level retry allowance used up for this question (see docs).
      maxRetriesReached: retriesRequired != null && rejected >= Math.max(1, retriesRequired),
      enteredAt,
      firstAttemptAt: attempts[0]?.at ?? null,
      resolvedAt,
      durationMs: cappedSpan(enteredAt, resolvedAt, activityPoints, opts.idleThresholdMs),
    });
  }

  // ---- Turns (forward-only: needs active_student_changed events) ----
  const studentIds = new Set(members.filter((m) => m.isStudent).map((m) => m.studentId));
  const turns = [];
  for (let i = 0; i < turnEvents.length; i += 1) {
    const e = turnEvents[i];
    const holder = e.details?.to ?? null;
    if (holder == null) continue;
    const next = turnEvents[i + 1] || null;
    const endAt = next?.at ?? null;
    const own = submits.filter(
      (s) => s.userId === holder && s.at >= e.at && (endAt == null || s.at < endAt)
    );
    turns.push({
      studentId: holder,
      isStudent: studentIds.has(holder),
      startAt: e.at,
      endAt,
      startReason: e.details?.reason ?? null,
      endReason: next?.details?.reason ?? null,
      submits: own.length,
      firstSubmitAt: own[0]?.at ?? null,
      // A turn taken away (absence, instructor, or another member claiming it)
      // with no submit by its holder. Open and completed-activity turns are not skipped.
      skipped:
        own.length === 0 &&
        next != null &&
        ['absent_reassigned', 'all_absent', 'instructor_rotate', 'claimed'].includes(next.details?.reason),
      reassignedByInstructor: next?.details?.reason === 'instructor_rotate',
    });
  }

  // ---- Instructor interventions ----
  const interventions = [];
  const lastPointBefore = (at) => {
    let last = null;
    for (const t of activityPoints) {
      if (t < at) last = t;
      else break;
    }
    return last;
  };
  const rejectionStreakBefore = (at, groupNum) => {
    let streak = 0;
    for (const s of submits.filter((x) => x.at <= at && (groupNum == null || x.groupNum === groupNum)).reverse()) {
      if (!s.advanced && s.sentBack.length) streak += 1;
      else break;
    }
    return streak;
  };
  const currentGroupAt = (at) => {
    let g = groupNums[0] ?? 1;
    for (const [num, exit] of [...groupExit.entries()].sort((a, b) => a[0] - b[0])) {
      if (exit.at <= at) g = num + 1;
    }
    return g;
  };
  const describe = (type, e, groupNum) => {
    const previous = lastPointBefore(e.at);
    return {
      type,
      at: e.at,
      instructorId: e.userId ?? null,
      groupNum,
      afterInactivity: previous == null || e.at - previous >= opts.interventionInactivityMs,
      afterRepeatedRejections: rejectionStreakBefore(e.at, groupNum) >= opts.interventionRejectionStreak,
    };
  };
  for (const e of forceAdvances) interventions.push(describe('force_advance', e, Number(e.details?.groupNum) || null));
  let lastRotationAt = null;
  for (const e of turnEvents) {
    if (e.details?.reason !== 'instructor_rotate') continue;
    const inBurst = lastRotationAt != null && e.at - lastRotationAt < opts.rotationBurstMs;
    lastRotationAt = e.at;
    if (inBurst) {
      const burst = [...interventions].reverse().find((i) => i.type === 'rotate_active');
      if (burst) burst.rotations += 1;
      continue;
    }
    interventions.push({ ...describe('rotate_active', e, currentGroupAt(e.at)), rotations: 1 });
  }
  interventions.sort((a, b) => a.at - b.at);

  // ---- Submit-based participation (all history) ----
  const submitsByStudent = new Map();
  for (const id of studentIds) submitsByStudent.set(id, 0);
  let longestStreak = 0;
  let streak = 0;
  let previousUser = null;
  for (const s of submits) {
    if (studentIds.has(s.userId)) submitsByStudent.set(s.userId, submitsByStudent.get(s.userId) + 1);
    streak = s.userId === previousUser ? streak + 1 : 1;
    previousUser = s.userId;
    longestStreak = Math.max(longestStreak, streak);
  }

  return {
    instanceId: instance?.id ?? null,
    submits: submits.map(({ byKey, ...rest }) => rest),
    questions,
    turns,
    turnsRecorded: turnEvents.length > 0,
    interventions,
    participation: { submitsByStudent, longestSubmitStreak: longestStreak },
    timing: {
      startAt,
      firstActivityAt,
      lastActivityAt,
      durationMs: cappedSpan(startAt, lastActivityAt, activityPoints, opts.idleThresholdMs),
      wallClockMs: startAt != null && lastActivityAt != null ? lastActivityAt - startAt : null,
    },
  };
}

module.exports = { reconstructInstance, buildSubmits, cappedSpan, DEFAULT_OPTIONS };
