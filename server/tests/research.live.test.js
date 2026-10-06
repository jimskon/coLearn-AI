'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { extractActivityResearchMeta } = require('../../shared/activityResearchMeta.cjs');
const { buildLiveGroup, FLAG_ACTIVE, FLAG_SANDBOX, FLAG_AI_WAIT } = require('../research/live');
const { MIN, T0, makeTrace } = require('./fixtures/researchTrace');

const META = extractActivityResearchMeta([
  '\\section{One}{10}',
  '\\questiongroup{G1}', '\\question{a}', '\\endquestion', '\\endquestiongroup',
  '\\questiongroup{G2}', '\\question{b}', '\\endquestion', '\\endquestiongroup',
  '\\section{Two}{15}',
  '\\questiongroup{G3}', '\\question{c}', '\\endquestion', '\\endquestiongroup',
].join('\n'));

test('slices carry flags; idle timer starts after the last active slice', () => {
  const live = buildLiveGroup({
    meta: META,
    slices: [
      { at: T0, edits: 1 },
      { at: T0 + 10000, sandbox: 1 },
      { at: T0 + 20000, aiWaits: 1 },
      { at: T0 + 30000, sandbox: 1 }, // sandbox alone does not reset the idle timer
    ],
  });
  assert.deepEqual(live.slices.map(([, f]) => f), [FLAG_ACTIVE, FLAG_SANDBOX, FLAG_AI_WAIT, FLAG_SANDBOX]);
  assert.equal(live.startAt, T0);
  assert.equal(live.lastActivityAt, T0 + 30000); // end of the AI-wait slice
  assert.equal(live.plannedMinutes, 25);
});

test('sections are entered as the group advances through question groups', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 1, at: 4, advanced: true });
  t.submit({ group: 2, user: 2, at: 9, advanced: true }); // leaves section One
  const live = buildLiveGroup({ meta: META, rows: t.rows, slices: [{ at: T0, edits: 1 }] });
  assert.deepEqual(live.sections.map((s) => [s.title, s.minutes, s.enteredAt]), [
    ['One', 10, T0],
    ['Two', 15, T0 + 9 * MIN],
  ]);
  assert.deepEqual(live.submits.map(([, status]) => status), ['advanced', 'advanced']);
  assert.equal(live.groupsCompleted, 2);
});

test('an instructor force-advance also moves the group on', () => {
  const live = buildLiveGroup({
    meta: META,
    slices: [{ at: T0, edits: 1 }],
    events: [
      { type: 'instructor_force_advance', at: T0 + 3 * MIN, details: { groupNum: 1 } },
      { type: 'instructor_force_advance', at: T0 + 5 * MIN, details: { groupNum: 2 } },
    ],
  });
  assert.equal(live.sections[1].enteredAt, T0 + 5 * MIN);
});

test('observation tags are returned in time order', () => {
  const live = buildLiveGroup({
    meta: META,
    slices: [{ at: T0, edits: 1 }],
    observations: [{ at: T0 + 2 * MIN, label: 'quiet' }, { at: T0 + 1 * MIN, label: 'talk' }],
  });
  assert.deepEqual(live.tags, [[T0 + 1 * MIN, 'talk'], [T0 + 2 * MIN, 'quiet']]);
});
