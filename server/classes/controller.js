const db = require('../db');
const { toPlain } = require('../utils/dbHelpers');

// Get all classes
exports.getAllClasses = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM pogil_classes');
    res.json(toPlain(rows));
  } catch (err) {
    console.error("Error fetching classes:", err);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
};

exports.createClass = async (req, res) => {
  const { name, description, createdBy } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO pogil_classes (name, description, created_by) VALUES (?, ?, ?)',
      [name, description, createdBy]
    );
    res.status(201).json({ id: Number(result.insertId), name, description, created_by: createdBy });
  } catch (err) {
    console.error("Error creating class:", err);
    res.status(500).json({ error: 'Failed to create class' });
  }
};

exports.updateClass = async (req, res) => {
  const { name, description } = req.body;
  try {
    await db.query(
      'UPDATE pogil_classes SET name = ?, description = ? WHERE id = ?',
      [name, description, req.params.id]
    );
    res.json({ id: req.params.id, name, description });
  } catch (err) {
    console.error("Error updating class:", err);
    res.status(500).json({ error: 'Failed to update class' });
  }
};

exports.deleteClass = async (req, res) => {
  try {
    await db.query('DELETE FROM pogil_classes WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error("Error deleting class:", err);
    res.status(500).json({ error: 'Failed to delete class' });
  }
};

exports.getActivitiesByClass = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      'SELECT * FROM pogil_activities WHERE class_id = ? ORDER BY order_index',
      [id]
    );
    res.json(rows.map(r => ({ ...r })));
  } catch (err) {
    console.error('Error fetching class activities:', err);
    res.status(500).json({ error: 'Failed to retrieve activities for class.' });
  }
};

exports.createActivityForClass = async (req, res) => {
  const classId = req.params.id;
  const { name, title, sheet_url, order_index, createdBy } = req.body;

  if (!name || !title || order_index === undefined || createdBy === undefined) {
    return res.status(400).json({
      error: 'Missing required fields',
      received: { name, title, sheet_url, order_index, createdBy }
    });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO pogil_activities (name, title, sheet_url, order_index, class_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, title, sheet_url, order_index, classId, createdBy]
    );

    // ✅ RETURN THE INSERTED ID
    res.status(201).json({
      id: Number(result.insertId),          // <--- THIS IS THE FIX
      name,
      title,
      sheet_url,
      order_index,
      class_id: Number(classId),
      created_by: createdBy
    });
  } catch (err) {
    console.error('Error creating activity:', err);
    res.status(500).json({ error: 'Failed to create activity.' });
  }
};

exports.updateActivityForClass = async (req, res) => {
  const { id: classId, activityName } = req.params;
  const { title, sheet_url, order_index } = req.body;

  try {
    await db.query(
      'UPDATE pogil_activities SET title = ?, sheet_url = ?, order_index = ? WHERE name = ? AND class_id = ?',
      [title, sheet_url, order_index, activityName, classId]
    );

    res.json({ name: activityName, title, sheet_url, order_index, class_id: classId });
  } catch (err) {
    console.error('Error updating activity:', err);
    res.status(500).json({ error: 'Failed to update activity.' });
  }
};

exports.deleteActivityFromClass = async (req, res) => {
  const { classId, activityId } = req.params;
  console.log(`Deleting activity "${activityId}" from class ${classId}`);

  try {
    const [activity] = await db.query(
      `SELECT id FROM pogil_activities WHERE id = ? AND class_id = ?`,
      [activityId, classId]
    );

    if (!activity.length) {
      return res.status(404).json({ error: "Activity not found." });
    }

    const activityIdNum = activity[0].id;

    const [instances] = await db.query(
      `SELECT COUNT(*) AS count FROM activity_instances WHERE activity_id = ?`,
      [activityIdNum]
    );

    if (instances[0].count > 0) {
      return res.status(400).json({
        error: `This activity cannot be deleted because it has been assigned to ${instances[0].count} group(s). Please remove those assignments before deleting the activity.`
      });
    }

    await db.query(`DELETE FROM pogil_activities WHERE id = ?`, [activityIdNum]);
    res.json({ success: true });

  } catch (err) {
    console.error("Error deleting activity:", err);
    res.status(500).json({ error: "Server error." });
  }
};



exports.getUserEnrollments = async (req, res) => {
  const { userId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT c.* FROM courses c
       JOIN course_enrollments e ON c.id = e.course_id
       WHERE e.student_id = ?`,
      [userId]
    );
    res.json(toPlain(rows));
  } catch (err) {
    console.error("Error fetching enrollments:", err.message);
    res.status(500).json({ error: "Error fetching enrolled classes" });
  }
};

exports.enrollByCode = async (req, res) => {
  const { userId, code } = req.body;

  try {
    const [results] = await db.query(`SELECT * FROM courses WHERE code = ?`, [code]);
    if (!results || results.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    const course = { ...results[0] }; // ✅ Flatten

    const [existing] = await db.query(
      `SELECT * FROM course_enrollments WHERE student_id = ? AND course_id = ?`,
      [userId, course.id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: "Already enrolled" });
    }

    await db.query(
      `INSERT INTO course_enrollments (student_id, course_id) VALUES (?, ?)`,
      [userId, course.id]
    );

    res.json({ success: true, newCourse: course });
  } catch (err) {
    console.error("Enrollment error:", err.message);
    res.status(500).json({ error: "Enrollment failed" });
  }
};

exports.getClassById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM pogil_classes WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }
    console.log("Class found:", rows[0]);
    res.json(toPlain(rows[0]));
  } catch (err) {
    console.error("Error fetching class:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

const { getFilesInFolder, getFileMetadata } = require('../utils/googleDrive'); // helper you'll create below

exports.importFolderActivities = async (req, res) => {
  const { id: classId } = req.params;
  const { folderUrl } = req.body;
  const createdBy = req.user.id;

  console.log("Received import folder request:", req.body);


  try {
    const folderIdMatch = folderUrl.match(/[-\w]{25,}/);
    if (!folderIdMatch) {
      return res.status(400).json({ error: "Invalid folder URL" });
    }

    const folderId = folderIdMatch[0];
    const files = await getFilesInFolder(folderId);
    console.log(`Found ${files.length} files in folder ${folderId}`);

    const inserted = [];

    const sortedFiles = files.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    for (const [index, file] of sortedFiles.entries()) {
      const metadata = await getFileMetadata(file.id);
      const title = metadata.name;
      const url = `https://docs.google.com/document/d/${file.id}`;

      const name = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      // Check for existing activity with same name in this class
      const [existing] = await db.query(
        `SELECT id FROM pogil_activities WHERE name = ? AND class_id = ?`,
        [name, classId]
      );

      if (existing.length > 0) {
        console.log(`⚠️ Skipping duplicate: ${name}`);
        continue; // skip to next file
      }

      const [result] = await db.query(
        `INSERT INTO pogil_activities (name, title, sheet_url, order_index, class_id, created_by)
   VALUES (?, ?, ?, ?, ?, ?)`,
        [name, title, url, index + 1, classId, createdBy]
      );

      inserted.push({
        id: Number(result.insertId),
        name,
        title,
        sheet_url: url,
        order_index: index + 1,
        class_id: Number(classId),
        created_by: createdBy
      });
    }

    res.json({ imported: inserted });
  } catch (err) {
    console.error("Import folder error:", err);
    res.status(500).json({ error: "Failed to import from folder." });
  }
};
