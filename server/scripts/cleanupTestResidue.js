require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../db');

const TEST_CLASS_NAME_RE = '^(Course Class-|Class-|ActivitiesClass-|GroupsClass-|UsersClass-|ResponsesClass-|ActivityTypeClass-|ActivityInstanceClass)';
const TEST_CLASS_DESCRIPTIONS = [
  'Class for course route tests',
  'Class for route tests',
  'Class for activities route tests',
  'Class for groups route tests',
  'Class for users route tests',
  'Class for responses route tests',
  'Class for activity type route tests',
  'Class for activity instance tests',
];

const args = new Set(process.argv.slice(2));
const shouldApply = args.has('--apply');
const shouldVerbose = args.has('--verbose');

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printRows(rows, columns) {
  if (!rows.length) {
    console.log('(none)');
    return;
  }

  const widths = columns.map((column) =>
    Math.max(
      column.length,
      ...rows.map((row) => String(row[column] == null ? '' : row[column]).length)
    )
  );

  console.log(columns.map((column, i) => column.padEnd(widths[i])).join('  '));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));

  for (const row of rows) {
    console.log(
      columns
        .map((column, i) => String(row[column] == null ? '' : row[column]).padEnd(widths[i]))
        .join('  ')
    );
  }
}

async function query(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

async function execDelete(conn, summary, label, sql, params = []) {
  const [result] = await conn.query(sql, params);
  summary.push({ step: label, deleted: result.affectedRows || 0 });
  return result.affectedRows || 0;
}

async function tableExists(conn, tableName) {
  const rows = await query(
    conn,
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = ?
    LIMIT 1
    `,
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(conn, tableName, columnName) {
  const rows = await query(
    conn,
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND column_name = ?
    LIMIT 1
    `,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function getIdRows(conn, sql, params = []) {
  return query(conn, sql, params);
}

function idsFrom(rows) {
  return rows.map((row) => Number(row.id)).filter(Number.isFinite);
}

async function gatherTargets(conn) {
  const classRows = await getIdRows(
    conn,
    `
    SELECT id, name, description
    FROM pogil_classes
    WHERE name REGEXP ?
       OR description IN (?)
    ORDER BY id
    `,
    [TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS]
  );
  const classIds = idsFrom(classRows);

  if (!classIds.length) {
    return {
      classRows,
      courseRows: [],
      activityRows: [],
      instanceRows: [],
      classIds: [],
      courseIds: [],
      activityIds: [],
      instanceIds: [],
    };
  }

  const courseRows = await getIdRows(
    conn,
    `
    SELECT id, name, code, class_id
    FROM courses
    WHERE class_id IN (?)
    ORDER BY id
    `,
    [classIds]
  );
  const courseIds = idsFrom(courseRows);

  const activityRows = await getIdRows(
    conn,
    `
    SELECT id, name, title, class_id
    FROM pogil_activities
    WHERE class_id IN (?)
    ORDER BY id
    `,
    [classIds]
  );
  const activityIds = idsFrom(activityRows);

  let instanceRows = [];
  if (activityIds.length || courseIds.length) {
    const where = [];
    const params = [];

    if (activityIds.length) {
      where.push('activity_id IN (?)');
      params.push(activityIds);
    }
    if (courseIds.length) {
      where.push('course_id IN (?)');
      params.push(courseIds);
    }

    instanceRows = await getIdRows(
      conn,
      `
      SELECT id, activity_id, course_id, group_number, status
      FROM activity_instances
      WHERE ${where.join(' OR ')}
      ORDER BY id
      `,
      params
    );
  }

  return {
    classRows,
    courseRows,
    activityRows,
    instanceRows,
    classIds,
    courseIds,
    activityIds,
    instanceIds: idsFrom(instanceRows),
  };
}

async function getSummaryCounts(conn) {
  const hasPendingUsers = await tableExists(conn, 'pending_users');
  const pendingSelect = hasPendingUsers
    ? `(SELECT COUNT(*) FROM pending_users WHERE email LIKE '%@example.com') AS pending_example_user_count`
    : `0 AS pending_example_user_count`;

  const [counts] = await query(
    conn,
    `
    SELECT
      (SELECT COUNT(*) FROM pogil_classes pc
        WHERE pc.name REGEXP ?
           OR pc.description IN (?)) AS class_count,
      (SELECT COUNT(*) FROM courses c
        JOIN pogil_classes pc ON pc.id = c.class_id
        WHERE pc.name REGEXP ?
           OR pc.description IN (?)) AS course_count,
      (SELECT COUNT(*) FROM pogil_activities a
        JOIN pogil_classes pc ON pc.id = a.class_id
        WHERE pc.name REGEXP ?
           OR pc.description IN (?)) AS activity_count,
      (SELECT COUNT(*) FROM activity_instances ai
        JOIN pogil_activities a ON a.id = ai.activity_id
        JOIN pogil_classes pc ON pc.id = a.class_id
        WHERE pc.name REGEXP ?
           OR pc.description IN (?)) AS instance_count,
      (SELECT COUNT(*) FROM users u
        WHERE u.email LIKE '%@example.com') AS fake_user_count,
      ${pendingSelect}
    `,
    [
      TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS,
      TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS,
      TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS,
      TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS,
    ]
  );

  return counts;
}

async function deleteOptionalInstanceTable(conn, summary, tableName, fkColumn, instanceIds) {
  if (!instanceIds.length) return;
  if (!(await tableExists(conn, tableName))) return;
  if (!(await columnExists(conn, tableName, fkColumn))) return;

  await execDelete(
    conn,
    summary,
    `Delete ${tableName}`,
    `DELETE FROM ${tableName} WHERE ${fkColumn} IN (?)`,
    [instanceIds]
  );
}

async function deleteOptionalExamplePendingUsers(conn, summary) {
  if (!(await tableExists(conn, 'pending_users'))) return;
  if (!(await columnExists(conn, 'pending_users', 'email'))) return;

  await execDelete(
    conn,
    summary,
    'Delete pending_users with @example.com emails',
    `DELETE FROM pending_users WHERE email LIKE '%@example.com'`
  );
}

async function deleteOrphanExampleUsers(conn, summary) {
  const hasSubmittedByUser = await columnExists(conn, 'activity_instances', 'submitted_by_user_id');
  const hasCourseEnrollments = await tableExists(conn, 'course_enrollments');
  const hasGroupMembers = await tableExists(conn, 'group_members');
  const hasResponses = await tableExists(conn, 'responses');
  const hasResponseDrafts = await tableExists(conn, 'response_drafts');

  const submittedByClause = hasSubmittedByUser
    ? `AND NOT EXISTS (
         SELECT 1 FROM activity_instances ai2 WHERE ai2.submitted_by_user_id = u.id
       )`
    : '';
  const courseEnrollmentClause = hasCourseEnrollments
    ? `AND NOT EXISTS (SELECT 1 FROM course_enrollments ce WHERE ce.student_id = u.id)`
    : '';
  const groupMembersClause = hasGroupMembers
    ? `AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.student_id = u.id)`
    : '';
  const responsesClause = hasResponses
    ? `AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.answered_by_user_id = u.id)`
    : '';
  const responseDraftsClause = hasResponseDrafts
    ? `AND NOT EXISTS (SELECT 1 FROM response_drafts rd WHERE rd.answered_by_user_id = u.id)`
    : '';

  const orphanRows = await query(
    conn,
    `
    SELECT u.id
    FROM users u
    WHERE u.email LIKE '%@example.com'
      AND NOT EXISTS (SELECT 1 FROM users parent WHERE parent.created_by = u.id)
      AND NOT EXISTS (SELECT 1 FROM pogil_classes pc WHERE pc.created_by = u.id)
      AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.instructor_id = u.id)
      ${courseEnrollmentClause}
      AND NOT EXISTS (SELECT 1 FROM pogil_activities a WHERE a.created_by = u.id)
      AND NOT EXISTS (SELECT 1 FROM activity_instances ai WHERE ai.active_student_id = u.id)
      ${submittedByClause}
      ${groupMembersClause}
      ${responsesClause}
      ${responseDraftsClause}
    `
  );

  const orphanIds = idsFrom(orphanRows);
  if (!orphanIds.length) {
    summary.push({ step: 'Delete orphan users with @example.com emails', deleted: 0 });
    return 0;
  }

  return execDelete(
    conn,
    summary,
    'Delete orphan users with @example.com emails',
    `DELETE FROM users WHERE id IN (?)`,
    [orphanIds]
  );
}

async function cleanup(conn, targets) {
  const summary = [];
  const { classIds, courseIds, activityIds, instanceIds } = targets;

  if (courseIds.length && (await tableExists(conn, 'course_enrollments'))) {
    await execDelete(
      conn,
      summary,
      'Delete course_enrollments for target courses',
      `DELETE FROM course_enrollments WHERE course_id IN (?)`,
      [courseIds]
    );
  }

  await deleteOptionalInstanceTable(conn, summary, 'activity_heartbeats', 'activity_instance_id', instanceIds);
  await deleteOptionalInstanceTable(conn, summary, 'audit_log', 'activity_instance_id', instanceIds);
  await deleteOptionalInstanceTable(conn, summary, 'followups', 'activity_instance_id', instanceIds);
  await deleteOptionalInstanceTable(conn, summary, 'feedback', 'activity_instance_id', instanceIds);
  await deleteOptionalInstanceTable(conn, summary, 'progress_monitor_suggestions', 'activity_instance_id', instanceIds);

  if (instanceIds.length && (await tableExists(conn, 'response_drafts'))) {
    await execDelete(
      conn,
      summary,
      'Delete response_drafts for target instances',
      `DELETE FROM response_drafts WHERE activity_instance_id IN (?)`,
      [instanceIds]
    );
  }

  if (instanceIds.length && (await tableExists(conn, 'responses'))) {
    await execDelete(
      conn,
      summary,
      'Delete responses for target instances',
      `DELETE FROM responses WHERE activity_instance_id IN (?)`,
      [instanceIds]
    );
  }

  if (instanceIds.length && (await tableExists(conn, 'group_members'))) {
    await execDelete(
      conn,
      summary,
      'Delete group_members for target instances',
      `DELETE FROM group_members WHERE activity_instance_id IN (?)`,
      [instanceIds]
    );
  }

  if (instanceIds.length) {
    await execDelete(
      conn,
      summary,
      'Delete target activity_instances',
      `DELETE FROM activity_instances WHERE id IN (?)`,
      [instanceIds]
    );
  }

  if (activityIds.length) {
    await execDelete(
      conn,
      summary,
      'Delete target pogil_activities',
      `DELETE FROM pogil_activities WHERE id IN (?)`,
      [activityIds]
    );
  }

  if (courseIds.length) {
    await execDelete(
      conn,
      summary,
      'Delete target courses',
      `DELETE FROM courses WHERE id IN (?)`,
      [courseIds]
    );
  }

  if (classIds.length) {
    await execDelete(
      conn,
      summary,
      'Delete target pogil_classes',
      `DELETE FROM pogil_classes WHERE id IN (?)`,
      [classIds]
    );
  }

  await deleteOptionalExamplePendingUsers(conn, summary);
  await deleteOrphanExampleUsers(conn, summary);

  return summary;
}

async function main() {
  const conn = await db.getConnection();

  try {
    console.log('Cleanup of likely historical test residue using DB credentials from server/.env');
    console.log(shouldApply ? 'Mode: APPLY (transaction will be committed)' : 'Mode: DRY RUN (transaction will be rolled back)');

    const before = await getSummaryCounts(conn);
    printSection('Before');
    printRows([before], [
      'class_count',
      'course_count',
      'activity_count',
      'instance_count',
      'fake_user_count',
      'pending_example_user_count',
    ]);

    await conn.beginTransaction();

    const targets = await gatherTargets(conn);
    printSection('Target Summary');
    printRows(
      [{
        target_class_count: targets.classIds.length,
        target_course_count: targets.courseIds.length,
        target_activity_count: targets.activityIds.length,
        target_instance_count: targets.instanceIds.length,
      }],
      ['target_class_count', 'target_course_count', 'target_activity_count', 'target_instance_count']
    );

    if (shouldVerbose) {
      printSection('Sample Target Classes');
      printRows(targets.classRows.slice(0, 20), ['id', 'name', 'description']);
    }

    const summary = await cleanup(conn, targets);

    const after = await getSummaryCounts(conn);
    printSection('Deletion Summary');
    printRows(summary, ['step', 'deleted']);

    printSection('After');
    printRows([after], [
      'class_count',
      'course_count',
      'activity_count',
      'instance_count',
      'fake_user_count',
      'pending_example_user_count',
    ]);

    if (shouldApply) {
      await conn.commit();
      console.log('\nCommitted cleanup transaction.');
    } else {
      await conn.rollback();
      console.log('\nRolled back dry-run transaction. Re-run with --apply to commit.');
    }
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_rollbackErr) {
      // Best effort rollback only.
    }
    console.error('Failed to clean up test residue:', err);
    process.exitCode = 1;
  } finally {
    conn.release();
    await db.end();
  }
}

main();
