'use strict';
// In-class window: work after class (reopening the run later to review or
// change answers) is set aside, and no session counts past the longest class.
const assert = require('node:assert/strict');
const test = require('node:test');

const { extractActivityResearchMeta } = require('../../shared/activityResearchMeta.cjs');
const { reconstructInstance } = require('../research/reconstruct');
const { MIN, T0, ACTIVITY, makeTrace } = require('./fixtures/researchTrace');

const META = extractActivityResearchMeta(ACTIVITY);
const members = [101, 102].map((studentId) => ({ studentId, isStudent: true }));
const at = (min) => T0 + min * MIN;
const turn = (id, min, from, to, reason) => ({ id, type: 'active_student_changed', at: at(min), userId: from, details: { from, to, reason } });
const slicesEvery = (fromMin, toMin) => {
  const out = [];
  for (let m = fromMin; m <= toMin; m += 1) out.push(at(m));
  return out;
};
const rebuild = (t, events, slices, options) =>
  reconstructInstance({ instance: { id: 1 }, members, rows: t.rows, events, slices, meta: META, options });
const q1a = (r) => r.questions.find((q) => q.qid === '1a');

test('work after a break longer than 30 minutes is after class and set aside', () => {
  const t = makeTrace();
  t.submit({ user: 101, at: 20, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision', '1b': 'ok', '1bFM': 'accepted' } });
  // Back that evening: a revised answer is accepted.
  t.submit({ user: 102, at: 300, advanced: true, answers: { '1a': 'xy', '1aFM': 'accepted' } });
  const events = [turn(1, 0, null, 101, 'claimed'), turn(2, 20, 101, 102, 'rotation_after_submit'), turn(3, 295, null, 102, 'claimed')];
  const slices = [...slicesEvery(0, 25), ...slicesEvery(295, 300)];

  const r = rebuild(t, events, slices);
  assert.equal(r.inClass.endAt, at(25));
  assert.equal(r.inClass.endReason, 'break');
  assert.equal(r.inClass.afterClassSubmits, 1);
  assert.equal(r.inClass.afterClassActivity, true);
  assert.equal(r.submits.length, 1);
  assert.equal(r.timing.lastActivityAt, at(25));
  assert.equal(r.timing.durationMs, 25 * MIN);
  assert.equal(r.timing.wallClockMs, 25 * MIN);
  // In class, 1a was sent back and never accepted.
  assert.equal(q1a(r).outcome, 'unresolved');
  assert.equal(q1a(r).versions.length, 1);
  assert.equal(r.turns.length, 2);
});

test('a gap shorter than the break is still class time', () => {
  const t = makeTrace();
  t.submit({ user: 101, at: 5, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision', '1b': 'ok', '1bFM': 'accepted' } });
  t.submit({ user: 102, at: 30, advanced: true, answers: { '1a': 'xy', '1aFM': 'accepted' } });
  const events = [turn(1, 0, null, 101, 'claimed')];
  const r = rebuild(t, events, [...slicesEvery(0, 5), ...slicesEvery(28, 30)]);
  assert.equal(r.inClass.endAt, at(30));
  assert.equal(r.inClass.endReason, 'last_activity');
  assert.equal(r.inClass.afterClassSubmits, 0);
  assert.equal(r.inClass.afterClassActivity, false);
  assert.equal(q1a(r).outcome, 'ai_accepted');
});

test('continuous work never counts past one hour from the session start', () => {
  const t = makeTrace();
  t.submit({ user: 101, at: 20, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision', '1b': 'ok', '1bFM': 'accepted' } });
  t.submit({ user: 102, at: 75, advanced: true, answers: { '1a': 'xy', '1aFM': 'accepted' } });
  const events = [turn(1, 0, null, 101, 'claimed')];
  const r = rebuild(t, events, slicesEvery(0, 80));
  assert.equal(r.inClass.endReason, 'max_session');
  assert.equal(r.inClass.endAt, at(60));
  assert.equal(r.inClass.afterClassSubmits, 1);
  assert.equal(r.timing.durationMs, 60 * MIN);
  assert.equal(q1a(r).outcome, 'unresolved');
});

test('opening the activity before class, with no submit, does not start the session', () => {
  const t = makeTrace();
  t.submit({ user: 101, at: 130, advanced: true, answers: { '1a': 'x', '1aFM': 'accepted', '1b': 'ok', '1bFM': 'accepted' } });
  const events = [turn(1, 0, null, 101, 'claimed'), turn(2, 120, null, 101, 'claimed')];
  const r = rebuild(t, events, [...slicesEvery(0, 2), ...slicesEvery(120, 130)]);
  assert.equal(r.inClass.startMoved, true);
  assert.equal(r.timing.startAt, at(120));
  assert.equal(r.timing.durationMs, 10 * MIN);
  assert.equal(q1a(r).enteredAt, at(120));
  assert.equal(q1a(r).durationMs, 10 * MIN);
});

test('break and session length are options', () => {
  const t = makeTrace();
  t.submit({ user: 101, at: 20, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision', '1b': 'ok', '1bFM': 'accepted' } });
  t.submit({ user: 102, at: 60, advanced: true, answers: { '1a': 'xy', '1aFM': 'accepted' } });
  const events = [turn(1, 0, null, 101, 'claimed')];
  const slices = [...slicesEvery(0, 20), ...slicesEvery(55, 60)];
  assert.equal(rebuild(t, events, slices).inClass.afterClassSubmits, 1); // 35-minute gap > 30
  const wider = rebuild(t, events, slices, { sessionBreakMs: 45 * MIN, maxSessionMs: 90 * MIN });
  assert.equal(wider.inClass.afterClassSubmits, 0);
  assert.equal(q1a(wider).outcome, 'ai_accepted');
});
