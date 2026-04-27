
const express = require('express');
const router = express.Router();
const db = require('../db'); // Adjust path if needed

function requireRoot(req, res) {
  if (req.user?.role !== 'root') {
    res.status(403).json({ error: 'Root access required' });
    return false;
  }
  return true;
}

function getAllSessions(sessionStore) {
  return new Promise((resolve, reject) => {
    if (!sessionStore?.all) {
      resolve({});
      return;
    }

    sessionStore.all((err, sessions) => {
      if (err) reject(err);
      else resolve(sessions || {});
    });
  });
}

// Get all users (root only)
router.get('/admin/users', async (req, res) => {
  if (!requireRoot(req, res)) return;
  console.log("✅ /admin/users route hit");
  try {
    const [users] = await db.query('SELECT id, email, name, role FROM users'); // ✅ correct query

    //console.log("✅ Users fetched:", users);
    res.json(users); // directly send the array
  } catch (err) {
    console.error("❌ DB error:", err.message);
    res.status(500).json({ error: "DB query failed" });
  }
});

router.get('/admin/active-users', async (req, res) => {
  if (!requireRoot(req, res)) return;

  try {
    const sessions = await getAllSessions(req.sessionStore);
    const sessionRows = Array.isArray(sessions) ? sessions : Object.values(sessions);

    const activeSessionsByUserId = new Map();
    for (const sessionRow of sessionRows) {
      const userId = Number(sessionRow?.userId);
      if (!userId) continue;

      const cookieExpires = sessionRow?.cookie?.expires ? new Date(sessionRow.cookie.expires) : null;
      const sessionExpired =
        cookieExpires &&
        Number.isFinite(cookieExpires.getTime()) &&
        cookieExpires < new Date();

      if (sessionExpired) continue;

      activeSessionsByUserId.set(
        userId,
        (activeSessionsByUserId.get(userId) || 0) + 1
      );
    }

    const activeUserIds = [...activeSessionsByUserId.keys()];
    if (!activeUserIds.length) {
      return res.json({ users: [], asOf: new Date().toISOString() });
    }

    const placeholders = activeUserIds.map(() => '?').join(', ');

    const [users] = await db.query(
      `SELECT id, email, name, role
       FROM users
       WHERE id IN (${placeholders})
       ORDER BY name, email`,
      activeUserIds
    );

    const [activityRows] = await db.query(
      `SELECT gm.student_id AS user_id,
              ai.id AS instance_id,
              ai.group_number,
              ai.progress_status,
              gm.connected,
              gm.last_heartbeat,
              a.title AS activity_title,
              c.name AS course_name
       FROM group_members gm
       JOIN activity_instances ai ON ai.id = gm.activity_instance_id
       JOIN pogil_activities a ON a.id = ai.activity_id
       LEFT JOIN courses c ON c.id = ai.course_id
       WHERE gm.student_id IN (${placeholders})
         AND gm.last_heartbeat IS NOT NULL
         AND gm.last_heartbeat >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
       ORDER BY gm.last_heartbeat DESC`,
      activeUserIds
    );

    const activitiesByUserId = new Map();
    activityRows.forEach((row) => {
      const uid = Number(row.user_id);
      const items = activitiesByUserId.get(uid) || [];
      items.push({
        instance_id: row.instance_id,
        group_number: row.group_number,
        progress_status: row.progress_status,
        connected: !!row.connected,
        last_heartbeat: row.last_heartbeat,
        activity_title: row.activity_title,
        course_name: row.course_name,
      });
      activitiesByUserId.set(uid, items);
    });

    const payload = users.map((user) => ({
      ...user,
      session_count: activeSessionsByUserId.get(Number(user.id)) || 0,
      running_activities: activitiesByUserId.get(Number(user.id)) || [],
    }));

    res.json({ users: payload, asOf: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Failed to fetch active users:', err);
    res.status(500).json({ error: 'Failed to fetch active users' });
  }
});

// Update user role
router.put('/admin/users/:id/role', async (req, res) => {
  if (!requireRoot(req, res)) return;
  const { id } = req.params;
  const { role } = req.body;
  await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);

  res.json({ success: true });
});

router.get('/:id', async (req, res) => {
  const userId = req.params.id;
  try {
    const [[user]] = await db.query(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('❌ Failed to fetch user by ID:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
