'use strict';
// Research studies select runs by activity type (the authored \mode).
const assert = require('node:assert/strict');
const test = require('node:test');

const { inferAuthoredModeFromLines } = require('../utils/activityType');
const { selectActivityTypes, parseActivityTypes, parseOptions } = require('../research/service');

const trace = () => ({
  instances: [{ id: 1, activityId: 10 }, { id: 2, activityId: 20 }, { id: 3, activityId: 30 }, { id: 4, activityId: 10 }],
  activities: new Map([
    [10, { id: 10, activityType: 'group' }],
    [20, { id: 20, activityType: 'assignment' }],
    [30, { id: 30, activityType: 'demo' }],
  ]),
  excluded: { tests: 0 },
});

test('activity type comes from \\mode, defaulting to group', () => {
  assert.equal(inferAuthoredModeFromLines(['\\title{X}']), 'group');
  assert.equal(inferAuthoredModeFromLines(['\\mode{assignment}']), 'assignment');
  assert.equal(inferAuthoredModeFromLines(['\\mode{practice}']), 'practice');
  assert.equal(inferAuthoredModeFromLines(['\\mode{demo}']), 'demo');
});

test('only group activities are included by default; the rest are counted', () => {
  const out = selectActivityTypes(trace(), parseOptions({}).activityTypes);
  assert.deepEqual(out.instances.map((i) => i.id), [1, 4]);
  assert.equal(out.excluded.activityTypeNotSelected, 2);
  assert.deepEqual(out.runsByActivityType, { group: 2, assignment: 1, demo: 1 });
});

test('checked types are included', () => {
  const out = selectActivityTypes(trace(), parseActivityTypes(['group', 'demo']));
  assert.deepEqual(out.instances.map((i) => i.id), [1, 3, 4]);
  assert.equal(out.excluded.activityTypeNotSelected, 1);
});

test('unknown or empty selections fall back to group; tests cannot be selected', () => {
  assert.deepEqual(parseActivityTypes([]), ['group']);
  assert.deepEqual(parseActivityTypes('test,bogus'), ['group']);
  assert.deepEqual(parseActivityTypes('assignment,Group'), ['group', 'assignment']);
});
