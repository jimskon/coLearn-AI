'use strict';

// Glue: load the trace for allowed courses, reconstruct each run, apply the
// shared filters, and compute metrics. Shared by the API routes and exports.

const { loadResearchTrace } = require('./trace');
const { reconstructInstance, DEFAULT_OPTIONS } = require('./reconstruct');
const { computeResearchMetrics, sizeBucket } = require('./metrics');
const { buildDataset, toCsv } = require('./exports');
const { pseudonym, researchSecret } = require('./pseudonym');
const { loadActivitySourceById } = require('../utils/activityContent');
const { recordAuditEvent } = require('../utils/auditLogger');
const { envTokens } = require('../utils/runtimeFeatures');

const MIN_IDLE_MINUTES = 1;
const MAX_IDLE_MINUTES = 120;
const BREAK_MINUTES = { min: 5, max: 24 * 60 };
const SESSION_MINUTES = { min: 10, max: 24 * 60 };
// Activity types (authored \mode) a study can include. Group activities only by
// default. Tests are never included (they are also excluded by the is_test flag).
const ACTIVITY_TYPES = ['group', 'assignment', 'practice', 'demo', 'playground'];
const DEFAULT_ACTIVITY_TYPES = ['group'];

function parseActivityTypes(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const picked = ACTIVITY_TYPES.filter((t) => list.map((x) => String(x).trim().toLowerCase()).includes(t));
  return picked.length ? picked : [...DEFAULT_ACTIVITY_TYPES];
}

// Keeps only runs of the selected activity types. Runs left out are counted,
// in total and by type, never dropped silently.
function selectActivityTypes(trace, activityTypes) {
  const allowed = new Set(activityTypes);
  const byType = {};
  let left = 0;
  const instances = trace.instances.filter((i) => {
    const type = trace.activities.get(i.activityId)?.activityType || 'group';
    byType[type] = (byType[type] || 0) + 1;
    if (allowed.has(type)) return true;
    left += 1;
    return false;
  });
  return { ...trace, instances, excluded: { ...trace.excluded, activityTypeNotSelected: left }, runsByActivityType: byType };
}

function minutesOption(value, { min, max }, defaultMs) {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value != null ? Math.min(max, Math.max(min, n)) : defaultMs / 60000;
}

function parseOptions(params = {}) {
  const idle = Number(params.idleMinutes);
  const idleMinutes = Number.isFinite(idle)
    ? Math.min(MAX_IDLE_MINUTES, Math.max(MIN_IDLE_MINUTES, idle))
    : DEFAULT_OPTIONS.idleThresholdMs / 60000;
  // In-class window (see reconstruct.js inClassWindow).
  const breakMinutes = minutesOption(params.breakMinutes, BREAK_MINUTES, DEFAULT_OPTIONS.sessionBreakMs);
  const maxSessionMinutes = minutesOption(params.maxSessionMinutes, SESSION_MINUTES, DEFAULT_OPTIONS.maxSessionMs);
  const date = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return {
    from: date(params.from),
    // An end date includes the whole day.
    to: (() => {
      const d = date(params.to);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(String(params.to))) d.setUTCHours(23, 59, 59, 999);
      return d;
    })(),
    activityTypes: parseActivityTypes(params.activityTypes),
    groupSize: ['2', '3', '4', 'other'].includes(String(params.groupSize)) ? String(params.groupSize) : 'all',
    questionType: params.questionType ? String(params.questionType) : 'all',
    reconstruct: {
      idleThresholdMs: idleMinutes * 60000,
      sessionBreakMs: breakMinutes * 60000,
      maxSessionMs: maxSessionMinutes * 60000,
    },
    idleMinutes,
    breakMinutes,
    maxSessionMinutes,
  };
}

