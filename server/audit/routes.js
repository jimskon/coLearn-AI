const express = require('express');
const router = express.Router();
const db = require('../db');

function requireRoot(req, res) {
  if (req.user?.role !== 'root') {
    res.status(403).json({ error: 'Root access required' });
    return false;
  }
  return true;
}

function clampLimit(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parseDetails(details) {
  if (!details) return null;
  if (typeof details !== 'string') return details;
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

router.get('/logs', async (req, res) => {
  if (!requireRoot(req, res)) return;

  const limit = clampLimit(req.query.limit, 25, 500, 200);

  try {
    const [[summaryRow]] = await db.query(`
      SELECT
        COUNT(*) AS total_events,
        COALESCE(SUM(event_type = 'group_submitted'), 0) AS submit_events,
        COALESCE(SUM(event_type = 'user_login'), 0) AS login_events,
        COALESCE(SUM(event_type = 'account_created'), 0) AS account_events,
        COALESCE(SUM(event_type = 'class_created'), 0) AS class_events,
        COALESCE(SUM(event_type = 'activity_created'), 0) AS activity_events,
        COALESCE(SUM(event_type = 'activity_instance_created'), 0) AS instance_events,
        COALESCE(SUM(event_type = 'groups_formed'), 0) AS groups_events
      FROM audit_log
    `);

    const [byEventType] = await db.query(`
      SELECT event_type, COUNT(*) AS event_count
      FROM audit_log
      GROUP BY event_type
      ORDER BY event_count DESC, event_type ASC
    `);

    const [submitRows] = await db.query(`
      SELECT
        al.activity_id,
        COALESCE(a.title, a.name, CONCAT('Activity #', al.activity_id)) AS activity_label,
        COALESCE(c.name, '—') AS class_label,
        COALESCE(co.name, '—') AS course_label,
        COUNT(*) AS submit_count,
        COUNT(DISTINCT al.activity_instance_id) AS instance_count,
        MAX(al.created_at) AS last_submit_at
      FROM audit_log al
      LEFT JOIN pogil_activities a ON a.id = al.activity_id
      LEFT JOIN pogil_classes c ON c.id = al.class_id
      LEFT JOIN courses co ON co.id = al.course_id
      WHERE al.event_type = 'group_submitted'
      GROUP BY al.activity_id, a.title, a.name, c.name, co.name
      ORDER BY submit_count DESC, last_submit_at DESC
      LIMIT 15
    `);

    const [recentRows] = await db.query(
      `
      SELECT
        al.id,
        al.event_type,
        al.created_at,
        al.user_id,
        u.name AS user_name,
        u.email AS user_email,
        al.role,
        al.guest_token,
        al.class_id,
        al.course_id,
        al.activity_id,
        al.activity_instance_id,
        al.request_path,
        al.ip_address,
        al.user_agent,
        al.details,
        a.title AS activity_title,
        a.name AS activity_name,
        c.name AS class_name,
        co.name AS course_name
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      LEFT JOIN pogil_activities a ON a.id = al.activity_id
      LEFT JOIN pogil_classes c ON c.id = al.class_id
      LEFT JOIN courses co ON co.id = al.course_id
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT ?
      `,
      [limit]
    );

    res.json({
      summary: {
        totalEvents: toNumber(summaryRow?.total_events),
        submitEvents: toNumber(summaryRow?.submit_events),
        loginEvents: toNumber(summaryRow?.login_events),
        accountEvents: toNumber(summaryRow?.account_events),
        classEvents: toNumber(summaryRow?.class_events),
        activityEvents: toNumber(summaryRow?.activity_events),
        instanceEvents: toNumber(summaryRow?.instance_events),
        groupsEvents: toNumber(summaryRow?.groups_events),
      },
      byEventType: byEventType.map((row) => ({
        eventType: row.event_type,
        count: toNumber(row.event_count),
      })),
      submitsByActivity: submitRows.map((row) => ({
        activityId: row.activity_id ? Number(row.activity_id) : null,
        activityLabel: row.activity_label,
        classLabel: row.class_label,
        courseLabel: row.course_label,
        submitCount: toNumber(row.submit_count),
        instanceCount: toNumber(row.instance_count),
        lastSubmitAt: row.last_submit_at,
      })),
      recent: recentRows.map((row) => ({
        id: Number(row.id),
        eventType: row.event_type,
        createdAt: row.created_at,
        userId: row.user_id ? Number(row.user_id) : null,
        userName: row.user_name || null,
        userEmail: row.user_email || null,
        role: row.role || null,
        guestToken: row.guest_token || null,
        classId: row.class_id ? Number(row.class_id) : null,
        courseId: row.course_id ? Number(row.course_id) : null,
        activityId: row.activity_id ? Number(row.activity_id) : null,
        activityInstanceId: row.activity_instance_id ? Number(row.activity_instance_id) : null,
        requestPath: row.request_path || null,
        ipAddress: row.ip_address || null,
        userAgent: row.user_agent || null,
        details: parseDetails(row.details),
        activityTitle: row.activity_title || row.activity_name || null,
        className: row.class_name || null,
        courseName: row.course_name || null,
      })),
    });
  } catch (err) {
    console.error('❌ Failed to load audit logs:', err);
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
});

module.exports = router;
