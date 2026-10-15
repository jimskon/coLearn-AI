'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { extractActivityResearchMeta } = require('../../shared/activityResearchMeta.cjs');
const { reconstructInstance } = require('../research/reconstruct');
const { computeResearchMetrics } = require('../research/metrics');
const { applyFilters } = require('../research/service');
const { loadResearchTrace } = require('../research/trace');
const { MIN, T0, ACTIVITY, makeTrace } = require('./fixtures/researchTrace');

const META = extractActivityResearchMeta(ACTIVITY);

function makeRun(instanceId, studentIds, build) {
  const trace = makeTrace({ instanceId, startRowId: instanceId * 1000 });
  build(trace);
  const members = studentIds.map((studentId) => ({ studentId, isStudent: true }));
  return {
    instanceId,
    courseId: 10,
    activityId: 20,
    startAt: T0,
    groupSize: studentIds.length,
    studentIds: new Set(studentIds),
    rec: reconstructInstance({ instance: { id: instanceId, startAt: T0 }, members, rows: trace.rows, events: [], meta: META }),
  };
}

// Run A: 2 students, alternate; 1a rejected then accepted.
const runA = makeRun(1, [101, 102], (t) => {
  t.submit({ user: 101, at: 1, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision', '1b': 'ok', '1bFM': 'accepted' } });
  t.submit({ user: 102, at: 3, advanced: true, answers: { '1a': 'xy', '1aFM': 'accepted', '1bFM': 'accepted' } });
});
// Run B: 3 students, one does everything; both accepted first time.
const runB = makeRun(2, [201, 202, 203], (t) => {
  t.submit({ user: 201, at: 2, advanced: true, answers: { '1a': 'a', '1aFM': 'accepted', '1b': 'b', '1bFM': 'accepted' } });
});
// Run C: 4 students, each submits once; 1a rejected 3 times, then Continue.
const runC = makeRun(3, [301, 302, 303, 304], (t) => {
  t.submit({ user: 301, at: 1, advanced: false, sentBack: ['1a'], answers: { '1a': 'p', '1aFM': 'needsRevision', '1b': 'q', '1bFM': 'accepted' } });
  t.submit({ user: 302, at: 2, advanced: false, sentBack: ['1a'], answers: { '1a': 'pp', '1aFM': 'needsRevision', '1bFM': 'accepted' } });
  t.submit({ user: 303, at: 3, advanced: false, sentBack: ['1a'], answers: { '1a': 'ppp', '1aFM': 'needsRevision', '1bFM': 'accepted' } });
  t.submit({ user: 304, at: 4, advanced: true, forceOverride: true, answers: {} });
});

const RESULT = computeResearchMetrics([runA, runB, runC]);
const find = (list, key) => {
  const m = list.find((x) => x.key === key);
  assert.ok(m, `metric ${key} missing`);
  return m;
};
const S = RESULT.sections;

test('scale counts runs by group size', () => {
  assert.equal(find(S.scale, 'runs').value, 3);
  assert.deepEqual(find(S.scale, 'runs_by_group_size').values, { 2: 1, 3: 1, 4: 1, other: 0 });
  assert.equal(find(S.scale, 'students').value, 9);
  assert.equal(find(S.scale, 'group_submits').value, 7);
  assert.equal(find(S.scale, 'questions_answered').value, 6);
});

test('AI gating rates carry exact numerators and denominators', () => {
  const g = (k) => find(S.aiGating, k);
  assert.equal(g('evaluated_questions').value, 6);
  assert.deepEqual([g('first_attempt_acceptance_rate').numerator, g('first_attempt_acceptance_rate').denominator], [4, 6]);
  assert.deepEqual([g('first_attempt_rejection_rate').numerator, g('first_attempt_rejection_rate').denominator], [2, 6]);
  assert.equal(g('attempts_before_acceptance').n, 5);
  assert.equal(g('attempts_before_acceptance').mean, 1.2);
  assert.equal(g('attempts_before_acceptance').median, 1);
  assert.deepEqual([g('acceptance_after_1_revision').numerator, g('acceptance_after_1_revision').denominator], [1, 2]);
  assert.deepEqual([g('eventual_acceptance_after_initial_rejection').numerator, g('eventual_acceptance_after_initial_rejection').denominator], [1, 2]);
  assert.deepEqual([g('continue_button_rate').numerator, g('continue_button_rate').denominator], [1, 6]);
  assert.deepEqual([g('max_retries_reached_rate').numerator, g('max_retries_reached_rate').denominator], [1, 6]);
  assert.equal(g('instructor_override_rate').numerator, 0);
  assert.equal(g('outcome_unresolved').numerator, 0);
  assert.deepEqual([g('submits_held_back_by_ai').numerator, g('submits_held_back_by_ai').denominator], [4, 7]);
});

test('participation: balance 1 for even groups, 0 for one dominant member', () => {
  const p = (k) => find(S.participation, k);
  assert.equal(p('response_balance_0_1').n, 3);
  assert.equal(p('response_balance_0_1').median, 1);
  assert.ok(Math.abs(p('response_balance_0_1').mean - 2 / 3) < 1e-9);
  assert.equal(p('dominant_member_share').median, 0.5);
  assert.deepEqual([p('all_members_participated_rate').numerator, p('all_members_participated_rate').denominator], [2, 3]);
  // No turn events in these runs: turn metrics have no data rather than zeros.
  assert.equal(p('turn_balance_0_1').n, 0);
  assert.equal(p('skipped_turn_rate').denominator, 0);
  assert.equal(p('skipped_turn_rate').value, null);
});

test('revision rates', () => {
  const r = (k) => find(S.revision, k);
  assert.deepEqual([r('revised_at_least_once').numerator, r('revised_at_least_once').denominator], [2, 6]);
  assert.deepEqual([r('revised_multiple_times').numerator, r('revised_multiple_times').denominator], [1, 6]);
});

test('group-size breakdown keeps sizes 2, 3, 4 separate', () => {
  const bucket = (key) => RESULT.breakdowns.groupSize.find((b) => b.key === key);
  assert.equal(bucket('2').runs, 1);
  assert.equal(bucket('3').runs, 1);
  assert.equal(bucket('4').runs, 1);
  assert.equal(bucket('other').runs, 0);
  assert.equal(find(bucket('3').metrics, 'response_balance_0_1').median, 0);
  assert.equal(find(bucket('3').metrics, 'dominant_member_share').median, 1);
  assert.deepEqual(
    [find(bucket('4').metrics, 'continue_button_rate').numerator, find(bucket('4').metrics, 'continue_button_rate').denominator],
    [1, 2]
  );
});

test('question-type breakdown uses tags and keeps untagged questions as unknown', () => {
  const types = RESULT.breakdowns.questionType.map((b) => b.key);
  assert.deepEqual(types, ['conceptual_explanation', 'unknown']);
  const tagged = RESULT.breakdowns.questionType.find((b) => b.key === 'conceptual_explanation');
  assert.deepEqual(
    [find(tagged.metrics, 'first_attempt_rejection_rate').numerator, find(tagged.metrics, 'first_attempt_rejection_rate').denominator],
    [2, 3]
  );
});

test('filters: group size and question type', () => {
  assert.equal(applyFilters([runA, runB, runC], { groupSize: '3', questionType: 'all' }).length, 1);
  const typed = applyFilters([runA], { groupSize: 'all', questionType: 'unknown' });
  assert.deepEqual(typed[0].rec.questions.map((q) => q.qid), ['1b']);
});

// ---------------------------------------------------------------------------
// Exclusions, against a fake database
// ---------------------------------------------------------------------------
function fakeDb(tables) {
  return {
    async query(sql) {
      if (/FROM courses c/.test(sql)) return [tables.courses];
      if (/FROM activity_instances ai/.test(sql)) return [tables.instances];
      if (/FROM group_members gm/.test(sql)) return [tables.members];
      if (/FROM responses/.test(sql)) return [tables.responses];
      if (/FROM audit_log/.test(sql)) return [[]];
      if (/FROM group_activity_slices/.test(sql)) return [[]];
      if (/FROM pogil_activities/.test(sql)) return [tables.activities];
      if (/FROM users WHERE/.test(sql)) return [tables.users];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('trace exclusions are applied and counted', async () => {
  const start = new Date(T0);
  const trace = makeTrace({ instanceId: 1 });
  trace.submit({ user: 101, at: 1, advanced: true, answers: { '1a': 'x', '1aFM': 'accepted' } });
  const duplicate = { ...trace.rows[0], id: 999 };

  const db = fakeDb({
    courses: [
      { id: 10, name: 'CS1', demoMode: 0 },
      { id: 11, name: 'Demo', demoMode: 1 },
    ],
    instances: [
      { id: 1, courseId: 10, activityId: 20, startTime: start, sandboxOwnerId: null, isTest: 0 }, // kept
      { id: 2, courseId: 10, activityId: 20, startTime: start, sandboxOwnerId: null, isTest: 1 }, // test
      { id: 3, courseId: 10, activityId: 20, startTime: start, sandboxOwnerId: 7, isTest: 0 },    // sandbox
      { id: 4, courseId: 11, activityId: 20, startTime: start, sandboxOwnerId: null, isTest: 0 }, // demo class
      { id: 5, courseId: 10, activityId: 20, startTime: start, sandboxOwnerId: null, isTest: 0 }, // no students
    ],
    members: [
      { instanceId: 1, studentId: 101, role: null, userRole: 'student' },
      { instanceId: 5, studentId: 900, role: null, userRole: 'instructor' },
    ],
    responses: [...trace.rows, duplicate].map((r) => ({
      id: r.id, instanceId: 1, submitId: r.submitId, questionId: r.questionId,
      response: r.response, userId: r.userId, submittedAt: new Date(r.at),
    })),
    activities: [{ id: 20, name: 'fixture', title: 'Fixture', content_text: ACTIVITY, source_type: 'local' }],
    users: [{ id: 101, role: 'student' }],
  });

  const loaded = await loadResearchTrace(db, { courseIds: [10, 11] });
  assert.deepEqual(loaded.instances.map((i) => i.id), [1]);
  assert.deepEqual(loaded.excluded, {
    tests: 1, sandboxRuns: 1, demoClasses: 1, noStudentMembers: 1, outsideDateRange: 0, duplicateRows: 1,
  });
  assert.equal(loaded.activities.get(20).meta.questions.size, 2);
});

test('date range excludes runs that started outside it', async () => {
  const db = fakeDb({
    courses: [{ id: 10, name: 'CS1', demoMode: 0 }],
    instances: [{ id: 1, courseId: 10, activityId: 20, startTime: new Date(T0), sandboxOwnerId: null, isTest: 0 }],
    members: [], responses: [], activities: [], users: [],
  });
  const loaded = await loadResearchTrace(db, { courseIds: [10], from: new Date(T0 + 24 * 60 * MIN) });
  assert.equal(loaded.instances.length, 0);
  assert.equal(loaded.excluded.outsideDateRange, 1);
});
