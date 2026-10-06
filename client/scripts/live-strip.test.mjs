import assert from 'node:assert/strict';
import test from 'node:test';
import { computeStrip, formatClock, FLAG_ACTIVE, FLAG_SANDBOX } from '../src/utils/liveStrip.js';

const T0 = Date.UTC(2026, 9, 6, 13, 0, 0);
const MIN = 60000;

test('not started until the group has any activity', () => {
  assert.equal(computeStrip({ startAt: null }, T0).started, false);
});

test('scaled to planned time; adjacent slices merge; sandbox is its own color', () => {
  const strip = computeStrip({
    startAt: T0,
    plannedMinutes: 10,
    lastActivityAt: T0 + 20000,
    slices: [[T0, FLAG_ACTIVE], [T0 + 10000, FLAG_ACTIVE], [T0 + 30000, FLAG_SANDBOX]],
    submits: [[T0 + 5 * MIN, 'sent_back']],
    sections: [{ title: 'One', minutes: 10, enteredAt: T0 }],
  }, T0 + 2 * MIN);
  assert.deepEqual(strip.segments.map((s) => s.kind), ['active', 'sandbox']);
  // 20 s of activity on a 10-minute strip = 3.33%
  assert.ok(Math.abs(strip.segments[0].width - (20000 / (10 * MIN)) * 100) < 1e-9);
  assert.equal(strip.dots[0].left, 50);
  assert.equal(strip.plannedEndLeft, null);
  assert.equal(strip.idleMs, 100000);
  assert.deepEqual(strip.section, { title: 'One', minutes: 10, elapsedMs: 2 * MIN, overMs: 0 });
});

test('activity past the current section\'s minutes is "over"; strip compresses past planned time', () => {
  const strip = computeStrip({
    startAt: T0,
    plannedMinutes: 10,
    slices: [[T0 + 1 * MIN, FLAG_ACTIVE], [T0 + 12 * MIN, FLAG_ACTIVE]],
    sections: [{ title: 'One', minutes: 10, enteredAt: T0 }],
  }, T0 + 20 * MIN);
  assert.deepEqual(strip.segments.map((s) => s.kind), ['active', 'over']);
  assert.equal(strip.plannedEndLeft, 50); // 10 of 20 minutes
  assert.equal(strip.section.overMs, 10 * MIN);
});

test('clock format', () => {
  assert.equal(formatClock(52000), '0:52');
  assert.equal(formatClock(125000), '2:05');
  assert.equal(formatClock(3725000), '1h 02m');
  assert.equal(formatClock(null), '—');
});

test('observation tags are placed on the same scale', () => {
  const strip = computeStrip({
    startAt: T0, plannedMinutes: 10, slices: [[T0, FLAG_ACTIVE]], tags: [[T0 + 5 * MIN, 'talk']],
  }, T0 + 1 * MIN);
  assert.deepEqual(strip.tags, [{ left: 50, label: 'talk' }]);
});
