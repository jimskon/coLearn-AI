const db = require('../db');
const { toPlain } = require('../utils/dbHelpers');
const { extractGoogleFileId } = require('../utils/googleIds');
const { inferActivityTypeFromActivity } = require('../utils/activityType');
const { verifyCourseFolderAccess } = require('../utils/courseFolder');
const { getFilesInFolder, getFileMetadata } = require('../utils/googleDrive');
const { createLocalActivityDoc } = require('../utils/localActivityDocs');

async function reconcileClassActivitySources(classId, folderId) {
  const [activities] = await db.query(
    `SELECT id, sheet_url, source_type
       FROM pogil_activities
      WHERE class_id = ?`,
    [classId]
  );

  let reconciled = 0;

  for (const activity of activities) {
    if (activity.source_type === 'local') {
      continue;
    }

    const fileId = extractGoogleFileId(activity.sheet_url);
    if (!fileId) {
      continue;
    }

    try {
      const metadata = await getFileMetadata(fileId);
      const parents = Array.isArray(metadata.parents) ? metadata.parents : [];
      if (!parents.includes(folderId)) {
        continue;
      }

      await db.query(
        `UPDATE pogil_activities
            SET source_type = 'local'
          WHERE id = ?`,
        [activity.id]
      );
      reconciled += 1;
    } catch (err) {
      console.warn(`Could not reconcile activity ${activity.id}:`, err.message);
    }
  }

  return reconciled;
}

function slugifyActivityName(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'new_activity';
}

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
    const activityType = await inferActivityTypeFromActivity({
      sheet_url,
      is_test: 0,
    });
    const isTest = activityType === 'test' ? 1 : 0;
    const sourceType = 'external';

    const [result] = await db.query(
      `INSERT INTO pogil_activities
       (name, title, sheet_url, order_index, class_id, created_by, is_test, source_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, title, sheet_url, order_index, classId, createdBy, isTest, sourceType]
    );

    // ✅ RETURN THE INSERTED ID
    res.status(201).json({
      id: Number(result.insertId),          // <--- THIS IS THE FIX
      name,
      title,
      sheet_url,
      order_index,
      class_id: Number(classId),
      created_by: createdBy,
      is_test: isTest,
      activity_type: activityType,
      source_type: sourceType,
    });
  } catch (err) {
    console.error('Error creating activity:', err);
    res.status(500).json({ error: 'Failed to create activity.' });
  }
};

exports.createLocalActivityForClass = async (req, res) => {
  const classId = Number(req.params.id);
  const { title, createdBy, mode = 'group' } = req.body || {};

  if (!title || createdBy === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const [[classRow]] = await db.query(
      `SELECT id, google_folder_id, google_folder_status
         FROM pogil_classes
        WHERE id = ?`,
      [classId]
    );

    if (!classRow) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (!classRow.google_folder_id || classRow.google_folder_status !== 'verified') {
      return res.status(400).json({ error: 'This class needs a verified folder before local activities can be created.' });
    }

    const [[orderRow]] = await db.query(
      `SELECT COALESCE(MAX(order_index), -1) AS max_order
         FROM pogil_activities
        WHERE class_id = ?`,
      [classId]
    );
    const orderIndex = Number(orderRow?.max_order ?? -1) + 1;

    const baseName = slugifyActivityName(title);
    let finalName = baseName;
    let suffix = 2;
    while (true) {
      const [[existing]] = await db.query(
        `SELECT id FROM pogil_activities WHERE name = ? AND class_id = ?`,
        [finalName, classId]
      );
      if (!existing) break;
      finalName = `${baseName}_${suffix}`;
      suffix += 1;
    }

    const doc = await createLocalActivityDoc({
      title,
      folderId: classRow.google_folder_id,
      mode,
    });

    const [result] = await db.query(
      `INSERT INTO pogil_activities
       (name, title, sheet_url, order_index, class_id, created_by, is_test, source_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [finalName, title, doc.url, orderIndex, classId, createdBy, mode === 'test' ? 1 : 0, 'local']
    );

    return res.status(201).json({
      id: Number(result.insertId),
      name: finalName,
      title,
      sheet_url: doc.url,
      order_index: orderIndex,
      class_id: classId,
      created_by: createdBy,
      is_test: mode === 'test' ? 1 : 0,
      source_type: 'local',
      activity_type: mode,
      editor_url: `/editor/${Number(result.insertId)}`,
    });
  } catch (err) {
    console.error('Error creating local activity:', err);
    return res.status(500).json({ error: 'Failed to create local activity.' });
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
    res.status(500).json({ error: "Error fetching joined instances" });
  }
};

