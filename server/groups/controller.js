// server/groups/controller.js
const db = require('../db');

// Priority order for roles
const ROLES = ['facilitator', 'analyst', 'qc', 'spokesperson'];

/**
 * Helpers
 */

async function isTestActivity(conn, activityId) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(is_test, 0) AS is_test
       FROM pogil_activities
      WHERE id = ?`,
    [activityId]
  );
  return !!row?.is_test;
}

// Create a new instance for a test (group of 1, no roles)
// Copy timing fields from an existing instance if available.
async function createNewTestInstance(conn, activityId, courseId) {
  // next group_number
  const [[{ next_num }]] = await conn.query(
    `SELECT COALESCE(MAX(group_number), 0) + 1 AS next_num
       FROM activity_instances
      WHERE activity_id = ? AND course_id = ?`,
    [activityId, courseId]
  );

  // copy timing defaults from any existing instance
  const [[tmpl]] = await conn.query(
    `SELECT test_start_at, test_duration_minutes, lock_before_start, lock_after_end
       FROM activity_instances
      WHERE activity_id = ? AND course_id = ?
      ORDER BY id ASC
      LIMIT 1`,
    [activityId, courseId]
  );

  const [ins] = await conn.query(
    `INSERT INTO activity_instances
       (activity_id, course_id, status, group_number,
        test_start_at, test_duration_minutes, lock_before_start, lock_after_end)
     VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?)`,
    [
      activityId,
      courseId,
      next_num,
      tmpl?.test_start_at ?? null,
      tmpl?.test_duration_minutes ?? 0,
      tmpl?.lock_before_start ?? 0,
      tmpl?.lock_after_end ?? 0,
    ]
  );

  return { id: ins.insertId, groupNumber: next_num };
}

// helper: which existing instance has space (<4)?
async function pickGroupWithSpace(conn, activityId, courseId) {
  const [rows] = await conn.query(
    `
    SELECT ai.id AS activity_instance_id, ai.group_number, COUNT(gm.id) AS size
      FROM activity_instances ai
      LEFT JOIN group_members gm ON gm.activity_instance_id = ai.id
     WHERE ai.activity_id = ? AND ai.course_id = ? AND ai.status = 'in_progress'
     GROUP BY ai.id
     ORDER BY size ASC, ai.group_number ASC
    `,
    [activityId, courseId]
  );

  const spot = rows.find((r) => Number(r.size) < 4);
  return spot
    ? { id: spot.activity_instance_id, groupNumber: spot.group_number }
    : null;
}

async function createNewGroup(conn, activityId, courseId) {
  const [[{ next_num }]] = await conn.query(
    `SELECT COALESCE(MAX(group_number), 0) + 1 AS next_num
       FROM activity_instances
      WHERE activity_id = ? AND course_id = ?`,
    [activityId, courseId]
  );

  const [res] = await conn.query(
    `INSERT INTO activity_instances (activity_id, course_id, status, group_number)
     VALUES (?, ?, 'in_progress', ?)`,
    [activityId, courseId, next_num]
  );

  return { id: res.insertId, groupNumber: next_num };
}

async function nextOpenRole(conn, activityInstanceId) {
  const [rows] = await conn.query(
    `SELECT role FROM group_members WHERE activity_instance_id = ?`,
    [activityInstanceId]
  );

  const used = new Set(rows.map((r) => r.role).filter(Boolean));

  for (const role of ROLES) {
    if (!used.has(role)) return role;
  }

  // All 4 roles used -> extra students get no role
  return '';
}

/**
 * Route handlers
 */

// GET /api/groups/instance/:id
// One activity_instance = one group
async function getGroupsByInstance(req, res) {
  const { id: instanceId } = req.params;

  try {
    const [rows] = await db.query(
      `
      SELECT
        gm.student_id,
        gm.role,
        u.name AS student_name,
        u.email AS student_email,
        ai.group_number
      FROM group_members gm
      JOIN users u ON gm.student_id = u.id
      JOIN activity_instances ai ON gm.activity_instance_id = ai.id
      WHERE gm.activity_instance_id = ?
      ORDER BY u.name
      `,
      [instanceId]
    );

    if (!rows.length) {
      return res.json({ groups: [] });
    }

    const group = {
      group_number: rows[0].group_number,
      members: rows.map((row) => ({
        student_id: row.student_id,
        name: row.student_name,
        email: row.student_email,
        role: row.role,
      })),
    };

    return res.json({ groups: [group] });
  } catch (err) {
    console.error('❌ Failed to fetch group members:', err);
    return res.status(500).json({ error: 'Failed to fetch group members' });
  }
}

// GET /api/groups/:activityId/:courseId/available-students
async function getAvailableStudents(req, res) {
  const { activityId, courseId } = req.params;

  try {
    const [rows] = await db.query(
      `
      SELECT u.id, u.name, u.email
        FROM course_enrollments ce
        JOIN users u ON u.id = ce.student_id
       WHERE ce.course_id = ?
         AND u.id NOT IN (
           SELECT gm.student_id
             FROM group_members gm
             JOIN activity_instances ai ON ai.id = gm.activity_instance_id
            WHERE ai.activity_id = ? AND ai.course_id = ? AND ai.status = 'in_progress'
         )
       ORDER BY u.name
      `,
      [courseId, activityId, courseId]
    );

    return res.json({ students: rows });
  } catch (err) {
    console.error('getAvailableStudents error:', err);
    return res.status(500).json({ error: 'Failed to fetch available students' });
  }
}

// GET /api/groups/:activityId/:courseId/active-students
async function getActiveStudentsInActivity(req, res) {
  const { activityId, courseId } = req.params;

  try {
    const [rows] = await db.query(
      `
      SELECT gm.student_id AS id, u.name, u.email, gm.role,
             ai.id AS activity_instance_id, ai.group_number
        FROM group_members gm
        JOIN users u ON u.id = gm.student_id
        JOIN activity_instances ai ON ai.id = gm.activity_instance_id
       WHERE ai.activity_id = ? AND ai.course_id = ? AND ai.status = 'in_progress'
       ORDER BY ai.group_number, u.name
      `,
      [activityId, courseId]
    );

    return res.json({ students: rows });
  } catch (err) {
    console.error('getActiveStudentsInActivity error:', err);
    return res.status(500).json({ error: 'Failed to fetch active students' });
  }
}

// POST /api/groups/:activityId/:courseId/smart-add  { studentId }
async function smartAddStudent(req, res) {
  const { activityId, courseId } = req.params;
  const { studentId } = req.body;

  if (!studentId) return res.status(400).json({ error: 'studentId is required' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // enrolled?
    const [[enrolled]] = await conn.query(
      `SELECT 1 AS ok FROM course_enrollments WHERE course_id = ? AND student_id = ? LIMIT 1`,
      [courseId, studentId]
    );
    if (!enrolled) {
      await conn.rollback();
      return res.status(400).json({ error: 'Student is not enrolled in this course' });
    }

    // already assigned to this activity?
    const [[present]] = await conn.query(
      `
      SELECT 1 AS ok
        FROM group_members gm
        JOIN activity_instances ai ON ai.id = gm.activity_instance_id
       WHERE gm.student_id = ?
         AND ai.activity_id = ?
         AND ai.course_id = ?
         AND ai.status = 'in_progress'
       LIMIT 1
      `,
      [studentId, activityId, courseId]
    );
    if (present) {
      await conn.rollback();
      return res.status(409).json({ error: 'Student already in a group for this activity' });
    }

    const testMode = await isTestActivity(conn, activityId);

    let group;
    let role = null;
    let cleanRole = null;

    if (testMode) {
      // TEST: always create a brand-new instance (group of 1)
      group = await createNewTestInstance(conn, activityId, courseId);
    } else {
      // NORMAL ACTIVITY: try to place into a group with space, else create new
      group = await pickGroupWithSpace(conn, activityId, courseId);
      if (!group) group = await createNewGroup(conn, activityId, courseId);

      role = await nextOpenRole(conn, group.id);
      cleanRole =
        role && ['facilitator', 'analyst', 'qc', 'spokesperson'].includes(role)
          ? role
          : null;
    }

    await conn.query(
      `INSERT INTO group_members (activity_instance_id, student_id, role)
       VALUES (?, ?, ?)`,
      [group.id, studentId, cleanRole]
    );

    await conn.commit();
    return res
      .status(201)
      .json({ ok: true, activityInstanceId: group.id, groupNumber: group.groupNumber, role });
  } catch (err) {
    await conn.rollback();
    console.error('smartAddStudent error:', err);
    return res.status(500).json({ error: 'Failed to add student' });
  } finally {
    conn.release();
  }
}

// DELETE /api/groups/:activityInstanceId/remove/:studentId
async function removeStudentFromGroup(req, res) {
  const { activityInstanceId, studentId } = req.params;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [delRes] = await conn.query(
      `DELETE FROM group_members WHERE activity_instance_id = ? AND student_id = ?`,
      [activityInstanceId, studentId]
    );

    if (delRes.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Student not found in that group' });
    }

    const [[{ remaining }]] = await conn.query(
      `SELECT COUNT(*) AS remaining FROM group_members WHERE activity_instance_id = ?`,
      [activityInstanceId]
    );

    // If group is empty, delete the instance
    if (Number(remaining) === 0) {
      await conn.query(`DELETE FROM activity_instances WHERE id = ?`, [activityInstanceId]);
    }

    await conn.commit();
    return res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('removeStudentFromGroup error:', err);
    return res.status(500).json({ error: 'Failed to remove student' });
  } finally {
    conn.release();
  }
}

// POST /api/groups/:activityId/:courseId/add-solo  { studentId }
async function addSoloStudent(req, res) {
  const { activityId, courseId } = req.params;
  const { studentId } = req.body;

  if (!studentId) return res.status(400).json({ error: 'studentId is required' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // enrolled?
    const [[enrolled]] = await conn.query(
      `SELECT 1 AS ok FROM course_enrollments WHERE course_id = ? AND student_id = ? LIMIT 1`,
      [courseId, studentId]
    );
    if (!enrolled) {
      await conn.rollback();
      return res.status(400).json({ error: 'Student is not enrolled in this course' });
    }

    // already assigned to this activity?
    const [[present]] = await conn.query(
      `
      SELECT 1 AS ok
        FROM group_members gm
        JOIN activity_instances ai ON ai.id = gm.activity_instance_id
       WHERE gm.student_id = ?
         AND ai.activity_id = ?
         AND ai.course_id = ?
         AND ai.status = 'in_progress'
       LIMIT 1
      `,
      [studentId, activityId, courseId]
    );
    if (present) {
      await conn.rollback();
      return res.status(409).json({ error: 'Student already in a group for this activity' });
    }

    const testMode = await isTestActivity(conn, activityId);

    // Always create a brand-new instance for solo
    const group = testMode
      ? await createNewTestInstance(conn, activityId, courseId)
      : await createNewGroup(conn, activityId, courseId);

    // Add member (no role)
    await conn.query(
      `INSERT INTO group_members (activity_instance_id, student_id, role)
       VALUES (?, ?, NULL)`,
      [group.id, studentId]
    );

    // Make them active (nice UX)
    await conn.query(
      `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
      [studentId, group.id]
    );

    await conn.commit();
    return res
      .status(201)
      .json({ ok: true, activityInstanceId: group.id, groupNumber: group.groupNumber });
  } catch (err) {
    await conn.rollback();
    console.error('❌ addSoloStudent failed:', err);
    return res.status(500).json({ error: 'Failed to create group of one' });
  } finally {
    conn.release();
  }
}

module.exports = {
  getGroupsByInstance,
  getAvailableStudents,
  getActiveStudentsInActivity,
  smartAddStudent,
  addSoloStudent,
  removeStudentFromGroup,
};
