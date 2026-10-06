'use strict';

// Aggregate research metrics computed from reconstructed runs
// (./reconstruct.js). Pure functions. Every metric carries its numerator and
// denominator (rates) or N (distributions) so results are auditable.
// Formal definitions: docs/research-statistics.md -- keep the keys in sync.

const { balanceIndex } = require('../stats/compute');

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------
function rate(numerator, denominator) {
  return {
    kind: 'rate',
    numerator,
    denominator,
    value: denominator ? numerator / denominator : null,
  };
}

function summary(values, unit = null) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  const mid = Math.floor(n / 2);
  return {
    kind: 'summary',
    unit,
    n,
    mean: n ? v.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (n % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2) : null,
    min: n ? v[0] : null,
    max: n ? v[n - 1] : null,
  };
}

function count(value) {
  return { kind: 'count', value };
}

const metric = (key, label, description, data) => ({ key, label, description, ...data });
const seconds = (ms) => (ms == null ? null : ms / 1000);

function sizeBucket(size) {
  return size >= 2 && size <= 4 ? String(size) : 'other';
}

// Questions that count for AI-gating statistics: not surveys, evaluated at least once.
const evaluatedQuestions = (questions) => questions.filter((q) => !q.isSurvey && q.attempts.length > 0);
const answeredQuestions = (questions) => questions.filter((q) => !q.isSurvey && q.versions.length > 0);

function allQuestions(runs) {
  return runs.flatMap((run) => run.rec.questions.map((q) => ({ ...q, run })));
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function scaleMetrics(runs, questions) {
  const students = new Set();
  for (const run of runs) for (const id of run.studentIds) students.add(id);
  const bySize = { 2: 0, 3: 0, 4: 0, other: 0 };
  for (const run of runs) bySize[sizeBucket(run.groupSize)] += 1;
  return [
    metric('runs', 'Group activity runs', 'Activity instances with at least one student member, after exclusions.', count(runs.length)),
    metric('courses', 'Courses', 'Distinct courses with at least one included run.', count(new Set(runs.map((r) => r.courseId)).size)),
    metric('activities', 'Distinct activities', 'Distinct activities with at least one included run.', count(new Set(runs.map((r) => r.activityId)).size)),
    metric('students', 'Students', 'Distinct student-role users who were members of an included run.', count(students.size)),
    metric('group_submits', 'Group submits', 'Submit clicks recorded as group submits.', count(runs.reduce((n, r) => n + r.rec.submits.length, 0))),
    metric('questions_answered', 'Questions answered', 'Question instances (question x run) with at least one submitted answer, excluding surveys.', count(answeredQuestions(questions).length)),
    metric('runs_by_group_size', 'Runs by group size', 'Student members per run: 2, 3, 4, or other.', { kind: 'distribution', values: bySize }),
  ];
}

function participationMetrics(runs) {
  // Submit-based: available for all history.
  const measured = runs.filter((r) => r.studentIds.size >= 2 && r.rec.submits.length > 0);
  const balances = [];
  const topShares = [];
  let allSubmitted = 0;
  for (const run of measured) {
    const counts = [...run.studentIds].map((id) => run.rec.participation.submitsByStudent.get(id) || 0);
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) continue;
    balances.push(balanceIndex(counts));
    topShares.push(Math.max(...counts) / total);
    if (counts.every((c) => c > 0)) allSubmitted += 1;
  }

  // Turn-based: only runs with recorded turn events (forward-only).
  const turnRuns = runs.filter((r) => r.rec.turnsRecorded && r.studentIds.size >= 2);
  const turnBalances = [];
  const closedTurns = [];
  const latencies = [];
  for (const run of turnRuns) {
    const studentTurns = run.rec.turns.filter((t) => t.isStudent && !t.transient);
    const counts = [...run.studentIds].map((id) => studentTurns.filter((t) => t.studentId === id).length);
    if (counts.some((c) => c > 0)) turnBalances.push(balanceIndex(counts));
    for (const t of studentTurns) {
      if (t.endAt != null) closedTurns.push(t);
      if (t.firstSubmitAt != null) latencies.push(t.firstSubmitAt - t.startAt);
    }
  }

  return [
    metric('response_balance_0_1', 'Submit balance (0-1)',
      'Normalized entropy of submits per student member: 1 = every member submitted equally often, 0 = one member submitted everything. Runs with 2+ student members and 1+ submit.',
      summary(balances.filter((b) => b != null))),
    metric('dominant_member_share', 'Share of submits by the most active member',
      'Per run, the most active member\'s submits / all submits; summarized across runs.',
      summary(topShares)),
    metric('all_members_participated_rate', 'Runs where every member submitted',
      'Runs in which every student member made at least one group submit.',
      rate(allSubmitted, balances.length)),
    metric('longest_submit_streak', 'Longest run of consecutive submits by one student',
      'Per run, the longest sequence of consecutive group submits by the same user.',
      summary(measured.map((r) => r.rec.participation.longestSubmitStreak))),
    metric('turn_balance_0_1', 'Turn balance (0-1)',
      'Normalized entropy of turns assigned per student member. Only runs with recorded turn events.',
      summary(turnBalances.filter((b) => b != null))),
    metric('skipped_turn_rate', 'Skipped turns',
      'Ended turns in which the holder never submitted and the turn was taken away (absence, everyone absent, instructor rotation, or another member claiming it).',
      rate(closedTurns.filter((t) => t.skipped).length, closedTurns.length)),
    metric('reassigned_turn_rate', 'Turns reassigned by the instructor',
      'Ended turns that ended because the instructor rotated the active student.',
      rate(closedTurns.filter((t) => t.reassignedByInstructor).length, closedTurns.length)),
    metric('turn_to_first_submit', 'Time from receiving the turn to first submit',
      'Seconds from a turn starting to its holder\'s first group submit, for turns with a submit. Uncapped.',
      summary(latencies.map(seconds), 'seconds')),
    metric('turn_instrumented_runs', 'Runs with full turn data',
      'Runs whose turn logging covers the whole run (first turn event no later than the first submit); turn, session-start, and intervention-rate metrics use only these runs.',
      rate(turnRuns.length, runs.filter((r) => r.studentIds.size >= 2).length)),
    metric('turn_partial_runs', 'Runs with partial turn data (set aside)',
      'Runs where turn logging began partway through (submits before the first turn event). Excluded from turn metrics; still included in submit-based metrics.',
      count(runs.filter((r) => r.rec.turnCoverage === 'partial').length)),
  ];
}

