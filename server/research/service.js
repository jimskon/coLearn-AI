'use strict';

// Glue: load the trace for allowed courses, reconstruct each run, apply the
// shared filters, and compute metrics. Shared by the API routes and exports.

const { loadResearchTrace } = require('./trace');
const { reconstructInstance, DEFAULT_OPTIONS } = require('./reconstruct');
const { computeResearchMetrics, sizeBucket } = require('./metrics');

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

module.exports = { computeForCourses, buildRuns, applyFilters, parseOptions, courseLabel };