// A run's status, judged from in-class work only (the same window every other
// statistic uses), not from the live run state: a group that finished the
// activity after class did not finish it in class, and the live 'ended' flag
// exists only for runs after auto-end was deployed.
//   completed      the last question group was left within the in-class session
//   not_finished   group submits in class, but the activity was not finished
//   no_submits     opened but never submitted (no in-class session)
function runStatus(rec, instance) {
  if (!rec.submits.length) return 'no_submits';
  if (rec.finishedInClass != null) return rec.finishedInClass ? 'completed' : 'not_finished';
  // Activity markup unreadable: trust the live state only if nothing happened after class.
  return String(instance.progressStatus || '') === 'completed' && !rec.inClass?.afterClassSubmits
    ? 'completed'
    : 'not_finished';
}

/** Reconstruct every included run in a loaded trace. */
function buildRuns(trace, reconstructOptions = {}) {
  const runs = [];
  for (const instance of trace.instances) {
    const activity = trace.activities.get(instance.activityId);
    const members = trace.membersByInstance.get(instance.id) || [];
    const studentIds = new Set(members.filter((m) => m.isStudent).map((m) => m.studentId));
    const rec = reconstructInstance({
      instance: { id: instance.id, startAt: instance.startAt, endedAt: instance.endedAt ?? null },
      members,
      rows: trace.rowsByInstance.get(instance.id) || [],
      events: trace.eventsByInstance.get(instance.id) || [],
      slices: trace.slicesByInstance?.get(instance.id) || [],
      meta: activity?.meta || { questions: new Map() },
      options: reconstructOptions,
    });
    runs.push({
      instanceId: instance.id,
      courseId: instance.courseId,
      activityId: instance.activityId,
      startAt: instance.startAt,
      groupSize: studentIds.size,
      studentIds,
      status: runStatus(rec, instance),
      rec,
    });
  }
  return runs;
}

function applyFilters(runs, { groupSize, questionType }) {
  let out = runs;
  if (groupSize !== 'all') out = out.filter((r) => sizeBucket(r.groupSize) === groupSize);
  if (questionType !== 'all') {
    out = out.map((r) => ({ ...r, rec: { ...r.rec, questions: r.rec.questions.filter((q) => q.questionType === questionType) } }));
  }
  return out;
}

function courseLabel(c) {
  const term = [c.semester, c.year].filter(Boolean).join(' ');
  return [c.name, c.section ? `§${c.section}` : null, term].filter(Boolean).join(' · ');
}

async function computeForCourses(db, courseIds, params = {}) {
  const options = parseOptions(params);
  const trace = selectActivityTypes(await loadResearchTrace(db, { courseIds, from: options.from, to: options.to }), options.activityTypes);
  const runs = applyFilters(buildRuns(trace, options.reconstruct), options);
  const courseLabels = new Map(trace.courses.map((c) => [c.id, courseLabel(c)]));
  const activityTitles = new Map([...trace.activities.values()].map((a) => [a.id, a.title || a.name]));
  const metadataMissing = [...trace.activities.values()].filter((a) => !a.meta?.available).length;
  return {
    generatedAt: new Date().toISOString(),
    filters: {
      courseIds,
      from: options.from?.toISOString() ?? null,
      to: options.to?.toISOString() ?? null,
      activityTypes: options.activityTypes,
      groupSize: options.groupSize,
      questionType: options.questionType,
      idleMinutes: options.idleMinutes,
      breakMinutes: options.breakMinutes,
      maxSessionMinutes: options.maxSessionMinutes,
    },
    activitiesWithoutMetadata: metadataMissing,
    runsByActivityType: trace.runsByActivityType,
    ...computeResearchMetrics(runs, { excluded: trace.excluded, courseLabels, activityTitles }),
  };
}

// One row-level research dataset as CSV text, for the same selection as
// computeForCourses. Throws if RESEARCH_ID_SECRET is not set.
async function exportDataset(db, courseIds, dataset, params = {}) {
  const secret = researchSecret();
  const options = parseOptions(params);
  const trace = selectActivityTypes(await loadResearchTrace(db, { courseIds, from: options.from, to: options.to }), options.activityTypes);
  const runs = applyFilters(buildRuns(trace, options.reconstruct), options);
  const rows = buildDataset(dataset, runs, {
    courseLabels: new Map(trace.courses.map((c) => [c.id, courseLabel(c)])),
    activityTitles: new Map([...trace.activities.values()].map((a) => [a.id, a.title || a.name])),
    pseudonym: (kind, id) => pseudonym(kind, id, secret),
  });
  return { rows: rows.length, csv: toCsv(rows) };
}

