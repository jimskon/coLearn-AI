const express = require('express');
const router = express.Router();
const db = require('../db');
const { summarize } = require('./compute');

const MAX_COURSES = 200;

function requireRoot(req, res) {
  if (req.user?.role !== 'root') {
    res.status(403).json({ error: 'Root access required' });
    return false;
  }
  return true;
}

function courseLabel(c) {
  const term = [c.semester, c.year].filter(Boolean).join(' ');
  return [c.name, c.section ? `§${c.section}` : null, term].filter(Boolean).join(' · ');
}

// Courses a root user can pick from on the Statistics page.
router.get('/courses', async (req, res) => {
  if (!requireRoot(req, res)) return;
  try {
    const [rows] = await db.query(`
      SELECT c.id, c.name, c.code, c.section, c.semester, c.year,
             u.name AS instructorName,
             pc.name AS className,
             (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id) AS enrolled,
             (SELECT COUNT(*) FROM activity_instances ai
               WHERE ai.course_id = c.id AND ai.sandbox_owner_id IS NULL) AS instanceCount
        FROM courses c
        LEFT JOIN users u ON u.id = c.instructor_id
        LEFT JOIN pogil_classes pc ON pc.id = c.class_id
       ORDER BY c.year DESC, FIELD(c.semester, 'fall', 'summer', 'spring'), c.name, c.section
    `);
    res.json({
      courses: rows.map((c) => ({
        ...c,
        enrolled: Number(c.enrolled) || 0,
        instanceCount: Number(c.instanceCount) || 0,
        label: courseLabel(c),
      })),
    });
  } catch (err) {
    console.error('❌ Failed to load statistics courses:', err);
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

// Aggregate statistics for the selected courses. Sandbox instances and tests
// are excluded: the numbers describe group work only.
router.post('/generate', async (req, res) => {
  if (!requireRoot(req, res)) return;

  const courseIds = [...new Set(
    (Array.isArray(req.body?.courseIds) ? req.body.courseIds : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
  )];
  if (!courseIds.length) {
    return res.status(400).json({ error: 'Select at least one course' });
  }
  if (courseIds.length > MAX_COURSES) {
    return res.status(400).json({ error: `Select at most ${MAX_COURSES} courses` });
  }

  try {
    const [courses] = await db.query(
      'SELECT id, name, section, semester, year FROM courses WHERE id IN (?)',
      [courseIds]
    );
    const [enrollments] = await db.query(
      'SELECT course_id AS courseId, student_id AS studentId FROM course_enrollments WHERE course_id IN (?)',
      [courseIds]
    );
    const [instances] = await db.query(
      `SELECT ai.id, ai.course_id AS courseId, ai.activity_id AS activityId
         FROM activity_instances ai
         JOIN pogil_activities a ON a.id = ai.activity_id
        WHERE ai.course_id IN (?)
          AND ai.sandbox_owner_id IS NULL
          AND COALESCE(a.is_test, 0) = 0`,
      [courseIds]
    );

    let members = [];
    let answerKeys = [];
    let fmRows = [];
    let states = [];
    let attempts = [];

    const instanceIds = instances.map((i) => i.id);
    if (instanceIds.length) {
      [members] = await db.query(
        `SELECT activity_instance_id AS instanceId, student_id AS studentId
           FROM group_members WHERE activity_instance_id IN (?)`,
        [instanceIds]
      );
      // Counts only; compute.js re-checks the key shape case-sensitively.
      [answerKeys] = await db.query(
        `SELECT activity_instance_id AS instanceId, question_id AS questionId, COUNT(*) AS n
           FROM responses
          WHERE activity_instance_id IN (?) AND question_id REGEXP '^[0-9]+[a-z]{1,2}$'
          GROUP BY activity_instance_id, BINARY question_id`,
        [instanceIds]
      );
      [fmRows] = await db.query(
        `SELECT activity_instance_id AS instanceId, question_id AS questionId, response
           FROM responses
          WHERE activity_instance_id IN (?) AND question_id LIKE '%FM'`,
        [instanceIds]
      );
      [states] = await db.query(
        `SELECT activity_instance_id AS instanceId, submit_id AS submitId,
                answered_by_user_id AS userId, response
           FROM responses
          WHERE activity_instance_id IN (?) AND question_id REGEXP '^[0-9]+state$'`,
        [instanceIds]
      );
      [attempts] = await db.query(
        `SELECT submit_id AS submitId, response
           FROM responses
          WHERE activity_instance_id IN (?) AND question_id LIKE 'attempt:%'`,
        [instanceIds]
      );
    }

    const forCourses = (ids) => {
      const keep = new Set(ids);
      const inst = instances.filter((i) => keep.has(i.courseId));
      const instIds = new Set(inst.map((i) => i.id));
      const byInstance = (rows) => rows.filter((r) => instIds.has(r.instanceId));
      return summarize({
        instances: inst,
        members: byInstance(members),
        answerKeys: byInstance(answerKeys),
        fmRows: byInstance(fmRows),
        states: byInstance(states),
        attempts, // joined by submit_id inside summarize
        enrolledStudentIds: enrollments.filter((e) => keep.has(e.courseId)).map((e) => e.studentId),
      });
    };

    res.json({
      generatedAt: new Date().toISOString(),
      overall: forCourses(courseIds),
      byCourse: courses
        .map((c) => ({ courseId: c.id, label: courseLabel(c), stats: forCourses([c.id]) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    });
  } catch (err) {
    console.error('❌ Failed to generate statistics:', err);
    res.status(500).json({ error: 'Failed to generate statistics' });
  }
});

module.exports = router;