function gatingMetrics(questions, runs = null) {
  const evaluated = evaluatedQuestions(questions);
  const firstRejected = evaluated.filter((q) => q.firstDecision === 'rejected');
  const accepted = evaluated.filter((q) => q.attemptsToAcceptance != null);
  const outcome = (name) => evaluated.filter((q) => q.outcome === name).length;
  const acceptedAt = (n, atLeast = false) =>
    firstRejected.filter((q) => (atLeast ? q.attemptsToAcceptance >= n : q.attemptsToAcceptance === n)).length;

  const out = [
    metric('evaluated_questions', 'AI-evaluated questions',
      'Question instances (question x run) with at least one AI decision, excluding surveys.',
      count(evaluated.length)),
    metric('first_attempt_acceptance_rate', 'Accepted on the first attempt',
      'Evaluated questions whose first AI decision was acceptance.',
      rate(evaluated.filter((q) => q.firstDecision === 'accepted').length, evaluated.length)),
    metric('first_attempt_rejection_rate', 'Sent back on the first attempt',
      'Evaluated questions whose first AI decision was a rejection.',
      rate(firstRejected.length, evaluated.length)),
    metric('attempts_before_acceptance', 'Attempts to acceptance',
      'For questions the AI eventually accepted, the number of evaluated attempts including the accepted one.',
      summary(accepted.map((q) => q.attemptsToAcceptance), 'attempts')),
    metric('acceptance_after_1_revision', 'Accepted on the 2nd attempt',
      'Of questions sent back on the first attempt, those accepted on attempt 2.',
      rate(acceptedAt(2), firstRejected.length)),
    metric('acceptance_after_2_revisions', 'Accepted on the 3rd attempt',
      'Of questions sent back on the first attempt, those accepted on attempt 3.',
      rate(acceptedAt(3), firstRejected.length)),
    metric('acceptance_after_3_or_more_revisions', 'Accepted on the 4th attempt or later',
      'Of questions sent back on the first attempt, those accepted on attempt 4 or later.',
      rate(acceptedAt(4, true), firstRejected.length)),
    metric('eventual_acceptance_after_initial_rejection', 'Eventually accepted after a first rejection',
      'Of questions sent back on the first attempt, those the AI later accepted.',
      rate(firstRejected.filter((q) => q.outcome === 'ai_accepted').length, firstRejected.length)),
    metric('max_retries_reached_rate', 'Retry allowance used up',
      'Evaluated questions with at least as many rejections as the question group\'s retry allowance (allowance is per question group).',
      rate(evaluated.filter((q) => q.maxRetriesReached).length, evaluated.length)),
    metric('outcome_ai_accepted', 'Outcome: AI accepted', 'Evaluated questions the AI accepted.', rate(outcome('ai_accepted'), evaluated.length)),
    metric('continue_button_rate', 'Outcome: Continue after retries', 'Evaluated questions left via the Continue button without AI acceptance.', rate(outcome('continued'), evaluated.length)),
    metric('instructor_override_rate', 'Outcome: instructor advanced', 'Evaluated questions left because the instructor force-advanced the group (instructor action, not a student or AI outcome).', rate(outcome('instructor_advanced'), evaluated.length)),
    metric('outcome_advanced_other', 'Outcome: advanced another way', 'Evaluated questions whose group advanced without AI acceptance, Continue, or instructor advance.', rate(outcome('advanced_other'), evaluated.length)),
    metric('outcome_unresolved', 'Outcome: unresolved', 'Evaluated questions never accepted or advanced past (activity or session ended first).', rate(outcome('unresolved'), evaluated.length)),
    metric('abandoned_after_rejection_rate', 'Unresolved after a rejection',
      'Of evaluated questions with at least one rejection, those left unresolved.',
      rate(
        evaluated.filter((q) => q.outcome === 'unresolved' && q.rejectedAttempts > 0).length,
        evaluated.filter((q) => q.rejectedAttempts > 0).length
      )),
  ];

  if (runs) {
    const submits = runs.flatMap((r) => r.rec.submits);
    out.push(metric('submits_held_back_by_ai', 'Group submits held back by the AI',
      'Group submits that did not advance because the AI sent back at least one question.',
      rate(submits.filter((s) => !s.advanced && s.sentBack.length > 0).length, submits.length)));
  }
  return out;
}

