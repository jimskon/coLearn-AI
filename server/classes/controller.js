const db = require('../db');
const { toPlain } = require('../utils/dbHelpers');
const { extractGoogleFileId } = require('../utils/googleIds');
const { fetchGoogleDocLinesByUrl, sourceHash } = require('../utils/activityContent');
const activityCreator = require('../utils/activityCreator');
const { inferAuthoredModeFromActivity } = require('../utils/activityType');
const { ensureDemoModeSchema } = require('../utils/demoModeSchema');
const { ensureActivitySourceSchema } = require('../utils/activitySourceSchema');
const { recordAuditEvent } = require('../utils/auditLogger');

const CREATOR_MODEL_OPTIONS = new Set([
  'gpt-4o-mini',
  'gpt-5-mini',
  'gpt-4o',
  'gpt-5.1',
  'gpt-5.2',
]);

const CREATOR_MAJOR_SECTION_OPTIONS = [
  'Learning Objectives',
  'Exploration',
  'Concept Invention',
  'Application',
  'Reflection',
];

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1
    `,
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(conn, tableName, columnName) {
  const [rows] = await conn.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function deleteByInstanceIdsIfPresent(conn, tableName, fkColumn, instanceIds) {
  if (
    !instanceIds.length ||
    !(await tableExists(conn, tableName)) ||
    !(await columnExists(conn, tableName, fkColumn))
  ) {
    return 0;
  }
  const [result] = await conn.query(
    `DELETE FROM ${tableName} WHERE ${fkColumn} IN (?)`,
    [instanceIds]
  );
  return Number(result.affectedRows || 0);
}

async function deleteByResponseIdsIfPresent(conn, tableName, fkColumn, responseIds) {
  if (
    !responseIds.length ||
    !(await tableExists(conn, tableName)) ||
    !(await columnExists(conn, tableName, fkColumn))
  ) {
    return 0;
  }
  const [result] = await conn.query(
    `DELETE FROM ${tableName} WHERE ${fkColumn} IN (?)`,
    [responseIds]
  );
  return Number(result.affectedRows || 0);
}

// Get all classes
exports.getAllClasses = async (req, res) => {
  try {
    await ensureDemoModeSchema();
    const [rows] = await db.query('SELECT * FROM pogil_classes');
    res.json(toPlain(rows));
  } catch (err) {
    console.error("Error fetching classes:", err);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
};

exports.createClass = async (req, res) => {
  const {
    name,
    description,
    level = null,
    topic_domain = null,
    demo_mode = false,
    ai_guidance = null,
    createdBy,
  } = req.body;
  try {
    await ensureDemoModeSchema();
    const [result] = await db.query(
      'INSERT INTO pogil_classes (name, description, level, topic_domain, demo_mode, ai_guidance, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, description, level, topic_domain, demo_mode ? 1 : 0, ai_guidance, createdBy]
    );
    res.status(201).json({
      id: Number(result.insertId),
      name,
      description,
      level,
      topic_domain,
      demo_mode: Boolean(demo_mode),
      ai_guidance,
      created_by: createdBy,
    });
    void recordAuditEvent('class_created', {
      req,
      userId: createdBy,
      classId: Number(result.insertId),
      details: { name, demo_mode: Boolean(demo_mode), level, topic_domain },
    });
  } catch (err) {
    console.error("Error creating class:", err);
    res.status(500).json({ error: 'Failed to create class' });
  }
};

exports.updateClass = async (req, res) => {
  const {
    name,
    description,
    level = null,
    topic_domain = null,
    demo_mode = false,
    ai_guidance = null,
  } = req.body;
  try {
    await ensureDemoModeSchema();
    await db.query(
      'UPDATE pogil_classes SET name = ?, description = ?, level = ?, topic_domain = ?, demo_mode = ?, ai_guidance = ? WHERE id = ?',
      [name, description, level, topic_domain, demo_mode ? 1 : 0, ai_guidance, req.params.id]
    );
    res.json({
      id: req.params.id,
      name,
      description,
      level,
      topic_domain,
      demo_mode: Boolean(demo_mode),
      ai_guidance,
    });
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
    const enriched = await Promise.all(rows.map(async (row) => {
      const mode = await inferAuthoredModeFromActivity(row);
      return {
        ...row,
        mode,
      };
    }));
    res.json(enriched.map(r => ({ ...r })));
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

  if (normalizedSourceType === 'local' && content_text == null) {
    return res.status(400).json({ error: 'Local activities require content_text.' });
  }

  try {
    await ensureActivitySourceSchema();
    const [result] = await db.query(
      `INSERT INTO pogil_activities
         (name, title, sheet_url, source_type, content_text, source_updated_at, order_index, class_id, created_by)
       VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'local' THEN NOW(3) ELSE NULL END, ?, ?, ?)`,
      [
        name,
        title,
        normalizedSourceType === 'remote' ? sheet_url : null,
        normalizedSourceType,
        normalizedSourceType === 'local' ? content_text : null,
        normalizedSourceType,
        order_index,
        classId,
        createdBy,
      ]
    );

    const [[created]] = await db.query(
      'SELECT source_updated_at FROM pogil_activities WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      id: Number(result.insertId),
      name,
      title,
      sheet_url: normalizedSourceType === 'remote' ? sheet_url : null,
      source_type: normalizedSourceType,
      content_text: normalizedSourceType === 'local' ? content_text : null,
      source_updated_at: created?.source_updated_at || null,
      order_index,
      class_id: Number(classId),
      created_by: createdBy
    });
    void recordAuditEvent('activity_created', {
      req,
      userId: createdBy,
      classId: Number(classId),
      activityId: Number(result.insertId),
      details: {
        name,
        title,
        source_type: normalizedSourceType,
        order_index,
      },
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
    await ensureActivitySourceSchema();
    const [[existing]] = await db.query(
      `SELECT id, sheet_url
         FROM pogil_activities
        WHERE name = ? AND class_id = ?`,
      [activityName, classId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Activity not found.' });
    }

    const previousUrl = String(existing.sheet_url || '').trim();
    const nextUrl = String(sheet_url || '').trim();
    const linkedDocumentChanged = previousUrl !== nextUrl;

    await db.query(
      `UPDATE pogil_activities
          SET title = ?,
              sheet_url = ?,
              order_index = ?,
              remote_source_hash = CASE WHEN ? THEN NULL ELSE remote_source_hash END,
              remote_updated_at = CASE WHEN ? THEN NULL ELSE remote_updated_at END,
              last_synced_hash = CASE WHEN ? THEN NULL ELSE last_synced_hash END,
              last_synced_at = CASE WHEN ? THEN NULL ELSE last_synced_at END
        WHERE id = ?`,
      [
        title,
        nextUrl || null,
        order_index,
        linkedDocumentChanged,
        linkedDocumentChanged,
        linkedDocumentChanged,
        linkedDocumentChanged,
        existing.id,
      ]
    );

    res.json({
      name: activityName,
      title,
      sheet_url: nextUrl || null,
      order_index,
      class_id: classId,
      remote_link_changed: linkedDocumentChanged,
    });
  } catch (err) {
    console.error('Error updating activity:', err);
    res.status(500).json({ error: 'Failed to update activity.' });
  }
};

async function countActivityResponses(activityId) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM responses r
       JOIN activity_instances ai ON ai.id = r.activity_instance_id
      WHERE ai.activity_id = ?`,
    [activityId]
  );
  return Number(row?.cnt || 0);
}