// One run's reconstruction, for checking the rules against what happened in
// class. Maps and Sets are converted so the result is plain JSON.
async function reconstructRun(db, courseId, instanceId, params = {}) {
  const options = parseOptions(params);
  const trace = await loadResearchTrace(db, { courseIds: [courseId] });
  const run = buildRuns(trace, options.reconstruct).find((r) => r.instanceId === instanceId);
  if (!run) {
    return { instanceId, included: false, excluded: trace.excluded };
  }
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
  const { rec } = run;
  return {
    instanceId,
    included: true,
    status: run.status,
    groupSize: run.groupSize,
    studentIds: [...run.studentIds],
    turnCoverage: rec.turnCoverage,
    inClass: { ...rec.inClass, startAt: iso(rec.inClass?.startAt), endAt: iso(rec.inClass?.endAt) },
    timing: {
      ...rec.timing,
      startAt: iso(rec.timing.startAt),
      firstActivityAt: iso(rec.timing.firstActivityAt),
      lastActivityAt: iso(rec.timing.lastActivityAt),
    },
    submits: rec.submits.map((s) => ({ ...s, at: iso(s.at) })),
    questions: rec.questions.map((q) => ({
      qid: q.qid,
      questionType: q.questionType,
      hasCode: q.hasCode,
      isSurvey: q.isSurvey,
      outcome: q.outcome,
      firstDecision: q.firstDecision,
      attemptsToAcceptance: q.attemptsToAcceptance,
      maxRetriesReached: q.maxRetriesReached,
      attempts: q.attempts.map((a) => ({ number: a.number, at: iso(a.at), userId: a.userId, decision: a.decision, feedback: a.feedback })),
      versions: q.versions.length,
      revisions: q.revisions,
      enteredAt: iso(q.enteredAt),
      resolvedAt: iso(q.resolvedAt),
      durationSeconds: q.durationMs == null ? null : q.durationMs / 1000,
      firstResponseSeconds: q.firstResponseMs == null ? null : q.firstResponseMs / 1000,
    })),
    away: rec.away.map(([a, b]) => [iso(a), iso(b)]),
    turns: rec.turns.map((t) => ({ ...t, startAt: iso(t.startAt), endAt: iso(t.endAt), firstSubmitAt: iso(t.firstSubmitAt) })),
    interventions: rec.interventions.map((i) => ({ ...i, at: iso(i.at) })),
    participation: {
      submitsByStudent: Object.fromEntries(rec.participation.submitsByStudent),
      longestSubmitStreak: rec.participation.longestSubmitStreak,
    },
  };
}


// ---- Instructor activity summary (View Groups) ----

const SUMMARY_EVENT = 'activity_summary_ai';

function describe(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return {
    n: v.length,
    min: v[0],
    median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2,
    mean: v.reduce((sum, x) => sum + x, 0) / v.length,
    max: v[v.length - 1],
  };
}

const reached = (q) => q.enteredAt != null || q.attempts.length > 0 || q.outcome !== 'not_attempted';

