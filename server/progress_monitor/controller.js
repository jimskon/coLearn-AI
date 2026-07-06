const db = require('../db');
const { updateSuggestionState } = require('./service');

const INSTRUCTOR_ROLES = new Set(['instructor', 'root', 'creator']);
const PROGRESS_STATUS_VALUES = new Set([
  'active_thinking',
  'needs_check_in',
  'stuck_after_feedback',
  'falling_behind',
  'completed',
]);

function cleanId(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
}

function parseDetails(details) {
  if (!details) return null;
  if (typeof details !== 'string') return details;
  try {
    return JSON.parse(details);
  } catch {
    return null;
  }
}

function formatDuration(ms) {
  const safeMs = Math.max(0, Math.floor(Number(ms) || 0));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return PROGRESS_STATUS_VALUES.has(status) ? status : null;
}

function scopeWhereClause({ courseId, activityId }) {
  const clauses = [];
  const params = [];

  if (courseId) {
    clauses.push('ai.course_id = ?');
    params.push(courseId);
  }

  if (activityId) {
    clauses.push('ai.activity_id = ?');
    params.push(activityId);
  }

  return {
    clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function requireInstructorLike(req, res) {
  if (!INSTRUCTOR_ROLES.has(String(req.user?.role || '').toLowerCase())) {
    res.status(403).json({ error: 'Instructor access required' });
    return false;
  }
  return true;
}

exports.getProgressMonitorBoard = async (req, res) => {
  if (!requireInstructorLike(req, res)) return;

  const courseId = cleanId(req.query.courseId);
  const activityId = cleanId(req.query.activityId);

  if (!courseId && !activityId) {
    return res.status(400).json({ error: 'courseId or activityId is required' });
  }

  try {
    const [scopeRows] = await db.query(
      `SELECT
         ai.activity_id,
         ai.course_id,
         a.title AS activity_title,
         a.name AS activity_name,
         c.name AS course_name,
         c.code AS course_code,
         c.section,
         c.semester,
         c.year
       FROM activity_instances ai
       JOIN pogil_activities a ON a.id = ai.activity_id
       JOIN courses c ON c.id = ai.course_id
       WHERE (? IS NULL OR ai.course_id = ?)
         AND (? IS NULL OR ai.activity_id = ?)
       GROUP BY ai.activity_id, ai.course_id, a.title, a.name, c.name, c.code, c.section, c.semester, c.year
       ORDER BY c.year DESC, c.semester ASC, c.section ASC, a.order_index ASC, ai.group_number ASC`,
      [courseId, courseId, activityId, activityId]
    );

    const { clause, params } = scopeWhereClause({ courseId, activityId });
    const [rows] = await db.query(
      `SELECT
         ai.id AS activity_instance_id,
         ai.activity_id,
         ai.course_id,
         ai.group_number,
         ai.active_student_id,
         ai.progress_status AS instance_progress_status,
         a.title AS activity_title,
         a.name AS activity_name,
         c.name AS course_name,
         c.code AS course_code,
         c.section,
         c.semester,
         c.year,
         active_u.name AS active_student_name,
         active_u.email AS active_student_email,
         gm.member_count,
         gm.member_names,
         gm.member_emails,
         latest.audit_id,
         latest.created_at AS status_updated_at,
         latest.details AS status_details,
         latest.user_id AS status_user_id,
         sugg.id AS suggestion_id,
         sugg.audit_log_id AS suggestion_audit_log_id,
         sugg.previous_status AS suggestion_previous_status,
         sugg.status AS suggestion_status,
         sugg.suggestion_text,
         sugg.suggestion_state,
         sugg.generated_at AS suggestion_generated_at,
         sugg.dismissed_at AS suggestion_dismissed_at,
         sugg.acted_on_at AS suggestion_acted_on_at,
         sugg.updated_at AS suggestion_updated_at
       FROM activity_instances ai
       JOIN pogil_activities a ON a.id = ai.activity_id
       JOIN courses c ON c.id = ai.course_id
       LEFT JOIN users active_u ON active_u.id = ai.active_student_id
       LEFT JOIN (
         SELECT
           gm.activity_instance_id,
           COUNT(*) AS member_count,
           GROUP_CONCAT(u.name ORDER BY gm.id SEPARATOR ' | ') AS member_names,
           GROUP_CONCAT(u.email ORDER BY gm.id SEPARATOR ' | ') AS member_emails
         FROM group_members gm
         JOIN users u ON u.id = gm.student_id
         GROUP BY gm.activity_instance_id
       ) gm ON gm.activity_instance_id = ai.id
       LEFT JOIN (
         SELECT al1.id AS audit_id, al1.activity_instance_id, al1.created_at, al1.details, al1.user_id
         FROM audit_log al1
         JOIN (
           SELECT activity_instance_id, MAX(id) AS max_id
           FROM audit_log
           WHERE event_type = 'progress_status_change'
           GROUP BY activity_instance_id
         ) latest ON latest.max_id = al1.id
       ) latest ON latest.activity_instance_id = ai.id
       LEFT JOIN (
         SELECT ps1.*
         FROM progress_monitor_suggestions ps1
         JOIN (
           SELECT activity_instance_id, MAX(id) AS max_id
           FROM progress_monitor_suggestions
           GROUP BY activity_instance_id
         ) latest_suggestion ON latest_suggestion.max_id = ps1.id
       ) sugg ON sugg.activity_instance_id = ai.id
       
       ORDER BY c.year DESC, c.semester ASC, c.section ASC, a.order_index ASC, ai.group_number ASC, ai.id ASC`,
      params
    );

    const suggestionInstanceIds = [...new Set(rows.map((row) => Number(row.activity_instance_id)).filter((value) => Number.isFinite(value)))];
    const suggestionByInstance = new Map();
    if (suggestionInstanceIds.length) {
      const [suggestionRows] = await db.query(
        `SELECT id, activity_instance_id, audit_log_id, previous_status, status, suggestion_text,
                suggestion_state, generated_at, dismissed_at, acted_on_at, updated_at
           FROM progress_monitor_suggestions
          WHERE activity_instance_id IN (?)
          ORDER BY id DESC`,
        [suggestionInstanceIds]
      );
      for (const suggestionRow of suggestionRows || []) {
        const instanceKey = Number(suggestionRow.activity_instance_id);
        if (!suggestionByInstance.has(instanceKey)) {
          suggestionByInstance.set(instanceKey, suggestionRow);
        }
      }
    }

    const now = Date.now();
    const grouped = rows.map((row) => {
      const details = parseDetails(row.status_details);
      const currentStatus = normalizeStatus(details?.new_status) || normalizeStatus(row.suggestion_status) || null;
      const updatedAtMs = row.status_updated_at ? new Date(row.status_updated_at).getTime() : null;
      const statusAgeMs = updatedAtMs != null && Number.isFinite(updatedAtMs) ? Math.max(0, now - updatedAtMs) : null;
      const suggestionRow = suggestionByInstance.get(Number(row.activity_instance_id)) || null;

      return {
        activityInstanceId: Number(row.activity_instance_id),
        activityId: Number(row.activity_id),
        courseId: Number(row.course_id),
        groupNumber: row.group_number == null ? null : Number(row.group_number),
        currentStatus,
        statusUpdatedAt: row.status_updated_at || null,
        statusAgeMs,
        statusAgeLabel: statusAgeMs == null ? null : formatDuration(statusAgeMs),
        previousStatus: normalizeStatus(details?.previous_status),
        suggestion: suggestionRow ? {
          id: Number(suggestionRow.id),
          auditLogId: suggestionRow.audit_log_id == null ? null : Number(suggestionRow.audit_log_id),
          previousStatus: normalizeStatus(suggestionRow.previous_status),
          status: normalizeStatus(suggestionRow.status),
          text: suggestionRow.suggestion_text || null,
          state: suggestionRow.suggestion_state || null,
          generatedAt: suggestionRow.generated_at || null,
          dismissedAt: suggestionRow.dismissed_at || null,
          actedOnAt: suggestionRow.acted_on_at || null,
          updatedAt: suggestionRow.updated_at || null,
        } : null,
        activeStudentId: row.active_student_id == null ? null : Number(row.active_student_id),
        activeStudentName: row.active_student_name || null,
        activeStudentEmail: row.active_student_email || null,
        memberCount: Number(row.member_count || 0),
        memberNames: row.member_names ? String(row.member_names).split(' | ') : [],
        memberEmails: row.member_emails ? String(row.member_emails).split(' | ') : [],
        activityTitle: row.activity_title || row.activity_name || null,
        courseName: row.course_name || null,
        courseCode: row.course_code || null,
        section: row.section || null,
        semester: row.semester || null,
        year: row.year || null,
      };
    });

    const summary = grouped.reduce((acc, row) => {
      acc.totalGroups += 1;
      const key = row.currentStatus || 'pending';
      acc.byStatus[key] = (acc.byStatus[key] || 0) + 1;
      return acc;
    }, { totalGroups: 0, byStatus: {} });

    const courseScope = courseId
      ? scopeRows.find((row) => Number(row.course_id) === courseId) || scopeRows[0] || null
      : scopeRows[0] || null;
    const activityScope = activityId
      ? scopeRows.find((row) => Number(row.activity_id) === activityId) || scopeRows[0] || null
      : scopeRows[0] || null;

    return res.json({
      scope: {
        courseId,
        activityId,
        courseName: courseScope?.course_name || null,
        courseCode: courseScope?.course_code || null,
        section: courseScope?.section || null,
        semester: courseScope?.semester || null,
        year: courseScope?.year || null,
        activityTitle: activityScope?.activity_title || activityScope?.activity_name || null,
      },
      summary,
      rows: grouped,
    });
  } catch (err) {
    console.error('❌ getProgressMonitorBoard error:', err);
    return res.status(500).json({ error: 'Failed to load progress monitor board' });
  }
};

exports.updateProgressMonitorSuggestion = async (req, res) => {
  if (!requireInstructorLike(req, res)) return;

  try {
    const row = await updateSuggestionState({
      suggestionId: req.params.id,
      state: req.body?.action || req.body?.state,
    });

    if (!row) {
      return res.status(404).json({ error: "Suggestion not found" });
    }

    return res.json({
      ok: true,
      suggestion: {
        id: Number(row.id),
        activityInstanceId: Number(row.activity_instance_id),
        auditLogId: row.audit_log_id == null ? null : Number(row.audit_log_id),
        previousStatus: normalizeStatus(row.previous_status),
        status: normalizeStatus(row.status),
        text: row.suggestion_text || null,
        state: row.suggestion_state || null,
        generatedAt: row.generated_at || null,
        dismissedAt: row.dismissed_at || null,
        actedOnAt: row.acted_on_at || null,
        updatedAt: row.updated_at || null,
      },
    });
  } catch (err) {
    console.error("❌ updateProgressMonitorSuggestion error:", err);
    return res.status(500).json({ error: "Failed to update suggestion" });
  }
};
