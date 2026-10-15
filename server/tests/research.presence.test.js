'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { extractActivityResearchMeta } = require('../../shared/activityResearchMeta.cjs');
const { reconstructInstance } = require('../research/reconstruct');
const { awayIntervals, mergeIntervals } = require('../research/presence');
const { MIN, T0, ACTIVITY, makeTrace } = require('./fixtures/researchTrace');

const META = extractActivityResearchMeta(ACTIVITY);
const DAY = 24 * 60 * MIN;
const STUDENTS = new Set([101, 102]);
const members = [...STUDENTS].map((studentId) => ({ studentId, isStudent: true }));
const at = (min) => T0 + min * MIN;
const joined = (id, user, min, lastSeenMin = null) => ({
  id, type: 'member_joined', at: at(min), userId: user,
  details: { lastSeenAt: lastSeenMin == null ? null : new Date(at(lastSeenMin)).toISOString() },
});
const left = (id, user, min) => ({ id, type: 'member_left', at: at(min), userId: user, details: null });
const turn = (id, min, from, to, reason) => ({ id, type: 'active_student_changed', at: at(min), userId: from, details: { from, to, reason } });
const slicesEvery = (fromMin, toMin, stepMin = 1) => {
  const out = [];
  for (let m = fromMin; m <= toMin; m += stepMin) out.push(at(m));
  return out;
};

test('mergeIntervals joins overlaps and keeps open ends', () => {
  assert.deepEqual(mergeIntervals([[5, 10], [1, 3], [8, 12], [20, null], [25, 30]]), [[1, 3], [5, 12], [20, null]]);
});

test('away: from the last leave beacon (or last heartbeat) to the next arrival, only when everyone is gone', () => {
  const events = [
    joined(1, 101, 0), joined(2, 102, 1),
    left(3, 101, 20),                 // 101 leaves; 102 still here
    left(4, 102, 25),                 // everyone gone at 25
    joined(5, 102, DAY / MIN, 23.25), // 102 back next day (beacon backdated the heartbeat)
    joined(6, 101, DAY / MIN + 3, 30),// 101 crashed earlier? lastSeen after the beacon is ignored
  ];
  const away = awayIntervals(events, STUDENTS, at(2));
  assert.deepEqual(away.slice(1), [[at(25), at(DAY / MIN)]]);
});

test('away: a reload (leave beacon, then a heartbeat seconds later) is a few seconds, not a departure', () => {
  const events = [joined(1, 101, 0), left(2, 101, 10), joined(3, 101, 10.05, 8.25)];
  const away = awayIntervals(events, new Set([101]), at(1));
  assert.deepEqual(away.slice(1), [[at(10), at(10.05)]]);
});

test('away: no arrival data covering the start of the run means nothing is removed', () => {
  assert.deepEqual(awayIntervals([], STUDENTS, at(1)), []);
  // First arrival logged after work had already started (deployed mid-run).
  assert.deepEqual(awayIntervals([joined(1, 101, 30, 29)], STUDENTS, at(1)), []);
});

function unfinishedThenReturn({ withPresence }) {
  const t = makeTrace({ instanceId: 1 });
  t.submit({ user: 101, at: 20, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision', '1b': 'ok', '1bFM': 'accepted' } });
  t.submit({ user: 102, at: DAY / MIN + 5, advanced: true, answers: { '1a': 'xy', '1aFM': 'accepted' } });
  const events = [
    turn(1, 0, null, 101, 'claimed'),
    turn(2, 20, 101, 102, 'rotation_after_submit'),
    turn(3, 60, 102, null, 'all_absent'),            // noticed by the instructor's page 35 min after they left
    turn(4, DAY / MIN, null, 102, 'claimed'),
  ];
  if (withPresence) {
    events.push(joined(10, 101, 0), joined(11, 102, 0.5), left(12, 101, 24), left(13, 102, 25), joined(14, 102, DAY / MIN, 23.25));
  }
  // Working continuously 0-25 min, then 1-5 min after returning.
  const slices = [...slicesEvery(0, 25), ...slicesEvery(DAY / MIN, DAY / MIN + 5)];
  return reconstructInstance({ instance: { id: 1 }, members, rows: t.rows, events, slices, meta: META });
}

test('time away from an unfinished activity is not counted', () => {
  const r = unfinishedThenReturn({ withPresence: true });
  assert.equal(r.timing.durationMs, 30 * MIN);   // 25 min, then 5 min the next day
  assert.equal(r.timing.wallClockMs, 30 * MIN);
  assert.equal(r.questions.find((q) => q.qid === '1a').durationMs, 30 * MIN);
});

test('without arrival data, the all-absent notice is not activity and the gap counts at most the idle cap', () => {
  const r = unfinishedThenReturn({ withPresence: false });
  // 25 min of work + at most 10 min (idle cap) for the overnight gap + 5 min.
  assert.equal(r.timing.durationMs, 40 * MIN);
  assert.deepEqual(r.away, []);
});

test('an unfinished run with no return ends at the last real activity, not when absence was noticed', () => {
  const t = makeTrace({ instanceId: 2 });
  t.submit({ user: 101, at: 20, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision' } });
  const events = [turn(1, 0, null, 101, 'claimed'), turn(2, 90, 101, null, 'all_absent')];
  const r = reconstructInstance({ instance: { id: 2 }, members, rows: t.rows, events, slices: slicesEvery(0, 25), meta: META });
  assert.equal(r.timing.lastActivityAt, at(25));
  assert.equal(r.timing.durationMs, 25 * MIN);
});

test('activity after a run ended (Local Sandbox play while reviewing) is not counted', () => {
  const t = makeTrace({ instanceId: 3 });
  t.submit({ user: 101, at: 10, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision' } });
  const endedAt = at(40); // everyone left at ~25; ended 15 min later
  const slices = [...slicesEvery(0, 25), ...slicesEvery(DAY / MIN, DAY / MIN + 20)];
  const events = [turn(1, 0, null, 101, 'claimed')];
  const r = reconstructInstance({ instance: { id: 3, endedAt }, members, rows: t.rows, events, slices, meta: META });
  assert.equal(r.timing.lastActivityAt, at(25));
  assert.equal(r.timing.durationMs, 25 * MIN);
});