// Per-question and per-group statistics for one activity in one course.
// Uses the research reconstruction (same rules as the statistics page);
// tests, sandbox runs, and groups with no students are excluded.
async function activitySummary(db, courseId, activityId) {
  const options = parseOptions({});
  const trace = await loadResearchTrace(db, { courseIds: [courseId], activityId });
  const runs = buildRuns(trace, options.reconstruct);
  const activity = trace.activities.get(activityId);
  const meta = activity?.meta || { questions: new Map(), sections: [], groups: [] };

  const questions = [...meta.questions.values()].map((mq) => {
    const perRun = runs
      .map((r) => r.rec.questions.find((q) => q.qid === mq.qid))
      .filter((q) => q && reached(q));
    const count = (pred) => perRun.filter(pred).length;
    return {
      qid: mq.qid,
      groupNum: mq.groupNum,
      sectionIndex: mq.sectionIndex,
      questionType: mq.questionType,
      hasCode: !!mq.hasCode,
      isSurvey: !!mq.isSurvey,
      reached: perRun.length,
      seconds: describe(perRun.map((q) => (q.durationMs == null ? null : q.durationMs / 1000))),
      submits: describe(perRun.map((q) => q.attempts.length)),
      firstTryAccepted: count((q) => q.firstDecision === 'accepted'),
      accepted: count((q) => q.outcome === 'ai_accepted'),
      continued: count((q) => q.outcome === 'continued'),
      instructorAdvanced: count((q) => q.outcome === 'instructor_advanced'),
      unresolved: count((q) => q.outcome === 'unresolved'),
    };
  });

  const groups = runs.map((r) => ({
    instanceId: r.instanceId,
    status: r.status,
    groupSize: r.groupSize,
    totalSeconds: r.rec.timing?.durationMs == null ? null : r.rec.timing.durationMs / 1000,
    questions: Object.fromEntries(r.rec.questions.filter(reached).map((q) => [q.qid, {
      seconds: q.durationMs == null ? null : q.durationMs / 1000,
      submits: q.attempts.length,
      outcome: q.outcome,
    }])),
  }));

  // Times an AI call for these groups ran out of output tokens (audit_log).
  let tokenLimits = [];
  if (runs.length) {
    const [rows] = await db.query(
      `SELECT details, COUNT(*) AS n, MAX(created_at) AS lastAt FROM audit_log
        WHERE event_type = 'ai_token_limit' AND activity_instance_id IN (?)
        GROUP BY details`,
      [runs.map((r) => r.instanceId)]
    );
    const bySetting = new Map();
    for (const row of rows) {
      let d = {};
      try { d = JSON.parse(row.details) || {}; } catch { d = {}; }
      const key = `${d.setting}|${d.where}`;
      const prev = bySetting.get(key) || { setting: d.setting || 'unknown', where: d.where || '', limit: d.limit ?? null, count: 0 };
      prev.count += Number(row.n) || 0;
      if (d.limit != null) prev.limit = Math.max(prev.limit ?? 0, d.limit);
      bySetting.set(key, prev);
    }
    tokenLimits = [...bySetting.values()];
  }

  return {
    generatedAt: new Date().toISOString(),
    activityTitle: activity ? (activity.title || activity.name) : null,
    tokenLimits,
    idleMinutes: options.idleMinutes,
    breakMinutes: options.breakMinutes,
    maxSessionMinutes: options.maxSessionMinutes,
    groupsWithAfterClassWork: runs.filter((r) => r.rec.inClass?.afterClassActivity).length,
    sections: meta.sections || [],
    plannedMinutes: meta.plannedMinutes ?? null,
    groupTotalSeconds: describe(groups.map((g) => g.totalSeconds)),
    questions,
    groups,
    excluded: trace.excluded,
    _runs: runs, // used by the AI summary; removed before sending
  };
}

async function savedActivityAiSummary(db, courseId, activityId) {
  const [[row]] = await db.query(
    `SELECT details, created_at AS createdAt FROM audit_log
      WHERE event_type = ? AND course_id = ? AND activity_id = ?
      ORDER BY id DESC LIMIT 1`,
    [SUMMARY_EVENT, courseId, activityId]
  );
  if (!row) return null;
  try {
    return JSON.parse(row.details);
  } catch {
    return null;
  }
}

const MAX_SOURCE_CHARS = 24000;
const FEEDBACK_SAMPLES = 6;