// Replace the content of existing activities from a downloaded JSON bundle
// (see handleDownloadSelected / handleUpload in ManageActivitiesPage.jsx).
// Items are matched by id within this class. Any activity that already has
// student responses is reported back as "blocked" instead of being changed,
// unless its id is included in force_ids.
exports.replaceActivitiesBundle = async (req, res) => {
  const classId = Number(req.params.id);
  const actorRole = String(req.user?.role || '').toLowerCase();
  const items = Array.isArray(req.body?.activities) ? req.body.activities : [];
  const forceIds = new Set(
    (Array.isArray(req.body?.force_ids) ? req.body.force_ids : []).map((id) => Number(id))
  );

  if (!classId) return res.status(400).json({ error: 'Invalid class id.' });
  if (!['root', 'creator', 'instructor'].includes(actorRole)) {
    return res.status(403).json({ error: 'Only instructors, creators, or root can replace activities.' });
  }
  if (!items.length) {
    return res.status(400).json({ error: 'No activities were provided to replace.' });
  }

  const replaced = [];
  const blocked = [];
  const skipped = [];

  try {
    await ensureActivitySourceSchema();

    for (const item of items) {
      const activityId = Number(item?.id);
      if (!activityId) {
        skipped.push({ id: null, name: item?.name || null, reason: 'Missing activity id.' });
        continue;
      }

      const [[existing]] = await db.query(
        `SELECT id, name, title FROM pogil_activities WHERE id = ? AND class_id = ?`,
        [activityId, classId]
      );
      if (!existing) {
        skipped.push({ id: activityId, name: item?.name || null, reason: 'Activity not found in this class.' });
        continue;
      }

      const responseCount = await countActivityResponses(activityId);
      if (responseCount > 0 && !forceIds.has(activityId)) {
        blocked.push({
          id: activityId,
          name: existing.name,
          title: existing.title,
          response_count: responseCount,
        });
        continue;
      }

      const title = String(item?.title || existing.title || '').trim() || existing.title;
      const contentText = String(item?.content_text ?? item?.text ?? '');
      const sourceType = String(item?.source_type || 'local').toLowerCase() === 'remote' ? 'remote' : 'local';
      const sheetUrl = sourceType === 'remote' ? (item?.sheet_url || null) : null;
      const orderIndex = Number.isFinite(Number(item?.order_index)) ? Number(item.order_index) : null;
      const localHash = sourceType === 'local' ? sourceHash(contentText) : null;

      await db.query(
        `UPDATE pogil_activities
            SET title = ?,
                content_text = ?,
                source_type = ?,
                sheet_url = ?,
                order_index = COALESCE(?, order_index),
                source_updated_at = NOW(3),
                source_revision = source_revision + 1,
                source_origin = 'bundle_replace',
                local_source_hash = ?,
                remote_source_hash = CASE WHEN ? = 'remote' THEN remote_source_hash ELSE NULL END
          WHERE id = ?`,
        [title, contentText, sourceType, sheetUrl, orderIndex, localHash, sourceType, activityId]
      );

      replaced.push({ id: activityId, name: existing.name, title, response_count: responseCount });
    }

    void recordAuditEvent('activities_bundle_replaced', {
      req,
      userId: req.user?.id || null,
      classId,
      details: {
        replaced_count: replaced.length,
        blocked_count: blocked.length,
        skipped_count: skipped.length,
      },
    });

    return res.json({ replaced, blocked, skipped });
  } catch (err) {
    console.error('Error replacing activities bundle:', err);
    return res.status(500).json({ error: 'Failed to replace activities.' });
  }
};

