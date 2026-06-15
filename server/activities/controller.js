// server/activities/controller.js
const db = require('../db');
const { inferActivityTypeFromActivity } = require('../utils/activityType');
const { loadActivitySourceById } = require('../utils/activityContent');

function extractTitleFromText(text) {
  const match = String(text || '').match(/^\\title\{([^}]*)\}/m);
  return match ? match[1].trim() : null;
}

// Create a new activity
exports.createActivity = async (req, res) => {
  const { name, title, sheet_url, createdBy, class_id, order_index = 0 } = req.body;
  console.log("Add activity:", req.body);

  if (!name || !title || !sheet_url || !class_id || !createdBy) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await db.query(
      `INSERT INTO pogil_activities 
        (name, title, sheet_url, created_by, class_id, order_index) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, title, sheet_url, createdBy, class_id, order_index]
    );

    res.status(201).json({
      name,
      title,
      sheet_url,
      createdBy,
      class_id,
      order_index
    });
  } catch (err) {
    console.error('Create activity error:', err);
    res.status(500).json({ error: 'Error creating activity.' });
  }
};

// Get a specific activity by ID
exports.getActivity = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM pogil_activities WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    const activity = rows[0];
    const activityType = await inferActivityTypeFromActivity(activity);
    res.json({
      ...activity,
      activity_type: activityType,
      isTest: activityType === 'test',
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not retrieve activity.' });
  }
};

exports.getActivitySource = async (req, res) => {
  const { id } = req.params;

  try {
    const source = await loadActivitySourceById(db, id);
    if (!source) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    return res.json({
      activity_id: Number(id),
      source_type: source.activity.source_type || 'remote',
      lines: source.lines,
      text: source.text,
    });
  } catch (err) {
    console.error('getActivitySource error:', err);
    return res.status(500).json({ error: 'Could not retrieve activity source.' });
  }
};

exports.saveActivitySource = async (req, res) => {
  const { id } = req.params;
  const { text } = req.body || {};

  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const [rows] = await db.query('SELECT id, title FROM pogil_activities WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    const extractedTitle = extractTitleFromText(text);
    const nextTitle = extractedTitle || rows[0].title;

    await db.query(
      `UPDATE pogil_activities
          SET content_text = ?,
              source_type = 'local',
              title = ?
        WHERE id = ?`,
      [text, nextTitle, id]
    );

    return res.json({
      activity_id: Number(id),
      source_type: 'local',
      title: nextTitle,
      text,
    });
  } catch (err) {
    console.error('saveActivitySource error:', err);
    return res.status(500).json({ error: 'Could not save activity source.' });
  }
};

exports.ensureSandboxInstance = async (req, res) => {
  const activityId = Number(req.params.id);
  const userId = Number(req.user?.id);
  const userRole = String(req.user?.role || '');

  if (!activityId) {
    return res.status(400).json({ error: 'Invalid activity id.' });
  }

  if (!userId || !['instructor', 'creator', 'root'].includes(userRole)) {
    return res.status(403).json({ error: 'Only instructors and creators can open the sandbox.' });
  }

  const conn = await db.getConnection();
  const lockName = `activitySandbox:${activityId}:${userId}`;

  try {
    const [[lockRow]] = await conn.query('SELECT GET_LOCK(?, 5) AS got', [lockName]);
    if (!lockRow?.got) {
      return res.status(409).json({ error: 'Sandbox is being opened. Try again.' });
    }

    const [[activity]] = await conn.query(
      `SELECT id, class_id
         FROM pogil_activities
        WHERE id = ?`,
      [activityId]
    );

    if (!activity) {
      return res.status(404).json({ error: 'Activity not found.' });
    }

    const [[course]] = await conn.query(
      `SELECT id
         FROM courses
        WHERE class_id = ?
        ORDER BY id ASC
        LIMIT 1`,
      [activity.class_id]
    );

    if (!course?.id) {
      return res.status(400).json({
        error: 'Create a course for this class before opening the activity sandbox.',
      });
    }

    const courseId = Number(course.id);

    const [[existing]] = await conn.query(
      `SELECT id AS instance_id
         FROM activity_instances
        WHERE activity_id = ?
          AND course_id = ?
          AND active_student_id = ?
          AND active_rotation_mode = 'sandbox'
        ORDER BY id ASC
        LIMIT 1`,
      [activityId, courseId, userId]
    );

    if (existing?.instance_id) {
      return res.json({ instanceId: Number(existing.instance_id), created: false });
    }

    const [[nextRow]] = await conn.query(
      `SELECT COALESCE(MAX(group_number), 0) + 1 AS next_group_number
         FROM activity_instances
        WHERE activity_id = ? AND course_id = ?`,
      [activityId, courseId]
    );

    const [result] = await conn.query(
      `INSERT INTO activity_instances
         (activity_id, course_id, status, group_number, total_groups, completed_groups,
          progress_status, active_student_id, active_rotation_mode)
       VALUES (?, ?, 'in_progress', ?, 0, 0, 'not_started', ?, 'sandbox')`,
      [activityId, courseId, Number(nextRow?.next_group_number) || 1, userId]
    );

    return res.status(201).json({ instanceId: Number(result.insertId), created: true });
  } catch (err) {
    console.error('ensureSandboxInstance error:', err);
    return res.status(500).json({ error: 'Failed to open activity sandbox.' });
  } finally {
    try {
      await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } catch (_) {
      // ignore release errors
    }
    conn.release();
  }
};

// Launch a new activity instance by activity ID
exports.launchActivityInstance = async (req, res) => {
  const { courseId, groupNumber } = req.body;
  const activityRef = req.params.id ?? req.params.name;

  try {
    const [rows] = await db.query(
      `SELECT id FROM pogil_activities WHERE id = ? OR name = ? LIMIT 1`,
      [activityRef, activityRef]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    const activityId = Number(rows[0].id);

    await db.query(
      `INSERT INTO activity_instances 
        (activity_id, course_id, start_time, group_number) 
       VALUES (?, ?, NOW(), ?)`,
      [activityId, courseId, groupNumber]
    );

    return res.status(201).json({ message: 'Activity instance launched.' });
  } catch (err) {
    console.error('Launch error:', err);
    res.status(500).json({ error: 'Launch failed.' });
  }
};

// Get all activities
exports.getAllActivities = async (req, res) => {
  try {
    const activities = await db.query('SELECT * FROM pogil_activities');
    res.json(activities);
  } catch (err) {
    console.error('Error fetching activities:', err);
    res.status(500).json({ error: 'Could not retrieve activities.' });
  }
};

// Delete an activity by ID
exports.deleteActivity = async (req, res) => {
  const activityRef = req.params.id ?? req.params.name;
  console.log("Deleting activity:", activityRef);

  try {
    const [result] = await db.query(
      'DELETE FROM pogil_activities WHERE id = ? OR name = ?',
      [activityRef, activityRef]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    res.json({ message: 'Activity deleted.' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete activity.' });
  }
};

// PATCH /api/activities/:id/is-test
exports.setIsTest = async (req, res) => {
  const { id } = req.params;
  const { is_test } = req.body; // exact contract: 0/1

  const isTest01 = is_test === 1 ? 1 : 0;

  try {
    await db.query(
      'UPDATE pogil_activities SET is_test = ? WHERE id = ?',
      [isTest01, id]
    );
    res.json({ id: Number(id), is_test: isTest01 });
  } catch (err) {
    console.error('setIsTest error:', err);
    res.status(500).json({ error: 'Failed to update is_test.' });
  }
};