// AI review of the whole activity: where groups struggled and what could be
// improved. No student names or ids are sent. Saved as an audit_log event so
// it can be shown again without regenerating.
async function generateActivityAiSummary(db, req, courseId, activityId, requestJson) {
  const summary = await activitySummary(db, courseId, activityId);
  const runs = summary._runs;
  if (!runs.length) throw Object.assign(new Error('No student groups to summarize'), { status: 400 });

  const source = await loadActivitySourceById(db, activityId).catch(() => null);
  let sourceText = String(source?.text || '');
  if (sourceText.length > MAX_SOURCE_CHARS) sourceText = `${sourceText.slice(0, MAX_SOURCE_CHARS)}\n…(truncated)`;

  const round = (x) => (x == null ? null : Math.round(x));
  const stat = (d) => (d ? { min: round(d.min), median: round(d.median), mean: round(d.mean), max: round(d.max) } : null);
  const questionStats = summary.questions.map((q) => {
    const feedback = [];
    for (const r of runs) {
      const rq = r.rec.questions.find((x) => x.qid === q.qid);
      for (const a of rq?.attempts || []) {
        if (a.decision === 'rejected' && a.feedback && feedback.length < FEEDBACK_SAMPLES) {
          feedback.push(a.feedback.slice(0, 400));
        }
      }
    }
    return {
      question: q.qid,
      type: q.isSurvey ? 'survey' : q.questionType,
      hasCode: q.hasCode,
      groupsReached: q.reached,
      seconds: stat(q.seconds),
      submits: stat(q.submits),
      acceptedFirstTry: q.firstTryAccepted,
      acceptedEventually: q.accepted,
      skippedWithContinue: q.continued,
      advancedByInstructor: q.instructorAdvanced,
      unresolved: q.unresolved,
      sampleAiFeedbackOnRejectedAnswers: feedback,
    };
  });

  const data = {
    groups: runs.length,
    groupsCompleted: runs.filter((r) => r.status === 'completed').length,
    plannedMinutes: summary.plannedMinutes,
    sections: summary.sections,
    groupTotalMinutes: stat(summary.groupTotalSeconds && {
      min: summary.groupTotalSeconds.min / 60,
      median: summary.groupTotalSeconds.median / 60,
      mean: summary.groupTotalSeconds.mean / 60,
      max: summary.groupTotalSeconds.max / 60,
    }),
    questions: questionStats,
  };

  const messages = [
    {
      role: 'system',
      content: [
        'You help an instructor review how student groups did on a POGIL-style group activity.',
        'Groups answer questions; an AI checks each answer and either accepts it or sends it back with feedback.',
        'Groups may skip a question with a Continue button after enough attempts, or the instructor may advance them.',
        'Times are seconds of active in-class work (idle gaps are capped; work after class, after a long break or past the class length, is not counted). Submits are evaluated attempts per group.',
        'Base every claim on the statistics and feedback samples given. Name questions by id (e.g. 2a).',
        'Be concrete and brief. Suggest improvements to the activity (wording, hints, scaffolding, ordering, timing), not to the students.',
        'Return JSON: {"overview": string, "struggles": [{"question": string, "observation": string}],',
        '"improvements": [{"question": string|null, "suggestion": string}], "timing": string}.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Activity markup:',
        '```',
        sourceText || '(not available)',
        '```',
        '',
        'Statistics (JSON):',
        JSON.stringify(data),
      ].join('\n'),
    },
  ];

  const result = await requestJson(messages, envTokens('ACTIVITY_SUMMARY_TOKENS', 4000), {
    setting: 'ACTIVITY_SUMMARY_TOKENS',
    where: 'activity summary',
  });
  const saved = {
    generatedAt: new Date().toISOString(),
    groups: runs.length,
    overview: String(result?.overview || ''),
    struggles: Array.isArray(result?.struggles) ? result.struggles : [],
    improvements: Array.isArray(result?.improvements) ? result.improvements : [],
    timing: String(result?.timing || ''),
  };
  await recordAuditEvent(SUMMARY_EVENT, { req, courseId, activityId, details: saved });
  return saved;
}

module.exports = { ACTIVITY_TYPES, selectActivityTypes, parseActivityTypes, runStatus, activitySummary, savedActivityAiSummary, generateActivityAiSummary, computeForCourses, exportDataset, reconstructRun, buildRuns, applyFilters, parseOptions, courseLabel };
