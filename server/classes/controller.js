const db = require('../db');
const { toPlain } = require('../utils/dbHelpers');
const { extractGoogleFileId } = require('../utils/googleIds');
const { fetchGoogleDocLinesByUrl } = require('../utils/activityContent');

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
  const { name, description, level = null, topic_domain = null, createdBy } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO pogil_classes (name, description, level, topic_domain, created_by) VALUES (?, ?, ?, ?, ?)',
      [name, description, level, topic_domain, createdBy]
    );
    res.status(201).json({
      id: Number(result.insertId),
      name,
      description,
      level,
      topic_domain,
      created_by: createdBy,
    });
  } catch (err) {
    console.error("Error creating class:", err);
    res.status(500).json({ error: 'Failed to create class' });
  }
};

exports.updateClass = async (req, res) => {
  const { name, description, level = null, topic_domain = null } = req.body;
  try {
    await db.query(
      'UPDATE pogil_classes SET name = ?, description = ?, level = ?, topic_domain = ? WHERE id = ?',
      [name, description, level, topic_domain, req.params.id]
    );
    res.json({ id: req.params.id, name, description, level, topic_domain });
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
  const {
    name,
    title,
    sheet_url,
    order_index,
    createdBy,
    source_type = 'remote',
    content_text = null,
  } = req.body;

  if (!name || !title || order_index === undefined || createdBy === undefined) {
    return res.status(400).json({
      error: 'Missing required fields',
      received: { name, title, sheet_url, order_index, createdBy, source_type }
    });
  }

  const normalizedSourceType = String(source_type || 'remote').toLowerCase() === 'local'
    ? 'local'
    : 'remote';

  if (normalizedSourceType === 'remote' && (!sheet_url || String(sheet_url).trim() === '')) {
    return res.status(400).json({ error: 'Remote activities require a Google Sheet or Doc URL.' });
  }

  if (normalizedSourceType === 'local' && (content_text == null || String(content_text) === '')) {
    return res.status(400).json({ error: 'Local activities require content_text.' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO pogil_activities
         (name, title, sheet_url, source_type, content_text, order_index, class_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        title,
        normalizedSourceType === 'remote' ? sheet_url : null,
        normalizedSourceType,
        normalizedSourceType === 'local' ? content_text : null,
        order_index,
        classId,
        createdBy,
      ]
    );

    res.status(201).json({
      id: Number(result.insertId),
      name,
      title,
      sheet_url: normalizedSourceType === 'remote' ? sheet_url : null,
      source_type: normalizedSourceType,
      content_text: normalizedSourceType === 'local' ? content_text : null,
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

const { getFilesInFolder, getFileMetadata } = require('../utils/googleDrive');

function slugifyActivityName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

function isGoogleFolderUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'drive.google.com' && parsed.pathname.includes('/folders/');
  } catch {
    return false;
  }
}

async function getNextOrderIndex(classId) {
  const [[row]] = await db.query(
    `SELECT COALESCE(MAX(order_index), -1) AS max_order
       FROM pogil_activities
      WHERE class_id = ?`,
    [classId]
  );
  return Number(row?.max_order ?? -1) + 1;
}

async function getUniqueActivityName(baseName, classId) {
  const normalizedBase = slugifyActivityName(baseName) || `activity_${Date.now()}`;

  const [existing] = await db.query(
    `SELECT name FROM pogil_activities WHERE class_id = ? AND name LIKE ?`,
    [classId, `${normalizedBase}%`]
  );

  const taken = new Set(existing.map((row) => row.name));
  if (!taken.has(normalizedBase)) {
    return normalizedBase;
  }

  let suffix = 2;
  while (taken.has(`${normalizedBase}_${suffix}`)) {
    suffix += 1;
  }
  return `${normalizedBase}_${suffix}`;
}

async function insertImportedActivity({
  classId,
  createdBy,
  title,
  orderIndex,
  googleUrl,
  importMode,
}) {
  const name = await getUniqueActivityName(title, classId);

  if (importMode === 'local') {
    const lines = await fetchGoogleDocLinesByUrl(googleUrl);
    const contentText = lines.join('\n');

    const [result] = await db.query(
      `INSERT INTO pogil_activities
         (name, title, sheet_url, source_type, content_text, order_index, class_id, created_by)
       VALUES (?, ?, ?, 'local', ?, ?, ?, ?)`,
      [name, title, null, contentText, orderIndex, classId, createdBy]
    );

    return {
      id: Number(result.insertId),
      name,
      title,
      sheet_url: null,
      source_type: 'local',
      content_text: contentText,
      order_index: orderIndex,
      class_id: Number(classId),
      created_by: createdBy,
    };
  }

  const [result] = await db.query(
    `INSERT INTO pogil_activities
       (name, title, sheet_url, source_type, content_text, order_index, class_id, created_by)
     VALUES (?, ?, ?, 'remote', NULL, ?, ?, ?)`,
    [name, title, googleUrl, orderIndex, classId, createdBy]
  );

  return {
    id: Number(result.insertId),
    name,
    title,
    sheet_url: googleUrl,
    source_type: 'remote',
    content_text: null,
    order_index: orderIndex,
    class_id: Number(classId),
    created_by: createdBy,
  };
}

exports.importFolderActivities = async (req, res) => {
  const { id: classId } = req.params;
  const { folderUrl, import_mode = 'remote' } = req.body;
  const createdBy = req.user.id;
  const importMode = String(import_mode || 'remote').toLowerCase() === 'local' ? 'local' : 'remote';

  try {
    const folderId = extractGoogleFileId(folderUrl);
    if (!folderId) {
      return res.status(400).json({ error: 'Invalid folder URL' });
    }

    const files = await getFilesInFolder(folderId);
    const inserted = [];
    const nextOrderIndex = await getNextOrderIndex(classId);
    const sortedFiles = files.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    for (const [index, file] of sortedFiles.entries()) {
      const metadata = await getFileMetadata(file.id);
      const title = metadata.name;
      const googleUrl = `https://docs.google.com/document/d/${file.id}`;

      const item = await insertImportedActivity({
        classId,
        createdBy,
        title,
        orderIndex: nextOrderIndex + index,
        googleUrl,
        importMode,
      });

      inserted.push(item);
    }

    res.json({ imported: inserted, import_mode: importMode });
  } catch (err) {
    console.error('Import folder error:', err);
    res.status(500).json({ error: 'Failed to import from folder.' });
  }
};

exports.importGoogleActivities = async (req, res) => {
  const { id: classId } = req.params;
  const { url, import_mode = 'remote' } = req.body;
  const createdBy = req.user.id;
  const importMode = String(import_mode || 'remote').toLowerCase() === 'local' ? 'local' : 'remote';

  if (!url || String(url).trim() === '') {
    return res.status(400).json({ error: 'A Google Doc, Sheet, or folder link is required.' });
  }

  const trimmedUrl = String(url).trim();

  if (isGoogleFolderUrl(trimmedUrl)) {
    req.body.folderUrl = trimmedUrl;
    req.body.import_mode = importMode;
    return exports.importFolderActivities(req, res);
  }

  const googleId = extractGoogleFileId(trimmedUrl);
  if (!googleId) {
    return res.status(400).json({ error: 'Invalid Google URL.' });
  }

  if (importMode === 'local' && !trimmedUrl.includes('/document/')) {
    return res.status(400).json({ error: 'Import into local currently supports Google Docs only.' });
  }

  try {
    const metadata = await getFileMetadata(googleId);
    const nextOrderIndex = await getNextOrderIndex(classId);
    const item = await insertImportedActivity({
      classId,
      createdBy,
      title: metadata.name,
      orderIndex: nextOrderIndex,
      googleUrl: trimmedUrl,
      importMode,
    });

    res.status(201).json({ imported: [item], import_mode: importMode });
  } catch (err) {
    console.error('Google import error:', err);
    res.status(500).json({ error: 'Failed to import from Google.' });
  }
};
