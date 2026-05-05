const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeActivityType,
  inferActivityTypeFromLines,
} = require('../utils/activityType');

test('normalizeActivityType maps supported authored modes to canonical types', () => {
  assert.equal(normalizeActivityType('group'), 'group');
  assert.equal(normalizeActivityType('normal'), 'group');
  assert.equal(normalizeActivityType('test'), 'test');
  assert.equal(normalizeActivityType('demo'), 'demo');
  assert.equal(normalizeActivityType('playground'), 'demo');
  assert.equal(normalizeActivityType('weird-mode'), null);
});

test('inferActivityTypeFromLines defaults to group when no markers are present', () => {
  assert.equal(
    inferActivityTypeFromLines(['\\title{Hello}', '\\questiongroup{One}']),
    'group'
  );
});

test('inferActivityTypeFromLines supports legacy and modern test syntax', () => {
  assert.equal(
    inferActivityTypeFromLines(['\\test', '\\questiongroup{One}']),
    'test'
  );
  assert.equal(
    inferActivityTypeFromLines(['\\mode{test}', '\\questiongroup{One}']),
    'test'
  );
});

test('inferActivityTypeFromLines supports explicit group and demo modes', () => {
  assert.equal(
    inferActivityTypeFromLines(['\\mode{group}', '\\questiongroup{One}']),
    'group'
  );
  assert.equal(
    inferActivityTypeFromLines(['\\mode{demo}', '\\questiongroup{One}']),
    'demo'
  );
  assert.equal(
    inferActivityTypeFromLines(['\\mode{playground}', '\\questiongroup{One}']),
    'demo'
  );
});

test('inferActivityTypeFromLines prefers explicit mode over legacy fallback markers', () => {
  assert.equal(
    inferActivityTypeFromLines(['\\test', '\\mode{group}', '\\questiongroup{One}']),
    'group'
  );
});