function revisionMetrics(questions) {
  const answered = answeredQuestions(questions);
  const revisions = answered.flatMap((q) => q.revisions.map((r) => ({ ...r, hasCode: q.hasCode })));
  const withOutput = revisions.filter((r) => r.outputChanged != null);
  const code = revisions.filter((r) => r.hasCode);
  return [
    metric('versions_per_question', 'Versions per question', 'Submitted versions of each answered question (text and code).', summary(answered.map((q) => q.versions.length), 'versions')),
    metric('revisions_per_question', 'Revisions per question', 'Versions minus one, per answered question.', summary(answered.map((q) => q.versions.length - 1), 'revisions')),
    metric('revised_at_least_once', 'Revised at least once', 'Answered questions with 2+ versions.', rate(answered.filter((q) => q.versions.length >= 2).length, answered.length)),
    metric('revised_multiple_times', 'Revised two or more times', 'Answered questions with 3+ versions.', rate(answered.filter((q) => q.versions.length >= 3).length, answered.length)),
    metric('revision_normalized_edit_distance', 'Size of a revision (normalized edit distance)', 'Per revision: character edit distance / length of the longer version, 0-1. Size only, not quality.', summary(revisions.map((r) => r.normalizedEditDistance))),
    metric('revision_char_delta', 'Change in answer length per revision', 'Characters after minus characters before.', summary(revisions.map((r) => r.charDelta), 'characters')),
    metric('revision_code_lines_changed', 'Code lines changed per revision', 'Lines added + removed, code questions only.', summary(code.map((r) => r.linesAdded + r.linesRemoved), 'lines')),
    metric('revision_output_changed', 'Revisions that changed program output', 'Revisions where output was recorded before and after.', rate(withOutput.filter((r) => r.outputChanged).length, withOutput.length)),
  ];
}

