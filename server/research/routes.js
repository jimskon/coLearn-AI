const express = require('express');
const router = express.Router();
const db = require('../db');
const { canUseResearch, accessibleCourseIds, filterAccessibleCourses } = require('./access');
const { computeForCourses, courseLabel } = require('./service');

const MAX_COURSES = 200;

function requireResearchUser(req, res) {
  if (!canUseResearch(req.user)) {
    res.status(403).json({ error: 'Instructor, creator, or root access required' });
    return false;
  }
  return true;
}

// Courses the signed-in user may analyze.
router.get('/courses', async (req, res) => {
  if (!requireResearchUser(req, res)) return;
  try {
    const ids = await accessibleCourseIds(db, req.user);
    if (!ids.length) return res.json({ courses: [] });
    const [rows] = await db.query(
      `SELECT c.id, c.name, c.code, c.section, c.semester, c.year,
              u.name AS instructorName, pc.name AS className
         FROM courses c
         LEFT JOIN users u ON u.id = c.instructor_id
         LEFT JOIN pogil_classes pc ON pc.id = c.class_id
        WHERE c.id IN (?)
        ORDER BY c.year DESC, FIELD(c.semester, 'fall', 'summer', 'spring'), c.name, c.section`,
      [ids]
    );
    res.json({ courses: rows.map((c) => ({ ...c, label: courseLabel(c) })) });
  } catch (err) {
    console.error('❌ research courses:', err);
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

// Aggregate metrics for selected courses. Body: { courseIds, from, to,
// groupSize, questionType, idleMinutes }.
router.post('/metrics', async (req, res) => {
  if (!requireResearchUser(req, res)) return;
  const requested = (Array.isArray(req.body?.courseIds) ? req.body.courseIds : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!requested.length) return res.status(400).json({ error: 'Select at least one course' });
  if (requested.length > MAX_COURSES) return res.status(400).json({ error: `Select at most ${MAX_COURSES} courses` });

  try {
    const courseIds = await filterAccessibleCourses(db, req.user, requested);
    if (!courseIds.length) return res.status(403).json({ error: 'No access to the selected courses' });
    res.json(await computeForCourses(db, courseIds, req.body));
  } catch (err) {
    console.error('❌ research metrics:', err);
    res.status(500).json({ error: 'Failed to compute research metrics' });
  }
});

module.exports = router;
