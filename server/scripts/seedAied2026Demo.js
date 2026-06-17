const db = require('../db');
const { ensureDemoModeSchema } = require('../utils/demoModeSchema');

const DEMO_CLASS_NAME = 'AIED 2026 Demo';
const DEMO_CLASS_DESCRIPTION = 'Public demo class for the AIED 2026 coLearn-AI showcase.';
const DEMO_COURSE_NAME = 'AIED 2026 Public Demo';
const DEMO_CODE = 'aied2026';
const DEMO_SECTION = 'DEMO';
const DEMO_SEMESTER = 'summer';
const DEMO_YEAR = 2026;
const DEMO_ACTIVITY_NAME = 'aied2026_demo_activity';
const DEMO_ACTIVITY_TITLE = 'AIED 2026 Demo Activity';
const DEMO_ACTIVITY_TEXT = [
  '\\title{AIED 2026 Demo Activity}',
  '\\mode{demo}',
  '\\section{Welcome}',
  'Welcome to the coLearn-AI public demo for AIED 2026.',
  '',
  '\\questiongroup{Warmup}',
  '\\question{What do you notice about this collaborative activity flow?}',
  'Share one thing you would want learners to discuss together.',
  '\\endquestion',
  '\\endquestiongroup',
].join('\n');

async function getOrCreateDemoClass() {
  const [[existing]] = await db.query(
    'SELECT id, name, demo_mode FROM pogil_classes WHERE name = ? LIMIT 1',
    [DEMO_CLASS_NAME]
  );

  if (existing) {
    if (Number(existing.demo_mode) !== 1) {
      await db.query('UPDATE pogil_classes SET demo_mode = 1, description = ? WHERE id = ?', [
        DEMO_CLASS_DESCRIPTION,
        existing.id,
      ]);
    }
    return Number(existing.id);
  }

  const [result] = await db.query(
    `INSERT INTO pogil_classes (name, description, demo_mode, created_by)
     VALUES (?, ?, 1, NULL)`,
    [DEMO_CLASS_NAME, DEMO_CLASS_DESCRIPTION]
  );
  return Number(result.insertId);
}

async function getOrCreateDemoCourse(classId) {
  const [[existing]] = await db.query(
    `SELECT id, class_id
       FROM courses
      WHERE code = ?
      ORDER BY id ASC
      LIMIT 1`,
    [DEMO_CODE]
  );

  if (existing) {
    if (Number(existing.class_id) !== Number(classId)) {
      await db.query(
        `UPDATE courses
            SET class_id = ?,
                name = ?,
                section = ?,
                semester = ?,
                year = ?
          WHERE id = ?`,
        [classId, DEMO_COURSE_NAME, DEMO_SECTION, DEMO_SEMESTER, DEMO_YEAR, existing.id]
      );
    }
    return Number(existing.id);
  }

  const [result] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [DEMO_COURSE_NAME, DEMO_CODE, DEMO_SECTION, DEMO_SEMESTER, DEMO_YEAR, classId]
  );

  return Number(result.insertId);
}

async function getOrCreateDemoActivity(classId) {
  const [[existingByName]] = await db.query(
    `SELECT id
       FROM pogil_activities
      WHERE class_id = ? AND name = ?
      LIMIT 1`,
    [classId, DEMO_ACTIVITY_NAME]
  );

  if (existingByName) {
    await db.query(
      `UPDATE pogil_activities
          SET title = ?,
              source_type = 'local',
              content_text = ?,
              sheet_url = NULL,
              order_index = 1
        WHERE id = ?`,
      [DEMO_ACTIVITY_TITLE, DEMO_ACTIVITY_TEXT, existingByName.id]
    );
    return Number(existingByName.id);
  }

  const [[firstExisting]] = await db.query(
    `SELECT id
       FROM pogil_activities
      WHERE class_id = ?
      ORDER BY order_index ASC, id ASC
      LIMIT 1`,
    [classId]
  );

  if (firstExisting) {
    await db.query(
      `UPDATE pogil_activities
          SET title = ?,
              source_type = 'local',
              content_text = ?,
              sheet_url = NULL
        WHERE id = ?`,
      [DEMO_ACTIVITY_TITLE, DEMO_ACTIVITY_TEXT, firstExisting.id]
    );
    return Number(firstExisting.id);
  }

  const [result] = await db.query(
    `INSERT INTO pogil_activities
       (name, title, sheet_url, source_type, content_text, order_index, class_id, created_by, is_test)
     VALUES (?, ?, NULL, 'local', ?, 1, ?, NULL, 0)`,
    [DEMO_ACTIVITY_NAME, DEMO_ACTIVITY_TITLE, DEMO_ACTIVITY_TEXT, classId]
  );

  return Number(result.insertId);
}

async function main() {
  try {
    await ensureDemoModeSchema();

    const classId = await getOrCreateDemoClass();
    const courseId = await getOrCreateDemoCourse(classId);
    const activityId = await getOrCreateDemoActivity(classId);

    console.log(JSON.stringify({
      ok: true,
      demoCode: DEMO_CODE,
      classId,
      courseId,
      activityId,
      route: `/${DEMO_CODE}`,
      creatorRoute: `/${DEMO_CODE}/creator`,
    }, null, 2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
