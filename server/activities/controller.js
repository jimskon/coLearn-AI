// server/activities/controller.js
const db = require('../db');
const { inferActivityTypeFromActivity } = require('../utils/activityType');
const {
  loadActivitySourceById,
  fetchGoogleDocLinesByUrl,
  fetchGoogleDocMetadataByUrl,
  sourceHash,
  sourceSyncStatus,
} = require('../utils/activityContent');
const { recordAuditEvent } = require('../utils/auditLogger');
const { ensureActivitySourceSchema } = require('../utils/activitySourceSchema');
const { ensureActivityEditLockSchema } = require('../utils/activityEditLockSchema');
const { validateActivityMarkup } = require('../../shared/activityMarkupValidation.cjs');
const { randomUUID } = require('crypto');

const EDIT_LEASE_SECONDS = 120;

function editorFromRequest(req) {
  const user = req.user;
  const role = String(user?.role || '').toLowerCase();
  if (!user?.id || !['root', 'creator', 'instructor'].includes(role)) return null;
  return user;
}

async function getActivityEditLease(activityId) {
  const [[lease]] = await db.query(
    `SELECT l.activity_id, l.user_id, l.lease_token, l.expires_at,
            u.name AS owner_name, u.email AS owner_email
       FROM activity_edit_locks l
       LEFT JOIN users u ON u.id = l.user_id
      WHERE l.activity_id = ? AND l.expires_at > NOW(3)`,
    [activityId],
  );
  return lease || null;
}

async function hasValidActivityEditLease(activityId, userId, token) {
  if (!token) return false;
  const [[lease]] = await db.query(
    `SELECT 1 AS valid
       FROM activity_edit_locks
      WHERE activity_id = ? AND user_id = ? AND lease_token = ? AND expires_at > NOW(3)`,
    [activityId, userId, token],
  );
  return Boolean(lease?.valid);
}

function extractTitleFromText(text) {
  const match = String(text || '').match(/^\\title\{([^}]*)\}/m);
  return match ? match[1].trim() : null;
}

async function getRemoteActivityStatus(activity) {
  if (!activity?.sheet_url) {
    const error = new Error('This activity does not have a linked Google Doc.');
    error.statusCode = 400;
    throw error;
  }

  const [remote, remoteLines] = await Promise.all([
    fetchGoogleDocMetadataByUrl(activity.sheet_url),
    fetchGoogleDocLinesByUrl(activity.sheet_url),
  ]);
  const remoteText = remoteLines.join('\n');
  const comparison = sourceSyncStatus({
    localText: activity.content_text,
    localUpdatedAt: activity.source_updated_at,
    remoteText,
    remoteUpdatedAt: remote.updated_at,
    lastSyncedHash: activity.last_synced_hash,
  });

  return { remote, remoteText, comparison };
}

function sqlDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

// Reading Google is enough to record what we observed. If the hashes match,
// this also establishes the shared base used for later conflict detection.
async function recordRemoteObservation(activity, status) {
  const hasLocalCopy = activity.content_text != null;
  const nowInSync = hasLocalCopy && status.comparison.state === 'in_sync';

  await db.query(
    `UPDATE pogil_activities
        SET local_source_hash = CASE WHEN ? THEN ? ELSE local_source_hash END,
            remote_source_hash = ?,
            remote_updated_at = ?,
            last_synced_hash = CASE WHEN ? THEN ? ELSE last_synced_hash END,
            last_synced_at = CASE WHEN ? THEN NOW(3) ELSE last_synced_at END
      WHERE id = ?`,
    [
      hasLocalCopy,
      hasLocalCopy ? status.comparison.local_hash : null,
      status.comparison.remote_hash,
      sqlDate(status.remote.updated_at),
      nowInSync,
      nowInSync ? status.comparison.local_hash : null,
      nowInSync,
      activity.id,
    ]
  );
}

// Create a new activity
exports.createActivity = async (req, res) => {
  const { name, title, sheet_url, createdBy, class_id, order_index = 0 } = req.body;
  console.log("Add activity:", req.body);

  if (!name || !title || !sheet_url || !class_id || !createdBy) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO pogil_activities 
        (name, title, sheet_url, created_by, class_id, order_index) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, title, sheet_url, createdBy, class_id, order_index]
    );
    void recordAuditEvent('activity_created', {
      req,
      userId: createdBy,
      classId: class_id,
      activityId: Number(result.insertId),
      details: {
        name,
        title,
        sheet_url,
        order_index,
        source: 'activities_controller',
      },
    });

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
    await ensureActivitySourceSchema();
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

