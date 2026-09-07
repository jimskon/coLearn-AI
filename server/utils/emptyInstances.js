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
            ai.created_at,
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

module.exports = {
  ABANDONED_INSTANCE_SQL,
  findAbandonedInstances,
  deleteAbandonedInstances,
};
