const express = require('express');
const router = express.Router();
const db = require('../db');
const { canUseResearch, accessibleCourseIds, filterAccessibleCourses } = require('./access');
const { computeForCourses, exportDataset, reconstructRun, courseLabel } = require('./service');
const { DATASETS } = require('./exports');
const { liveForActivity } = require('./live');
const { ObservationError, createObservation, deleteObservation } = require('./observations');

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

// Row-level research dataset (CSV) for the same selection as /metrics.
// Students, groups, and instructors appear only as pseudonymous IDs.
router.post('/exports/:dataset', async (req, res) => {
  if (!requireResearchUser(req, res)) return;
  const dataset = String(req.params.dataset || '');
  if (!DATASETS.includes(dataset)) return res.status(404).json({ error: 'Unknown dataset' });
  const requested = (Array.isArray(req.body?.courseIds) ? req.body.courseIds : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!requested.length) return res.status(400).json({ error: 'Select at least one course' });
  if (requested.length > MAX_COURSES) return res.status(400).json({ error: `Select at most ${MAX_COURSES} courses` });
  if (String(process.env.RESEARCH_ID_SECRET || '').length < 16) {
    return res.status(503).json({ error: 'Research exports are not set up: RESEARCH_ID_SECRET (16+ characters) must be set in server/.env.' });
  }

  try {
    const courseIds = await filterAccessibleCourses(db, req.user, requested);
    if (!courseIds.length) return res.status(403).json({ error: 'No access to the selected courses' });
    const { rows, csv } = await exportDataset(db, courseIds, dataset, req.body);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('X-Row-Count', String(rows));
    res.send(csv);
  } catch (err) {
    console.error('❌ research export:', err);
    res.status(500).json({ error: 'Failed to build the export' });
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

// Instructor observation tags (View Groups, Observation view).
router.post('/observations', async (req, res) => {
  if (!requireResearchUser(req, res)) return;
  try {
    res.status(201).json(await createObservation(db, req.user, {
      instanceId: req.body?.instanceId,
      label: String(req.body?.label || ''),
    }));
  } catch (err) {
    if (err instanceof ObservationError) return res.status(err.status).json({ error: err.message });
    console.error('❌ research observation:', err);
    res.status(500).json({ error: 'Failed to save observation' });
  }
});

router.delete('/observations/:id', async (req, res) => {
  if (!requireResearchUser(req, res)) return;
  try {
    await deleteObservation(db, req.user, req.params.id);
    res.status(204).end();
  } catch (err) {
    if (err instanceof ObservationError) return res.status(err.status).json({ error: err.message });
    console.error('❌ research observation undo:', err);
    res.status(500).json({ error: 'Failed to undo observation' });
  }
});

module.exports = router;