exports.acquireActivityEditLease = async (req, res) => {
  const activityId = Number(req.params.id);
  const editor = editorFromRequest(req);
  if (!activityId || !editor) {
    return res.status(403).json({ error: 'Only signed-in instructors and creators can edit activities.' });
  }

  try {
    await ensureActivityEditLockSchema();
    const [[activity]] = await db.query('SELECT id FROM pogil_activities WHERE id = ?', [activityId]);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    const leaseToken = randomUUID();
    // This single statement safely replaces an expired lease, or refreshes a
    // lease for the same person. A live lease belonging to somebody else is
    // intentionally left untouched.
    await db.query(
      `INSERT INTO activity_edit_locks
          (activity_id, user_id, lease_token, acquired_at, expires_at)
       VALUES (?, ?, ?, NOW(3), DATE_ADD(NOW(3), INTERVAL ${EDIT_LEASE_SECONDS} SECOND))
       ON DUPLICATE KEY UPDATE
         user_id = IF(expires_at <= NOW(3) OR user_id = ?, VALUES(user_id), user_id),
         lease_token = IF(expires_at <= NOW(3) OR user_id = ?, VALUES(lease_token), lease_token),
         acquired_at = IF(expires_at <= NOW(3) OR user_id = ?, NOW(3), acquired_at),
         expires_at = IF(expires_at <= NOW(3) OR user_id = ?,
           DATE_ADD(NOW(3), INTERVAL ${EDIT_LEASE_SECONDS} SECOND), expires_at)`,
      [activityId, editor.id, leaseToken, editor.id, editor.id, editor.id, editor.id],
    );

    const lease = await getActivityEditLease(activityId);
    if (!lease || Number(lease.user_id) !== Number(editor.id) || lease.lease_token !== leaseToken) {
      return res.status(423).json({
        error: `${lease?.owner_name || lease?.owner_email || 'Another instructor'} is editing this activity.`,
        owner_name: lease?.owner_name || lease?.owner_email || 'Another instructor',
        expires_at: lease?.expires_at || null,
      });
    }

    return res.json({
      lease_token: leaseToken,
      expires_at: lease.expires_at,
      lease_seconds: EDIT_LEASE_SECONDS,
    });
  } catch (err) {
    console.error('acquireActivityEditLease error:', err);
    return res.status(500).json({ error: 'Could not start this editing session.' });
  }
};

exports.heartbeatActivityEditLease = async (req, res) => {
  const activityId = Number(req.params.id);
  const editor = editorFromRequest(req);
  const token = String(req.body?.lease_token || '');
  if (!activityId || !editor || !token) {
    return res.status(400).json({ error: 'An activity editing lease is required.' });
  }

  try {
    await ensureActivityEditLockSchema();
    const [result] = await db.query(
      `UPDATE activity_edit_locks
          SET expires_at = DATE_ADD(NOW(3), INTERVAL ${EDIT_LEASE_SECONDS} SECOND)
        WHERE activity_id = ? AND user_id = ? AND lease_token = ? AND expires_at > NOW(3)`,
      [activityId, editor.id, token],
    );
    if (!result.affectedRows) {
      return res.status(409).json({ error: 'Your editing lease expired or was replaced. Reload before saving.' });
    }
    const lease = await getActivityEditLease(activityId);
    return res.json({ expires_at: lease?.expires_at || null, lease_seconds: EDIT_LEASE_SECONDS });
  } catch (err) {
    console.error('heartbeatActivityEditLease error:', err);
    return res.status(500).json({ error: 'Could not renew the editing session.' });
  }
};

exports.releaseActivityEditLease = async (req, res) => {
  const activityId = Number(req.params.id);
  const editor = editorFromRequest(req);
  const token = String(req.body?.lease_token || '');
  if (!activityId || !editor || !token) return res.status(204).end();

  try {
    await ensureActivityEditLockSchema();
    await db.query(
      'DELETE FROM activity_edit_locks WHERE activity_id = ? AND user_id = ? AND lease_token = ?',
      [activityId, editor.id, token],
    );
    return res.status(204).end();
  } catch (err) {
    console.error('releaseActivityEditLease error:', err);
    return res.status(500).json({ error: 'Could not close the editing session.' });
  }
};

