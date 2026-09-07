'use strict';

/*
 * What counts as an abandoned activity instance.
 *
 * Instances accumulate. `setupMultipleGroupInstances` numbers its groups 1..N
 * from scratch every run, and the block that used to remove the previous run's
 * rows was commented out (see the note above it) because it deleted student
 * work along with the leftovers. So a class set up once for 24 test-takers and
 * again as 6 groups of 5 keeps the 18 rows nobody will ever open, and they
 * render on the roster as groups with no members. `ensureSandboxInstance` adds
 * one more each time an author opens Test Run, taking a real group number as it
 * goes.
 *
 * The reason the old delete was dangerous is that an activity_instance cascades
 * to its responses: deleting one that a student worked in destroys the work.
 * This module exists so that "abandoned" has exactly one definition, stated
 * once, and so the cleanup script and the setup path cannot disagree about it.
 *
 * The definition is deliberately strict. An instance is abandoned only when
 * there is positive evidence that nothing ever happened in it:
 *
 *   - nobody is a member of it
 *   - it holds no responses and no drafts
 *   - it was never submitted and never graded
 *   - it records no progress
 *
 * Anything that fails even one of those is left alone, whatever it looks like.
 * A false negative leaves a stray row on a roster; a false positive deletes a
 * student's test. Those are not comparable, so the predicate errs in one
 * direction only.
 */

/**
 * SQL for the "nothing ever happened here" test, as a WHERE fragment on an
 * `activity_instances` row aliased `ai`.
 *
 * Written as EXISTS subqueries rather than joins so that adding a table that
 * can hold student work means adding a clause here, and every caller inherits
 * it.
 */
const ABANDONED_INSTANCE_SQL = `
      ai.submitted_at IS NULL
  AND ai.graded_at IS NULL
  AND COALESCE(ai.completed_groups, 0) = 0
  AND COALESCE(ai.points_earned, 0) = 0
  AND (ai.progress_status IS NULL OR ai.progress_status = 'not_started')
  AND NOT EXISTS (
        SELECT 1 FROM group_members gm
         WHERE gm.activity_instance_id = ai.id
      )
  AND NOT EXISTS (
        SELECT 1 FROM responses r
         WHERE r.activity_instance_id = ai.id
      )
  AND NOT EXISTS (
        SELECT 1 FROM response_drafts rd
         WHERE rd.activity_instance_id = ai.id
      )
`;

/**
 * Abandoned instances, optionally narrowed to one course and/or activity.
 *
 * Returns enough context to print a report a human can check before deleting:
 * which course, which activity, which group number, and how old the row is.
 */
async function findAbandonedInstances(conn, { courseId = null, activityId = null } = {}) {
  const where = [ABANDONED_INSTANCE_SQL];
  const params = [];

  if (courseId != null) {
    where.push('ai.course_id = ?');
    params.push(Number(courseId));
  }
  if (activityId != null) {
    where.push('ai.activity_id = ?');
    params.push(Number(activityId));
  }

  const [rows] = await conn.query(
    `SELECT ai.id,
            ai.course_id,
            ai.activity_id,
            ai.group_number,
            ai.active_rotation_mode,
            ai.progress_status,
            ai.test_start_at,
            ai.test_duration_minutes,
            ai.start_time,
            c.name  AS course_name,
            a.title AS activity_title
       FROM activity_instances ai
       LEFT JOIN courses c          ON c.id = ai.course_id
       LEFT JOIN pogil_activities a ON a.id = ai.activity_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY ai.course_id, ai.activity_id, ai.group_number, ai.id`,
    params,
  );

  return rows;
}

/**
 * Delete the abandoned instances for one course+activity.
 *
 * Re-checks the predicate inside the DELETE rather than trusting ids gathered
 * earlier: a student can join a group between the report and the delete, and a
 * row that stops being abandoned in that window must survive. The subquery
 * wrapper is MySQL's requirement that a DELETE not read the table it targets
 * directly.
 *
 * Returns the number of rows removed.
 */
async function deleteAbandonedInstances(conn, { courseId = null, activityId = null } = {}) {
  const where = [ABANDONED_INSTANCE_SQL];
  const params = [];

  if (courseId != null) {
    where.push('ai.course_id = ?');
    params.push(Number(courseId));
  }
  if (activityId != null) {
    where.push('ai.activity_id = ?');
    params.push(Number(activityId));
  }

  const [result] = await conn.query(
    `DELETE FROM activity_instances
      WHERE id IN (
        SELECT id FROM (
          SELECT ai.id
            FROM activity_instances ai
           WHERE ${where.join('\n             AND ')}
        ) AS doomed
      )`,
    params,
  );

  return Number(result?.affectedRows || 0);
}

/**
 * Every instance in scope, with a verdict on each clause of the predicate.
 *
 * Exists because "No abandoned instances found" is an unhelpful answer when a
 * roster is visibly full of empty cards: it can mean the rule is wrong, or that
 * the scope matched nothing at all, and those need different fixes. This
 * reports the raw signals so a person can see which clause is doing it.
 */
