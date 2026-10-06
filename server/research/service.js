'use strict';

// Glue: load the trace for allowed courses, reconstruct each run, apply the
// shared filters, and compute metrics. Shared by the API routes and exports.

const { loadResearchTrace } = require('./trace');
const { reconstructInstance, DEFAULT_OPTIONS } = require('./reconstruct');
const { computeResearchMetrics, sizeBucket } = require('./metrics');
const { buildDataset, toCsv } = require('./exports');
const { pseudonym, researchSecret } = require('./pseudonym');

const MIN_IDLE_MINUTES = 1;
const MAX_IDLE_MINUTES = 120;

function parseOptions(params = {}) {
  const idle = Number(params.idleMinutes);
  const idleMinutes = Number.isFinite(idle)
    ? Math.min(MAX_IDLE_MINUTES, Math.max(MIN_IDLE_MINUTES, idle))
    : DEFAULT_OPTIONS.idleThresholdMs / 60000;
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
    groupSize: ['2', '3', '4', 'other'].includes(String(params.groupSize)) ? String(params.groupSize) : 'all',
    questionType: params.questionType ? String(params.questionType) : 'all',
    reconstruct: { idleThresholdMs: idleMinutes * 60000 },
    idleMinutes,
  };
}

/** Reconstruct every included run in a loaded trace. */
function buildRuns(trace, reconstructOptions = {}) {
  const runs = [];
  for (const instance of trace.instances) {
    const activity = trace.activities.get(instance.activityId);
    const members = trace.membersByInstance.get(instance.id) || [];
    const studentIds = new Set(members.filter((m) => m.isStudent).map((m) => m.studentId));
    const rec = reconstructInstance({
      instance: { id: instance.id, startAt: instance.startAt },
      members,
      rows: trace.rowsByInstance.get(instance.id) || [],
      events: trace.eventsByInstance.get(instance.id) || [],
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
  const trace = await loadResearchTrace(db, { courseIds, from: options.from, to: options.to });
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
      groupSize: options.groupSize,
      questionType: options.questionType,
      idleMinutes: options.idleMinutes,
    },
    activitiesWithoutMetadata: metadataMissing,
    ...computeResearchMetrics(runs, { excluded: trace.excluded, courseLabels, activityTitles }),
  };
}

// One row-level research dataset as CSV text, for the same selection as
// computeForCourses. Throws if RESEARCH_ID_SECRET is not set.
async function exportDataset(db, courseIds, dataset, params = {}) {
  const secret = researchSecret();
  const options = parseOptions(params);
  const trace = await loadResearchTrace(db, { courseIds, from: options.from, to: options.to });
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
    groupSize: run.groupSize,
    studentIds: [...run.studentIds],
    turnCoverage: rec.turnCoverage,
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
    turns: rec.turns.map((t) => ({ ...t, startAt: iso(t.startAt), endAt: iso(t.endAt), firstSubmitAt: iso(t.firstSubmitAt) })),
    interventions: rec.interventions.map((i) => ({ ...i, at: iso(i.at) })),
    participation: {
      submitsByStudent: Object.fromEntries(rec.participation.submitsByStudent),
      longestSubmitStreak: rec.participation.longestSubmitStreak,
    },
  };
}

module.exports = { computeForCourses, exportDataset, reconstructRun, buildRuns, applyFilters, parseOptions, courseLabel };
