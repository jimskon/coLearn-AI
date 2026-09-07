'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ABANDONED_INSTANCE_SQL,
  findAbandonedInstances,
  deleteAbandonedInstances,
} = require('../utils/emptyInstances');

// ---------------------------------------------------------------------------
// The predicate is a safety property, not a convenience
//
// Deleting an activity_instance cascades to its responses, so a predicate that
// is too loose destroys a student's test. These assertions are what stop
// someone relaxing it later without meaning to -- the previous version of this
// cleanup was commented out rather than fixed precisely because nobody could
// convince themselves it was safe.
// ---------------------------------------------------------------------------

test('every table that can hold student work is checked', () => {
  for (const table of ['group_members', 'responses', 'response_drafts']) {
    assert.match(
      ABANDONED_INSTANCE_SQL,
      new RegExp(`NOT EXISTS[\\s\\S]*?FROM\\s+${table}\\b`),
      `${table} must be excluded by a NOT EXISTS clause`,
    );
  }
});

test('an instance with any completion signal is not abandoned', () => {
  for (const guard of ['submitted_at IS NULL', 'graded_at IS NULL', 'completed_groups', 'points_earned']) {
    assert.ok(ABANDONED_INSTANCE_SQL.includes(guard), `missing guard: ${guard}`);
  }
  assert.match(ABANDONED_INSTANCE_SQL, /progress_status\s*=\s*'not_started'/);
});

test('the predicate is a conjunction -- one failing clause keeps the row', () => {
  // Every top-level clause must be required. An OR joining two of them would
  // let a row qualify on one weak signal alone. ORs *inside* a parenthesised
  // clause are fine -- "progress_status IS NULL OR = 'not_started'" is one
  // condition written two ways -- so strip the bracketed groups first and
  // check what joins the rest.
  let topLevel = ABANDONED_INSTANCE_SQL;
  let previous;
  do {
    previous = topLevel;
    topLevel = topLevel.replace(/\([^()]*\)/g, ' ');
  } while (topLevel !== previous);

  assert.ok(!/\bOR\b/i.test(topLevel), 'top-level clauses must all be required');
});

// ---------------------------------------------------------------------------
// Query shape
// ---------------------------------------------------------------------------

function fakeConn(capture) {
  return {
    async query(sql, params) {
      capture.push({ sql, params });
      return [[], []];
    },
  };
}

test('scoping narrows by course and activity, and is parameterised', async () => {
  const calls = [];
  await findAbandonedInstances(fakeConn(calls), { courseId: 12, activityId: 87 });
  const [{ sql, params }] = calls;
  assert.match(sql, /ai\.course_id = \?/);
  assert.match(sql, /ai\.activity_id = \?/);
  assert.deepEqual(params, [12, 87]);
});

test('an unscoped search still carries the predicate', async () => {
  const calls = [];
  await findAbandonedInstances(fakeConn(calls), {});
  const [{ sql, params }] = calls;
  assert.deepEqual(params, []);
  assert.match(sql, /NOT EXISTS/);
});

test('the delete re-checks the predicate rather than trusting gathered ids', async () => {
  // A student can join a group between the report and the delete. The DELETE
  // must not take a list of ids on faith.
  const calls = [];
  await deleteAbandonedInstances(fakeConn(calls), { courseId: 12, activityId: 87 });
  const [{ sql }] = calls;
  assert.match(sql, /DELETE FROM activity_instances/);
  assert.match(sql, /NOT EXISTS/, 'the predicate must appear inside the delete');
  assert.match(sql, /FROM\s+group_members/, 'membership must be re-checked at delete time');
});