exports.getActivitySource = async (req, res) => {
  const { id } = req.params;

  try {
    await ensureActivitySourceSchema();
    const source = await loadActivitySourceById(db, id);
    if (!source) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    return res.json({
      activity_id: Number(id),
      source_type: source.activity.source_type || 'remote',
      source_updated_at: source.activity.source_updated_at || null,
      metadata: {
        source_updated_at: source.activity.source_updated_at || null,
        source_revision: source.activity.source_revision || 0,
        source_origin: source.activity.source_origin || null,
        local_source_hash: source.activity.local_source_hash || null,
        remote_source_hash: source.activity.remote_source_hash || null,
        remote_updated_at: source.activity.remote_updated_at || null,
        last_synced_hash: source.activity.last_synced_hash || null,
        last_synced_at: source.activity.last_synced_at || null,
      },
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
  const { text, expected_revision: expectedRevisionRaw, edit_lease_token: editLeaseToken } = req.body || {};

  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  const markupValidation = validateActivityMarkup(text);
  if (!markupValidation.valid) {
    return res.status(400).json({
      error: 'Activity markup is invalid. Fix the reported structural errors before saving.',
      issues: markupValidation.issues,
    });
  }

  try {
    await ensureActivitySourceSchema();
    await ensureActivityEditLockSchema();
    const [rows] = await db.query('SELECT id, title, source_revision FROM pogil_activities WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    const expectedRevision = Number(expectedRevisionRaw);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return res.status(400).json({ error: 'expected_revision is required to save safely.' });
    }

    const activeLease = await getActivityEditLease(id);
    if (activeLease) {
      const editor = editorFromRequest(req);
      const ownsLease = editor
        && Number(activeLease.user_id) === Number(editor.id)
        && await hasValidActivityEditLease(id, editor.id, editLeaseToken);
      if (!ownsLease) {
        return res.status(423).json({
          error: `${activeLease.owner_name || activeLease.owner_email || 'Another instructor'} is editing this activity.`,
          owner_name: activeLease.owner_name || activeLease.owner_email || 'Another instructor',
          expires_at: activeLease.expires_at,
        });
      }
    }

    const extractedTitle = extractTitleFromText(text);
    const nextTitle = extractedTitle || rows[0].title;

    const localHash = sourceHash(text);
    const [updateResult] = await db.query(
      `UPDATE pogil_activities
          SET content_text = ?,
              source_type = 'local',
              title = ?,
              source_updated_at = NOW(3),
              source_revision = source_revision + 1,
              source_origin = 'editor',
              local_source_hash = ?
        WHERE id = ? AND source_revision = ?`,
      [text, nextTitle, localHash, id, expectedRevision]
    );

    if (!updateResult.affectedRows) {
      const [[current]] = await db.query(
        'SELECT source_revision, source_updated_at FROM pogil_activities WHERE id = ?',
        [id],
      );
      return res.status(409).json({
        error: 'This activity changed after you opened it. Reload before saving.',
        current_revision: current?.source_revision ?? null,
        current_updated_at: current?.source_updated_at ?? null,
      });
    }

    const [[saved]] = await db.query(
      `SELECT source_updated_at, source_revision, source_origin,
              local_source_hash, remote_source_hash, remote_updated_at,
              last_synced_hash, last_synced_at
         FROM pogil_activities WHERE id = ?`,
      [id]
    );

    return res.json({
      activity_id: Number(id),
      source_type: 'local',
      title: nextTitle,
      source_updated_at: saved?.source_updated_at || null,
      source_revision: saved?.source_revision || 0,
      source_origin: saved?.source_origin || null,
      metadata: {
        source_updated_at: saved?.source_updated_at || null,
        source_revision: saved?.source_revision || 0,
        source_origin: saved?.source_origin || null,
        local_source_hash: saved?.local_source_hash || null,
        remote_source_hash: saved?.remote_source_hash || null,
        remote_updated_at: saved?.remote_updated_at || null,
        last_synced_hash: saved?.last_synced_hash || null,
        last_synced_at: saved?.last_synced_at || null,
      },
      text,
    });
  } catch (err) {
    console.error('saveActivitySource error:', err);
    return res.status(500).json({ error: 'Could not save activity source.' });
  }
};

exports.getRemoteSourceStatus = async (req, res) => {
  const { id } = req.params;
  try {
    await ensureActivitySourceSchema();
    const [[activity]] = await db.query(
      `SELECT id, sheet_url, content_text, source_updated_at,
              source_revision, source_origin, local_source_hash,
              remote_source_hash, remote_updated_at, last_synced_hash, last_synced_at
         FROM pogil_activities WHERE id = ?`,
      [id]
    );
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    const status = await getRemoteActivityStatus(activity);
    await recordRemoteObservation(activity, status);
    return res.json({
      activity_id: Number(id),
      local: {
        updated_at: activity.source_updated_at || null,
        revision: activity.source_revision || 0,
        origin: activity.source_origin || null,
        has_copy: activity.content_text != null,
        last_synced_at: status.comparison.state === 'in_sync'
          ? new Date().toISOString()
          : activity.last_synced_at || null,
      },
      remote: status.remote,
      comparison: status.comparison,
    });
  } catch (err) {
    console.error('getRemoteSourceStatus error:', err);
    return res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : 'Could not read the linked Google Doc.',
    });
  }
};

exports.importRemoteSource = async (req, res) => {
  const { id } = req.params;
  try {
    await ensureActivitySourceSchema();
    await ensureActivityEditLockSchema();
    const [[activity]] = await db.query(
      `SELECT id, title, sheet_url, content_text, source_updated_at,
              source_revision, last_synced_hash
         FROM pogil_activities WHERE id = ?`,
      [id]
    );
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    const expectedRevision = Number(req.body?.expected_revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return res.status(400).json({ error: 'expected_revision is required to import safely.' });
    }

    const activeLease = await getActivityEditLease(id);
    if (activeLease) {
      const editor = editorFromRequest(req);
      const ownsLease = editor
        && Number(activeLease.user_id) === Number(editor.id)
        && await hasValidActivityEditLease(id, editor.id, req.body?.edit_lease_token);
      if (!ownsLease) {
        return res.status(423).json({
          error: `${activeLease.owner_name || activeLease.owner_email || 'Another instructor'} is editing this activity.`,
          owner_name: activeLease.owner_name || activeLease.owner_email || 'Another instructor',
          expires_at: activeLease.expires_at,
        });
      }
    }

    const { remote, remoteText } = await getRemoteActivityStatus(activity);
    const markupValidation = validateActivityMarkup(remoteText);
    if (!markupValidation.valid) {
      return res.status(400).json({
        error: 'The linked Google Doc contains invalid activity markup. Fix its structural errors before importing it.',
        issues: markupValidation.issues,
      });
    }
    const nextTitle = extractTitleFromText(remoteText) || activity.title;
    const syncedHash = sourceHash(remoteText);
    const [updateResult] = await db.query(
      `UPDATE pogil_activities
          SET content_text = ?,
              source_type = 'local',
              title = ?,
              source_updated_at = NOW(3),
              source_revision = source_revision + 1,
              source_origin = 'google_import',
              local_source_hash = ?,
              remote_source_hash = ?,
              remote_updated_at = ?,
              last_synced_hash = ?,
              last_synced_at = NOW(3)
        WHERE id = ? AND source_revision = ?`,
      [remoteText, nextTitle, syncedHash, syncedHash, sqlDate(remote.updated_at), syncedHash, id, expectedRevision]
    );
    if (!updateResult.affectedRows) {
      const [[current]] = await db.query(
        'SELECT source_revision, source_updated_at FROM pogil_activities WHERE id = ?',
        [id],
      );
      return res.status(409).json({
        error: 'This activity changed after you opened it. Reload before importing Google changes.',
        current_revision: current?.source_revision ?? null,
        current_updated_at: current?.source_updated_at ?? null,
      });
    }
    const [[saved]] = await db.query(
      `SELECT source_updated_at, source_revision, source_origin, last_synced_at
         FROM pogil_activities WHERE id = ?`, [id]
    );

    void recordAuditEvent('activity_remote_imported', {
      req,
      userId: req.user?.id || null,
      activityId: Number(id),
      details: { remote_updated_at: remote.updated_at, remote_url: remote.url },
    });
    return res.json({
      activity_id: Number(id),
      title: nextTitle,
      source_type: 'local',
      source_updated_at: saved?.source_updated_at || null,
      source_revision: saved?.source_revision || 0,
      source_origin: saved?.source_origin || null,
      last_synced_at: saved?.last_synced_at || null,
      text: remoteText,
      remote,
    });
  } catch (err) {
    console.error('importRemoteSource error:', err);
    return res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : 'Could not import the linked Google Doc.',
    });
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
