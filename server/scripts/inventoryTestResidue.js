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

  const header = columns
    .map((column, i) => column.padEnd(widths[i]))
    .join('  ');
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');

  console.log(header);
  console.log(divider);
  for (const row of rows) {
    console.log(
      columns
        .map((column, i) => String(row[column] == null ? '' : row[column]).padEnd(widths[i]))
        .join('  ')
    );
  }
}

async function query(sql, params) {
  const [rows] = await db.query(sql, params);
  return rows;
}

async function main() {
  try {
    const classes = await query(
      `
      SELECT id, name, description
      FROM pogil_classes
      WHERE name REGEXP ?
         OR description IN (?)
      ORDER BY id
      `,
      [TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS]
    );

    const courses = await query(
      `
      SELECT c.id, c.name, c.code, c.class_id
      FROM courses c
      JOIN pogil_classes pc ON pc.id = c.class_id
      WHERE pc.name REGEXP ?
         OR pc.description IN (?)
      ORDER BY c.id
      `,
      [TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS]
    );

    const activities = await query(
      `
      SELECT a.id, a.name, a.title, a.class_id, a.is_test
      FROM pogil_activities a
      JOIN pogil_classes pc ON pc.id = a.class_id
      WHERE pc.name REGEXP ?
         OR pc.description IN (?)
      ORDER BY a.id
      `,
      [TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS]
    );

    const instances = await query(
      `
      SELECT ai.id, ai.activity_id, ai.course_id, ai.group_number, ai.status
      FROM activity_instances ai
      JOIN pogil_activities a ON a.id = ai.activity_id
      JOIN pogil_classes pc ON pc.id = a.class_id
      WHERE pc.name REGEXP ?
         OR pc.description IN (?)
      ORDER BY ai.id
      `,
      [TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS]
    );

    const fakeUsers = await query(
      `
      SELECT id, name, email, role
      FROM users
      WHERE email LIKE '%@example.com'
      ORDER BY id
      `
    );

    const counts = await query(
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
          WHERE u.email LIKE '%@example.com') AS fake_user_count
      `,
      [
        TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS,
        TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS,
        TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS,
        TEST_CLASS_NAME_RE, TEST_CLASS_DESCRIPTIONS,
      ]
    );

    console.log('Read-only inventory of likely test residue using DB credentials from server/.env');
    printSection('Summary');
    printRows(counts, ['class_count', 'course_count', 'activity_count', 'instance_count', 'fake_user_count']);

    printSection('Classes');
    printRows(classes, ['id', 'name', 'description']);

    printSection('Courses');
    printRows(courses, ['id', 'name', 'code', 'class_id']);

    printSection('Activities');
    printRows(activities, ['id', 'name', 'title', 'class_id', 'is_test']);

    printSection('Activity Instances');
    printRows(instances, ['id', 'activity_id', 'course_id', 'group_number', 'status']);

    printSection('Users with @example.com emails');
    printRows(fakeUsers, ['id', 'name', 'email', 'role']);
  } catch (err) {
    console.error('Failed to inventory test residue:', err);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