exports.enrollByCode = async (req, res) => {
  const { userId, code } = req.body;

  try {
    const [results] = await db.query(`SELECT * FROM courses WHERE code = ?`, [code]);
    if (!results || results.length === 0) {
      return res.status(404).json({ error: "Join code not found" });
    }

    const course = { ...results[0] }; // ✅ Flatten

    const [existing] = await db.query(
      `SELECT * FROM course_enrollments WHERE student_id = ? AND course_id = ?`,
      [userId, course.id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: "Already joined this instance" });
    }

    await db.query(
      `INSERT INTO course_enrollments (student_id, course_id) VALUES (?, ?)`,
      [userId, course.id]
    );

    res.json({ success: true, newCourse: course });
  } catch (err) {
    console.error("Enrollment error:", err.message);
    res.status(500).json({ error: "Join failed" });
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

exports.getClassFolder = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT id, google_folder_url, google_folder_id, google_folder_name, google_folder_verified_at, google_folder_status
       FROM pogil_classes WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const row = rows[0];
    if (!row.google_folder_id) {
      return res.json({
        class_id: Number(row.id),
        has_folder: false,
      });
    }

    return res.json({
      class_id: Number(row.id),
      has_folder: true,
      folder_url: row.google_folder_url,
      folder_id: row.google_folder_id,
      folder_name: row.google_folder_name,
      status: row.google_folder_status,
      verified_at: row.google_folder_verified_at,
    });
  } catch (err) {
    console.error('Error fetching class folder:', err);
    return res.status(500).json({ error: 'Failed to get class folder' });
  }
};

exports.verifyClassFolder = async (req, res) => {
  const { folderUrl } = req.body || {};

  try {
    const result = await verifyCourseFolderAccess(folderUrl);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        folder_id: result.folderId,
        folder_name: result.folderName,
        writable: false,
        error: result.error,
      });
    }

    return res.json({
      ok: true,
      folder_id: result.folderId,
      folder_name: result.folderName,
      writable: true,
    });
  } catch (err) {
    console.error('Error verifying class folder:', err);
    return res.status(500).json({ error: 'Failed to verify class folder' });
  }
};

exports.saveClassFolder = async (req, res) => {
  const { id } = req.params;
  const { folderUrl } = req.body || {};

  try {
    const [existingRows] = await db.query('SELECT id FROM pogil_classes WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const result = await verifyCourseFolderAccess(folderUrl);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        folder_id: result.folderId,
        folder_name: result.folderName,
        writable: false,
        error: result.error,
      });
    }

    await db.query(
      `UPDATE pogil_classes
       SET google_folder_url = ?,
           google_folder_id = ?,
           google_folder_name = ?,
           google_folder_verified_at = NOW(),
           google_folder_status = 'verified'
       WHERE id = ?`,
      [folderUrl, result.folderId, result.folderName, id]
    );

    const reconciled_count = await reconcileClassActivitySources(id, result.folderId);

    return res.json({
      ok: true,
      folder_url: folderUrl,
      folder_id: result.folderId,
      folder_name: result.folderName,
      status: 'verified',
      reconciled_count,
    });
  } catch (err) {
    console.error('Error saving class folder:', err);
    return res.status(500).json({ error: 'Failed to save class folder' });
  }
};

exports.deleteClassFolder = async (req, res) => {
  const { id } = req.params;

  try {
    const [existingRows] = await db.query('SELECT id FROM pogil_classes WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    await db.query(
      `UPDATE pogil_classes
       SET google_folder_url = NULL,
           google_folder_id = NULL,
           google_folder_name = NULL,
           google_folder_verified_at = NULL,
           google_folder_status = NULL
       WHERE id = ?`,
      [id]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting class folder:', err);
    return res.status(500).json({ error: 'Failed to remove class folder' });
  }
};

exports.importFolderActivities = async (req, res) => {
  const { id: classId } = req.params;
  const { folderUrl } = req.body;
  const createdBy = req.user.id;

  console.log("Received import folder request:", req.body);


  try {
    const folderId = extractGoogleFileId(folderUrl);
    if (!folderId) {
      return res.status(400).json({ error: "Invalid folder URL" });
    }

    const [[classRow]] = await db.query(
      `SELECT google_folder_id FROM pogil_classes WHERE id = ?`,
      [classId]
    );
    if (!classRow) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const sourceType = classRow.google_folder_id && classRow.google_folder_id === folderId
      ? 'local'
      : 'external';

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

      const activityType = await inferActivityTypeFromActivity({
        sheet_url: url,
        is_test: 0,
      });
      const isTest = activityType === 'test' ? 1 : 0;

      const [result] = await db.query(
        `INSERT INTO pogil_activities
         (name, title, sheet_url, order_index, class_id, created_by, is_test, source_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, title, url, index + 1, classId, createdBy, isTest, sourceType]
      );

      inserted.push({
        id: Number(result.insertId),
        name,
        title,
        sheet_url: url,
        order_index: index + 1,
        class_id: Number(classId),
        created_by: createdBy,
        is_test: isTest,
        activity_type: activityType,
        source_type: sourceType,
      });
    }

    res.json({ imported: inserted });
  } catch (err) {
    console.error("Import folder error:", err);
    res.status(500).json({ error: "Failed to import from folder." });
  }
};