function timeMetrics(runs, questions) {
  const evaluated = evaluatedQuestions(questions);
  const resolved = evaluated.filter((q) => q.durationMs != null);
  const firstAccepted = resolved.filter((q) => q.firstDecision === 'accepted');
  const firstRejected = resolved.filter((q) => q.firstDecision === 'rejected');
  const gaps = evaluated.flatMap((q) => q.attemptGaps);
  const durationSummary = (list) => summary(list.map((q) => seconds(q.durationMs)), 'seconds');
  const firstAcceptedMedian = durationSummary(firstAccepted).median;
  const firstRejectedMedian = durationSummary(firstRejected).median;

  return [
    metric('activity_duration', 'Activity duration (active time)', 'Per run with turn data, session start (first student taking the turn) to last activity, with idle gaps capped at the idle threshold.', summary(runs.filter((r) => r.rec.timing.startKnown).map((r) => seconds(r.rec.timing.durationMs)), 'seconds')),
    metric('activity_wall_clock', 'Activity duration (wall clock)', 'Per run with turn data, session start to last activity, uncapped.', summary(runs.filter((r) => r.rec.timing.startKnown).map((r) => seconds(r.rec.timing.wallClockMs)), 'seconds')),
    metric('activity_submit_span', 'First to last submit (all runs)', 'Per run, first group submit to last group submit, idle-capped. Available for runs before turn logging; misses time before the first submit.', summary(runs.map((r) => seconds(r.rec.timing.submitSpanMs)), 'seconds')),
    metric('question_duration', 'Question duration', 'From the question group becoming current to resolution (acceptance or advance), idle-capped. Resolved evaluated questions.', durationSummary(resolved)),
    metric('time_to_first_response', 'Time to first answer', 'From the question group becoming current to the first evaluated attempt, idle-capped.', summary(evaluated.map((q) => seconds(q.firstResponseMs)), 'seconds')),
    metric('time_between_attempts', 'Time between attempts', 'Between consecutive evaluated attempts on a question, each capped at the idle threshold.', summary(gaps.map((g) => seconds(g.ms)), 'seconds')),
    metric('rejection_to_revision_time', 'Time from rejection to next attempt', 'Gaps that follow a rejection, capped at the idle threshold.', summary(gaps.filter((g) => g.afterDecision === 'rejected').map((g) => seconds(g.ms)), 'seconds')),
    metric('duration_first_accepted', 'Question duration: accepted on first attempt', 'Question duration for resolved questions accepted on the first attempt.', durationSummary(firstAccepted)),
    metric('duration_first_rejected', 'Question duration: sent back first', 'Question duration for resolved questions rejected on the first attempt.', durationSummary(firstRejected)),
    metric('gating_time_difference', 'Median duration difference (sent back first minus accepted first)',
      'Descriptive difference between the two medians above. Not a causal estimate: questions that are sent back may also be harder.',
      { kind: 'value', unit: 'seconds', value: firstAcceptedMedian != null && firstRejectedMedian != null ? firstRejectedMedian - firstAcceptedMedian : null }),
  ];
}

function interventionMetrics(runs) {
  const instrumented = runs.filter((r) => r.rec.turnsRecorded);
  const interventions = instrumented.flatMap((r) => r.rec.interventions);
  const evaluated = evaluatedQuestions(allQuestions(instrumented));
  const progressed = evaluated.filter((q) => q.outcome !== 'unresolved');
  return [
    metric('interventions_total', 'Instructor interventions', 'Force-advances plus instructor rotations (rotations under 10 s apart count once). Runs with recorded events only.', count(interventions.length)),
    metric('interventions_force_advance', 'Force-advances', 'Instructor pushed the group past a question group.', count(interventions.filter((i) => i.type === 'force_advance').length)),
    metric('interventions_rotate', 'Active-student changes by the instructor', 'Bursts of instructor rotations.', count(interventions.filter((i) => i.type === 'rotate_active').length)),
    metric('interventions_per_run', 'Interventions per run', 'Per instrumented run.', summary(instrumented.map((r) => r.rec.interventions.length))),
    metric('runs_with_intervention', 'Runs with at least one intervention', 'Instrumented runs.', rate(instrumented.filter((r) => r.rec.interventions.length > 0).length, instrumented.length)),
    metric('interventions_after_inactivity', 'Interventions after inactivity', 'No submit or turn change for at least 3 minutes before the intervention.', rate(interventions.filter((i) => i.afterInactivity).length, interventions.length)),
    metric('interventions_after_rejections', 'Interventions after repeated rejections', 'At least 2 consecutive sent-back submits for the current question group just before.', rate(interventions.filter((i) => i.afterRepeatedRejections).length, interventions.length)),
    metric('progressions_by_instructor', 'Question progressions caused by the instructor', 'Evaluated questions left by instructor force-advance / evaluated questions that were resolved, instrumented runs.', rate(progressed.filter((q) => q.outcome === 'instructor_advanced').length, progressed.length)),
  ];
}

