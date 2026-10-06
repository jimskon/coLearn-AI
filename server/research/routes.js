const express = require('express');
const router = express.Router();
const db = require('../db');
const { canUseResearch, accessibleCourseIds, filterAccessibleCourses } = require('./access');
const { computeForCourses, reconstructRun, courseLabel } = require('./service');
const { liveForActivity } = require('./live');

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

// How one run was reconstructed (for checking rules against real class use).
router.get('/runs/:instanceId', async (req, res) => {
  if (!requireResearchUser(req, res)) return;
  const instanceId = Number(req.params.instanceId);
  if (!Number.isInteger(instanceId) || instanceId <= 0) return res.status(400).json({ error: 'Invalid run id' });
  try {
    const [[inst]] = await db.query('SELECT course_id AS courseId FROM activity_instances WHERE id = ?', [instanceId]);
    if (!inst) return res.status(404).json({ error: 'Run not found' });
    const allowed = await filterAccessibleCourses(db, req.user, [inst.courseId]);
    if (!allowed.length) return res.status(403).json({ error: 'No access to this course' });
    res.json(await reconstructRun(db, inst.courseId, instanceId, req.query));
  } catch (err) {
    console.error('❌ research run:', err);
    res.status(500).json({ error: 'Failed to reconstruct run' });
  }
});

// Live activity timelines for one activity's groups (View Groups, Observation view).
router.get('/live/:courseId/:activityId', async (req, res) => {
  if (!requireResearchUser(req, res)) return;
  const courseId = Number(req.params.courseId);
  const activityId = Number(req.params.activityId);
  if (!(courseId > 0) || !(activityId > 0)) return res.status(400).json({ error: 'Invalid course or activity' });
  try {
    const allowed = await filterAccessibleCourses(db, req.user, [courseId]);
    if (!allowed.length) return res.status(403).json({ error: 'No access to this course' });
    res.json(await liveForActivity(db, courseId, activityId));
  } catch (err) {
    console.error('❌ research live:', err);
    res.status(500).json({ error: 'Failed to load live activity' });
  }
});

module.exports = router;
