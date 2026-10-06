'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { extractActivityResearchMeta } = require('../../shared/activityResearchMeta.cjs');
const { reconstructInstance } = require('../research/reconstruct');
const { buildDataset, toCsv, DATASETS } = require('../research/exports');
const { pseudonym } = require('../research/pseudonym');
const { MIN, T0, ACTIVITY, makeTrace } = require('./fixtures/researchTrace');

const META = extractActivityResearchMeta(ACTIVITY);
const SECRET = 'test-secret-0123456789';

function makeRun(instanceId, studentIds, build, events = []) {
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
    rec: reconstructInstance({ instance: { id: instanceId, startAt: T0 }, members, rows: trace.rows, events, meta: META }),
  };
}

// 101 submits 1a ("x"), sent back with feedback; 102 revises to "xy", accepted.
const turnEvents = [
  { id: 1, type: 'active_student_changed', at: T0, userId: 101, details: { from: null, to: 101, reason: 'claimed' } },
  { id: 2, type: 'active_student_changed', at: T0 + 1 * MIN, userId: 101, details: { from: 101, to: 102, reason: 'rotation_after_submit' } },
  { id: 3, type: 'active_student_changed', at: T0 + 3 * MIN, userId: 102, details: { from: 102, to: 101, reason: 'rotation_after_submit' } },
];
const runA = makeRun(1, [101, 102], (t) => {
  t.submit({ user: 101, at: 1, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision', '1aF1': 'Say more, "why"?', '1b': 'ok', '1bFM': 'accepted' } });
  t.submit({ user: 102, at: 3, advanced: true, answers: { '1a': 'xy', '1aFM': 'accepted' } });
}, turnEvents);

const ctx = {
  courseLabels: new Map([[10, 'COMP 118 · Fall 2026']]),
  activityTitles: new Map([[20, 'Fixture']]),
  pseudonym: (kind, id) => pseudonym(kind, id, SECRET),
};

test('no dataset contains raw user or run IDs', () => {
  for (const dataset of DATASETS) {
    const csv = toCsv(buildDataset(dataset, [runA], ctx));
    assert.doesNotMatch(csv, /\b10[12]\b/, dataset);
    assert.match(csv, /G-[0-9a-f]{12}/, dataset);
  }
});

test('question_attempts: one row per evaluated attempt, in order', () => {
  const rows = buildDataset('question_attempts', [runA], ctx);
  const a = rows.filter((r) => r.qid === '1a');
  assert.deepEqual(a.map((r) => [r.attempt_number, r.decision]), [[1, 'rejected'], [2, 'accepted']]);
  assert.equal(a[0].submitted_by, pseudonym('student', 101, SECRET));
  assert.equal(a[1].seconds_since_previous_attempt, 120);
  assert.equal(a[0].question_type, 'conceptual_explanation');
  assert.equal(a[1].question_outcome, 'ai_accepted');
  assert.equal(rows.filter((r) => r.qid === '1b').length, 1);
});

test('feedback_revision_pairs: answer before, feedback, answer after, next decision', () => {
  const [row] = buildDataset('feedback_revision_pairs', [runA], ctx);
  assert.equal(row.answer_before, 'x');
  assert.equal(row.feedback, 'Say more, "why"?');
  assert.equal(row.answer_after, 'xy');
  assert.equal(row.revised, 1);
  assert.equal(row.revised_by, pseudonym('student', 102, SECRET));
  assert.equal(row.next_decision, 'accepted');
  assert.equal(row.edit_distance, 1);
  // Quotes and commas survive CSV quoting.
  assert.match(toCsv([row]), /"Say more, ""why""\?"/);
});

test('group_participation: one row per run', () => {
  const [row] = buildDataset('group_participation', [runA], ctx);
  assert.equal(row.submits, 2);
  assert.equal(row.members_who_submitted, 2);
  assert.equal(row.submit_balance_0_1, 1);
  assert.equal(row.turn_coverage, 'full');
  assert.equal(row.turns, 3);
  assert.equal(row.outcome_ai_accepted, 2);
  assert.equal(row.rejected_attempts, 1);
  assert.equal(row.activity_seq, 1);
});

test('student_longitudinal: one row per student per run', () => {
  const rows = buildDataset('student_longitudinal', [runA], ctx);
  assert.equal(rows.length, 2);
  const s101 = rows.find((r) => r.student_id === pseudonym('student', 101, SECRET));
  assert.equal(s101.submits, 1);
  assert.equal(s101.share_of_group_submits, 0.5);
  assert.equal(s101.attempts_rejected, 1);
  assert.equal(s101.first_attempts_accepted, 1); // 1b
  assert.equal(s101.turns, 2);
});

test('unknown dataset is rejected', () => {
  assert.throws(() => buildDataset('names', [runA], ctx), /Unknown dataset/);
});