// Compact set used for group-size, question-type, and over-time breakdowns.
function coreMetrics(runs, questions) {
  const pick = (list, keys) => list.filter((m) => keys.includes(m.key));
  return [
    ...pick(participationMetrics(runs), ['response_balance_0_1', 'dominant_member_share']),
    ...pick(gatingMetrics(questions), ['evaluated_questions', 'first_attempt_acceptance_rate', 'first_attempt_rejection_rate', 'attempts_before_acceptance', 'continue_button_rate']),
    ...pick(revisionMetrics(questions), ['revised_at_least_once', 'revisions_per_question']),
    ...pick(timeMetrics(runs, questions), ['activity_duration', 'question_duration']),
  ];
}

function isoWeekStart(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function breakdowns(runs, questions, { courseLabels = new Map(), activityTitles = new Map() } = {}) {
  const groupSize = ['2', '3', '4', 'other'].map((bucket) => {
    const subset = runs.filter((r) => sizeBucket(r.groupSize) === bucket);
    return { key: bucket, label: bucket === 'other' ? 'Other sizes' : `${bucket} students`, runs: subset.length, metrics: coreMetrics(subset, allQuestions(subset)) };
  });

  const types = [...new Set(questions.map((q) => q.questionType))].sort();
  const questionType = types.map((type) => {
    const subset = questions.filter((q) => q.questionType === type);
    return {
      key: type,
      label: type,
      questions: answeredQuestions(subset).length,
      metrics: [
        ...gatingMetrics(subset).filter((m) => ['evaluated_questions', 'first_attempt_rejection_rate', 'attempts_before_acceptance', 'continue_button_rate'].includes(m.key)),
        ...revisionMetrics(subset).filter((m) => ['revised_at_least_once', 'revisions_per_question'].includes(m.key)),
        ...timeMetrics([], subset).filter((m) => m.key === 'question_duration'),
      ],
    };
  });

  const byKey = (keyOf, labelOf) => {
    const groups = new Map();
    for (const run of runs) {
      const key = keyOf(run);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(run);
    }
    return [...groups.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
      .map(([key, subset]) => ({ key, label: labelOf(key, subset), runs: subset.length, metrics: coreMetrics(subset, allQuestions(subset)) }));
  };

  // Activity order within each course, by the date of its first run.
  const firstRun = new Map();
  for (const run of runs) {
    const k = `${run.courseId}|${run.activityId}`;
    firstRun.set(k, Math.min(firstRun.get(k) ?? Infinity, run.startAt ?? Infinity));
  }
  const sequence = new Map();
  const perCourse = new Map();
  for (const [k, at] of [...firstRun.entries()].sort((a, b) => a[1] - b[1])) {
    const course = k.split('|')[0];
    const n = (perCourse.get(course) || 0) + 1;
    perCourse.set(course, n);
    sequence.set(k, n);
  }

  return {
    groupSize,
    questionType,
    overTime: {
      week: byKey((r) => (r.startAt != null ? isoWeekStart(r.startAt) : 'unknown'), (key) => `Week of ${key}`),
      activity: byKey(
        (r) => `${String(r.courseId).padStart(8, '0')}|${String(sequence.get(`${r.courseId}|${r.activityId}`)).padStart(3, '0')}`,
        (key, subset) => `${courseLabels.get(subset[0].courseId) || `Course ${subset[0].courseId}`} · #${Number(key.split('|')[1])} ${activityTitles.get(subset[0].activityId) || ''}`.trim()
      ),
      course: byKey((r) => r.courseId, (key) => courseLabels.get(key) || `Course ${key}`),
    },
  };
}

/**
 * @param {Array} runs  [{ instanceId, courseId, activityId, startAt, groupSize, studentIds:Set, rec }]
 */
function computeResearchMetrics(runs, { excluded = {}, courseLabels, activityTitles } = {}) {
  const questions = allQuestions(runs);
  return {
    sections: {
      scale: scaleMetrics(runs, questions),
      participation: participationMetrics(runs),
      aiGating: gatingMetrics(questions, runs),
      revision: revisionMetrics(questions),
      time: timeMetrics(runs, questions),
      interventions: interventionMetrics(runs),
    },
    breakdowns: breakdowns(runs, questions, { courseLabels, activityTitles }),
    excluded,
  };
}

module.exports = { computeResearchMetrics, rate, summary, sizeBucket, isoWeekStart };
