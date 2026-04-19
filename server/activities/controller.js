// server/activities/controller.js
const db = require('../db');

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
    res.json({ ...rows[0] }); // ✅ flatten the single result into an object
  } catch (err) {
    res.status(500).json({ error: 'Could not retrieve activity.' });
  }
};

// Launch a new activity instance by activity ID
exports.launchActivityInstance = async (req, res) => {
  const { courseId, groupNumber } = req.body;
  const activityId = req.params.id;

  try {
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
  const { id } = req.params;
  console.log("Deleting activity ID:", id);

  try {
    await db.query('DELETE FROM pogil_activities WHERE id = ?', [id]);
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
