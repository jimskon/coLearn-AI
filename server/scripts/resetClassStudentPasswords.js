// server/scripts/resetClassStudentPasswords.js
// Reset all student passwords for a course/class join code.
//
// Dry run:
//   node server/scripts/resetClassStudentPasswords.js JOINCODE NewPassword123
//
// Apply:
//   node server/scripts/resetClassStudentPasswords.js JOINCODE NewPassword123 --apply
//
// If the join code matches more than one course, pass --course-id:
//   node server/scripts/resetClassStudentPasswords.js JOINCODE NewPassword123 --course-id 12 --apply

const bcrypt = require('bcrypt');
const db = require('../db');

function usage() {
  console.log(`
Usage:
  node server/scripts/resetClassStudentPasswords.js <joinCode> <newPassword> [--apply] [--course-id <id>]

Examples:
  node server/scripts/resetClassStudentPasswords.js DEMO118 Kenyon
  node server/scripts/resetClassStudentPasswords.js DEMO118 Kenyon --apply
  node server/scripts/resetClassStudentPasswords.js DEMO118 Kenyon --course-id 12 --apply

Without --apply this only prints the students that would be changed.
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    apply: false,
    courseId: null,
    positional: [],
  };

  while (args.length) {
    const arg = args.shift();

    if (arg === '--apply' || arg === '--yes') {
      options.apply = true;
      continue;
    }

    if (arg === '--course-id') {
      const raw = args.shift();
      const id = Number(raw);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('--course-id requires a positive integer.');
      }
      options.courseId = id;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.positional.push(arg);
  }

  const [joinCode, newPassword] = options.positional;
  return {
    joinCode,
    newPassword,
    apply: options.apply,
    courseId: options.courseId,
    help: options.help,
  };
}

async function getMatchingCourses(joinCode, courseId) {
  const params = [joinCode];
  let courseIdClause = '';

  if (courseId) {
    courseIdClause = ' AND c.id = ?';
    params.push(courseId);
  }

  const [rows] = await db.query(
    `SELECT
       c.id,
       c.name,
       c.code,
       c.section,
       c.semester,
       c.year,
       pc.name AS class_name
     FROM courses c
     LEFT JOIN pogil_classes pc ON pc.id = c.class_id
     WHERE c.code = ?${courseIdClause}
     ORDER BY c.year DESC, c.semester ASC, c.section ASC, c.id ASC`,
    params
  );

  return rows;
}

async function getEnrolledStudents(courseId) {
  const [rows] = await db.query(
    `SELECT DISTINCT
       u.id,
       u.name,
       u.email,
       u.role
     FROM course_enrollments ce
     JOIN users u ON u.id = ce.student_id
     WHERE ce.course_id = ?
       AND u.role = 'student'
     ORDER BY u.name ASC, u.email ASC`,
    [courseId]
  );

  return rows;
}

function formatCourse(course) {
  const className = course.class_name ? `, class: ${course.class_name}` : '';
  return `${course.id}: ${course.name} (${course.code}, ${course.section}, ${course.semester} ${course.year}${className})`;
}

async function main() {
  let parsed;

  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    usage();
    process.exitCode = 1;
    return;
  }

  const { joinCode, newPassword, apply, courseId, help } = parsed;

  if (help) {
    usage();
    return;
  }

  if (!joinCode || !newPassword) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const courses = await getMatchingCourses(joinCode, courseId);

    if (courses.length === 0) {
      throw new Error(
        courseId
          ? `No course found for join code "${joinCode}" and course id ${courseId}.`
          : `No course found for join code "${joinCode}".`
      );
    }

    if (courses.length > 1) {
      console.error(`Join code "${joinCode}" matched more than one course:`);
      for (const course of courses) {
        console.error(`  ${formatCourse(course)}`);
      }
      console.error('\nPass --course-id <id> to choose one.');
      process.exitCode = 1;
      return;
    }

    const course = courses[0];
    const students = await getEnrolledStudents(course.id);

    console.log(`Course: ${formatCourse(course)}`);
    console.log(`Students found: ${students.length}`);

    for (const student of students) {
      console.log(`  ${student.id}: ${student.name} <${student.email}>`);
    }

    if (students.length === 0) {
      console.log('No student passwords to update.');
      return;
    }

    if (!apply) {
      console.log('\nDry run only. Re-run with --apply to update these passwords.');
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const studentIds = students.map((student) => student.id);

    const [result] = await db.query(
      `UPDATE users
       SET password_hash = ?
       WHERE role = 'student'
         AND id IN (?)`,
      [passwordHash, studentIds]
    );

    console.log(`\nUpdated ${result.affectedRows} student password(s).`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