async function explainInstances(conn, { courseId = null, activityId = null } = {}) {
  const where = ['1 = 1'];
  const params = [];

  if (courseId != null) {
    where.push('ai.course_id = ?');
    params.push(Number(courseId));
  }
  if (activityId != null) {
    where.push('ai.activity_id = ?');
    params.push(Number(activityId));
  }

  const [rows] = await conn.query(
    `SELECT ai.id,
            ai.course_id,
            ai.activity_id,
            ai.group_number,
            ai.active_rotation_mode,
            ai.progress_status,
            ai.status,
            ai.submitted_at,
            ai.graded_at,
            COALESCE(ai.completed_groups, 0) AS completed_groups,
            COALESCE(ai.points_earned, 0)    AS points_earned,
            (SELECT COUNT(*) FROM group_members   gm WHERE gm.activity_instance_id = ai.id) AS members,
            (SELECT COUNT(*) FROM responses       r  WHERE r.activity_instance_id  = ai.id) AS responses,
            (SELECT COUNT(*) FROM response_drafts rd WHERE rd.activity_instance_id = ai.id) AS drafts
       FROM activity_instances ai
      WHERE ${where.join('\n        AND ')}
      ORDER BY ai.activity_id, ai.group_number, ai.id`,
    params,
  );

  return rows.map((row) => ({
    ...row,
    keptBecause: [
      row.members > 0 && 'has members',
      row.responses > 0 && 'has responses',
      row.drafts > 0 && 'has drafts',
      row.submitted_at && 'submitted',
      row.graded_at && 'graded',
      Number(row.completed_groups) > 0 && 'completed_groups > 0',
      Number(row.points_earned) > 0 && 'points_earned > 0',
      row.progress_status && row.progress_status !== 'not_started'
        && `progress_status = ${row.progress_status}`,
    ].filter(Boolean),
  }));
}

/**
 * When a scope matches no instances at all, the number given was probably an id
 * for something else. coLearn has a class and a course, and a roster URL shows
 * one while activity_instances records the other.
 */
async function identifyScopeNumber(conn, value) {
  const id = Number(value);
  const found = [];

  const probes = [
    ['course', 'SELECT id, name FROM courses WHERE id = ?'],
    ['class', 'SELECT id, name FROM pogil_classes WHERE id = ?'],
    ['activity', 'SELECT id, title AS name FROM pogil_activities WHERE id = ?'],
  ];

  for (const [kind, sql] of probes) {
    try {
      const [[row]] = await conn.query(sql, [id]);
      if (row) found.push({ kind, id: row.id, name: row.name });
    } catch {
      // A table that does not exist in this deployment simply is not a match.
    }
  }

  // A class does not own instances directly; its courses do.
  try {
    const [courses] = await conn.query(
      'SELECT id, name FROM courses WHERE class_id = ?',
      [id],
    );
    if (courses.length) found.push({ kind: 'courses-of-class', courses });
  } catch {
    // ignore
  }

  return found;
}

/**
 * Clear an author's leftover sandbox instances for one activity.
 *
 * Reuse keeps a single Test Run sandbox per author, but that only stops new
 * ones appearing -- it does not tidy what an earlier build left behind, and a
 * sandbox nobody reopens would otherwise sit on the roster forever. Opening a
 * Test Run is the natural moment to sweep: the author is already here, already
 * holds the lock, and the sweep is bounded to rows they own.
 *
 * Deliberately scoped to `ownerId`. Another instructor may have their own
 * sandbox open on this activity right now, and while an open sandbox is
 * "abandoned" by this module's definition -- nothing has been saved in it --
 * deleting it out from under a live page is a different kind of wrong.
 *
 * `exceptId` is the sandbox being handed back, which must survive.
 */
async function deleteAbandonedSandboxes(conn, { courseId, activityId, ownerId, exceptId = null }) {
  if (!courseId || !activityId || !ownerId) return 0;

  const params = [Number(courseId), Number(activityId), Number(ownerId)];
  const keepClause = exceptId ? 'AND ai.id <> ?' : '';
  if (exceptId) params.push(Number(exceptId));

  const [result] = await conn.query(
    `DELETE FROM activity_instances
      WHERE id IN (
        SELECT id FROM (
          SELECT ai.id
            FROM activity_instances ai
           WHERE ai.course_id = ?
             AND ai.activity_id = ?
             AND ai.sandbox_owner_id = ?
             AND ai.active_rotation_mode = 'sandbox'
             ${keepClause}
             AND ${ABANDONED_INSTANCE_SQL}
        ) AS doomed
      )`,
    params,
  );

  return Number(result?.affectedRows || 0);
}

module.exports = {
  ABANDONED_INSTANCE_SQL,
  findAbandonedInstances,
  deleteAbandonedInstances,
  deleteAbandonedSandboxes,
  explainInstances,
  identifyScopeNumber,
};