// Attach the Google Docs created by the instructor-owned Apps Script to the
// existing local activities. coLearn never writes to Google: it only receives
// the mapping file produced by that script.
exports.importGoogleExportMapping = async (req, res) => {
  const classId = Number(req.params.id);
  const actorRole = String(req.user?.role || '').toLowerCase();
  const mappingClassId = Number(req.body?.class_id);
  const mappings = Array.isArray(req.body?.activities) ? req.body.activities : [];

  if (!classId) return res.status(400).json({ error: 'Invalid class id.' });
  if (mappingClassId && mappingClassId !== classId) {
    return res.status(400).json({ error: 'This Google export mapping belongs to a different class.' });
  }
  if (!['root', 'creator', 'instructor'].includes(actorRole)) {
    return res.status(403).json({ error: 'Only instructors, creators, or root can attach Google Docs.' });
  }
  if (!mappings.length) {
    return res.status(400).json({ error: 'The mapping file does not contain any activities.' });
  }

  const seenIds = new Set();
  const requestedIds = [];
  for (const mapping of mappings) {
    const activityId = Number(mapping?.activity_id ?? mapping?.id);
    if (!activityId || seenIds.has(activityId)) {
      return res.status(400).json({ error: 'Each mapping must contain one unique activity_id.' });
    }
    seenIds.add(activityId);
    requestedIds.push(activityId);
  }

  try {
    await ensureActivitySourceSchema();
    const [activities] = await db.query(
      `SELECT id, name, title, content_text
         FROM pogil_activities
        WHERE class_id = ? AND id IN (?)`,
      [classId, requestedIds]
    );
    const activityById = new Map(activities.map((activity) => [Number(activity.id), activity]));
    const attached = [];
    const skipped = [];
    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();
      for (const mapping of mappings) {
        const activityId = Number(mapping?.activity_id ?? mapping?.id);
        const activity = activityById.get(activityId);
        const googleDocUrl = String(mapping?.google_doc_url ?? mapping?.sheet_url ?? '').trim();

        if (!activity) {
          skipped.push({ activity_id: activityId, reason: 'Activity is not part of this class.' });
          continue;
        }
        if (!activity.content_text) {
          skipped.push({ activity_id: activityId, name: activity.name, reason: 'Activity has no saved local markup.' });
          continue;
        }
        if (!extractGoogleFileId(googleDocUrl)) {
          skipped.push({ activity_id: activityId, name: activity.name, reason: 'Mapping does not contain a valid Google Doc URL.' });
          continue;
        }

        const currentHash = sourceHash(activity.content_text);
        const exportedHash = String(mapping?.content_hash || '').trim().toLowerCase();
        if (exportedHash && exportedHash !== currentHash) {
          skipped.push({
            activity_id: activityId,
            name: activity.name,
            reason: 'Local markup changed after this export. Download a fresh bundle before attaching this Doc.',
          });
          continue;
        }

        await conn.query(
          `UPDATE pogil_activities
              SET sheet_url = ?,
                  local_source_hash = ?,
                  remote_source_hash = NULL,
                  remote_updated_at = NULL,
                  last_synced_hash = NULL,
                  last_synced_at = NULL
            WHERE id = ?`,
          [googleDocUrl, currentHash, activityId]
        );
        attached.push({ activity_id: activityId, name: activity.name, title: activity.title, google_doc_url: googleDocUrl });
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    void recordAuditEvent('activity_google_export_mapping_imported', {
      req,
      userId: req.user?.id || null,
      classId,
      details: { attached_count: attached.length, skipped_count: skipped.length },
    });
    return res.json({ attached, skipped });
  } catch (err) {
    console.error('Failed to attach Google export mapping:', err);
    return res.status(500).json({ error: 'Could not attach the Google export mapping.' });
  }
};

exports.deleteActivityFromClass = async (req, res) => {
  const { classId, activityId } = req.params;
  console.log(`Deleting activity "${activityId}" from class ${classId}`);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [activity] = await conn.query(
      `SELECT id FROM pogil_activities WHERE id = ? AND class_id = ?`,
      [activityId, classId]
    );

    if (!activity.length) {
      await conn.rollback();
      return res.status(404).json({ error: "Activity not found." });
    }

    const activityIdNum = activity[0].id;
    const [instances] = await conn.query(
      `SELECT id FROM activity_instances WHERE activity_id = ?`,
      [activityIdNum]
    );
    const instanceIds = instances.map((row) => Number(row.id)).filter(Number.isFinite);
    let responseIds = [];

    if (instanceIds.length && await tableExists(conn, 'responses')) {
      const [responses] = await conn.query(
        `SELECT id FROM responses WHERE activity_instance_id IN (?)`,
        [instanceIds]
      );
      responseIds = responses.map((row) => Number(row.id)).filter(Number.isFinite);
    }

    await deleteByInstanceIdsIfPresent(conn, 'activity_heartbeats', 'activity_instance_id', instanceIds);
    await deleteByInstanceIdsIfPresent(conn, 'audit_log', 'activity_instance_id', instanceIds);
    await deleteByInstanceIdsIfPresent(conn, 'event_log', 'activity_instance_id', instanceIds);
    await deleteByResponseIdsIfPresent(conn, 'followups', 'response_id', responseIds);
    await deleteByResponseIdsIfPresent(conn, 'feedback', 'response_id', responseIds);
    await deleteByInstanceIdsIfPresent(conn, 'response_drafts', 'activity_instance_id', instanceIds);
    await deleteByInstanceIdsIfPresent(conn, 'responses', 'activity_instance_id', instanceIds);
    await deleteByInstanceIdsIfPresent(conn, 'group_members', 'activity_instance_id', instanceIds);

    if (instanceIds.length) {
      await conn.query(`DELETE FROM activity_instances WHERE id IN (?)`, [instanceIds]);
    }

    await conn.query(`DELETE FROM pogil_activities WHERE id = ?`, [activityIdNum]);
    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error("Error deleting activity:", err);
    res.status(500).json({ error: "Server error." });
  } finally {
    conn.release();
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
    await ensureDemoModeSchema();
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

exports.createCreatorDraft = async (req, res) => {
  const classId = req.params.id;
  const {
    title,
    duration_minutes,
    mode = 'group',
    description,
    selected_model = 'gpt-5-mini',
    major_sections = CREATOR_MAJOR_SECTION_OPTIONS,
    use_timed_sections = false,
    timed_sections = [],
    retries_required = 3,
    language = 'English',
    createdBy,
  } = req.body || {};

  const normalizedTitle = String(title || '').trim();
  const normalizedDescription = String(description || '').trim();
  const durationMinutes = Number(duration_minutes);
  const normalizedMode = String(mode || 'group').trim().toLowerCase();
  const normalizedSelectedModel = String(selected_model || 'gpt-5-mini').trim();
  const normalizedSectionlessMode = normalizedMode === 'test' || normalizedMode === 'assignment';
  const normalizedMajorSections = normalizedSectionlessMode
    ? []
    : Array.isArray(major_sections)
      ? CREATOR_MAJOR_SECTION_OPTIONS.filter((sectionName) => major_sections.includes(sectionName))
      : [];
  const normalizedUseTimedSections = normalizedSectionlessMode ? false : use_timed_sections === true;
  const normalizedRetriesRequired = Math.max(0, Math.round(Number(retries_required) || 0));
  const normalizedLanguage = String(language || 'English')
    .replace(/[{}\r\n]+/g, ' ')
    .trim()
    .slice(0, 80) || 'English';
  const normalizedTimedSections = normalizedUseTimedSections
    ? normalizedMajorSections.map((sectionName) => {
        const match = Array.isArray(timed_sections)
          ? timed_sections.find((section) => String(section?.title || '').trim() === sectionName)
          : null;
        return {
          title: sectionName,
          minutes: Math.round(Number(match?.minutes)),
        };
      })
    : [];

  if (!normalizedTitle || !normalizedDescription || !createdBy || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return res.status(400).json({
      error: 'title, description, duration_minutes, and createdBy are required.',
    });
  }

  if (!['group', 'playground', 'demo', 'test', 'assignment'].includes(normalizedMode)) {
    return res.status(400).json({ error: 'mode must be group, playground, demo, assignment, or test.' });
  }

  if (!CREATOR_MODEL_OPTIONS.has(normalizedSelectedModel)) {
    return res.status(400).json({ error: 'selected_model is not supported.' });
  }

  if (!normalizedSectionlessMode && !normalizedMajorSections.length) {
    return res.status(400).json({ error: 'major_sections must include at least one supported section.' });
  }

  if (normalizedUseTimedSections) {
    if (normalizedTimedSections.some((section) => !Number.isFinite(section.minutes) || section.minutes <= 0)) {
      return res.status(400).json({ error: 'timed_sections must provide a positive whole-number duration for each selected section.' });
    }

    const totalTimedMinutes = normalizedTimedSections.reduce((sum, section) => sum + section.minutes, 0);
    if (totalTimedMinutes !== Math.round(durationMinutes)) {
      return res.status(400).json({ error: 'timed_sections must add up to duration_minutes.' });
    }
  }

  try {
    const [classes] = await db.query(
      'SELECT id, name, description, level, topic_domain, ai_guidance FROM pogil_classes WHERE id = ?',
      [classId]
    );

    if (!classes.length) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const classRow = classes[0];
    const orderIndex = await getNextOrderIndex(classId);
    const name = await getUniqueActivityName(normalizedTitle, classId);
    const generation = await activityCreator.generateActivityDraft({
      title: normalizedTitle,
      mode: normalizedMode,
      durationMinutes: Math.round(durationMinutes),
      selectedModel: normalizedSelectedModel,
      majorSections: normalizedMajorSections,
      timedSections: normalizedTimedSections,
      retriesRequired: normalizedRetriesRequired,
      language: normalizedLanguage,
      classLevel: classRow.level,
      classTopicDomain: classRow.topic_domain,
      classDescription: classRow.description,
      activityDescription: normalizedDescription,
    });
    const generatedText = String(generation.text || '');
    const languageLine = `\\language{${normalizedLanguage}}`;
    const contentLines = generatedText.split('\n');
    const existingLanguageIndex = contentLines.findIndex((line) => /^\\language\{[\s\S]*\}\s*$/.test(line.trim()));
    if (existingLanguageIndex >= 0) {
      contentLines[existingLanguageIndex] = languageLine;
    } else {
      const modeIndex = contentLines.findIndex((line) => /^\\mode\{[\s\S]*\}\s*$/.test(line.trim()));
      contentLines.splice(modeIndex >= 0 ? modeIndex + 1 : 0, 0, languageLine);
    }
    const contentText = contentLines.join('\n');

    const [result] = await db.query(
      `INSERT INTO pogil_activities
         (name, title, sheet_url, source_type, content_text, order_index, class_id, created_by, is_test)
       VALUES (?, ?, NULL, 'local', ?, ?, ?, ?, ?)`,
      [
        name,
        normalizedTitle,
        contentText,
        orderIndex,
        classId,
        createdBy,
        normalizedMode === 'test' ? 1 : 0,
      ]
    );

    return res.status(201).json({
      id: Number(result.insertId),
      name,
      title: normalizedTitle,
      source_type: 'local',
      content_text: contentText,
      order_index: orderIndex,
      class_id: Number(classId),
      created_by: createdBy,
      mode: normalizedMode,
      duration_minutes: Math.round(durationMinutes),
      selected_model: normalizedSelectedModel,
      major_sections: normalizedMajorSections,
      use_timed_sections: normalizedUseTimedSections,
      timed_sections: normalizedTimedSections,
      retries_required: normalizedRetriesRequired,
      language: normalizedLanguage,
      generation_status: generation.generation_status,
      generation_error: generation.generation_error,
      generation_debug_preview: generation.raw_model_output
        ? String(generation.raw_model_output).slice(0, 500)
        : null,
    });
  } catch (err) {
    console.error('Error creating creator draft:', err);
    return res.status(500).json({ error: 'Failed to create draft activity.' });
  }
};

exports.reviseCreatorQuestion = async (req, res) => {
  const classId = Number(req.params.id);
  const activityId = Number(req.params.activityId);
  const {
    request,
    question_markup,
    selected_model = 'gpt-5-mini',
    group_title = '',
  } = req.body || {};
  const revisionRequest = String(request || '').trim();
  const questionMarkup = String(question_markup || '').trim();
  const normalizedSelectedModel = String(selected_model || 'gpt-5-mini').trim();

  if (!classId || !activityId) {
    return res.status(400).json({ error: 'Valid class and activity ids are required.' });
  }
  if (!revisionRequest || !questionMarkup) {
    return res.status(400).json({ error: 'request and question_markup are required.' });
  }
  if (!CREATOR_MODEL_OPTIONS.has(normalizedSelectedModel)) {
    return res.status(400).json({ error: 'selected_model is not supported.' });
  }

  try {
    const [[classRow]] = await db.query(
      'SELECT id, name, description, level, topic_domain, ai_guidance FROM pogil_classes WHERE id = ?',
      [classId]
    );
    if (!classRow) return res.status(404).json({ error: 'Class not found' });

    const [[activity]] = await db.query(
      `SELECT id, title
         FROM pogil_activities
        WHERE id = ? AND class_id = ?
        LIMIT 1`,
      [activityId, classId]
    );
    if (!activity) return res.status(404).json({ error: 'Draft activity not found for this class.' });

    const revision = await activityCreator.reviseQuestionDraft({
      questionMarkup,
      revisionRequest,
      selectedModel: normalizedSelectedModel,
      title: activity.title,
      classLevel: classRow.level,
      classTopicDomain: classRow.topic_domain,
      classDescription: classRow.description,
      groupTitle: String(group_title || '').trim(),
    });

    return res.json({
      activity_id: activityId,
      class_id: classId,
      proposedQuestionMarkup: revision.proposedQuestionMarkup,
      proposed_question_markup: revision.proposedQuestionMarkup,
      summary: revision.summary || [],
      warnings: revision.warnings || [],
      generation_status: revision.generation_status,
      generation_error: revision.generation_error,
    });
  } catch (err) {
    console.error('Error revising creator question:', err);
    return res.status(500).json({ error: 'Failed to revise question.' });
  }
};

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
