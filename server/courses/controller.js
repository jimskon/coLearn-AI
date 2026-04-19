// /courses/controller.js
const db = require("../db");

// GET all courses
async function getAllCourses(req, res) {
  const user = req.user;
  const userId = user?.id;
  const role = user?.role;

  try {
    let coursesQuery = `
      SELECT DISTINCT c.*, pc.name AS class_name, u.name AS instructor_name
      FROM courses c
      LEFT JOIN pogil_classes pc ON c.class_id = pc.id
      LEFT JOIN users u ON c.instructor_id = u.id
      LEFT JOIN course_enrollments ce ON c.id = ce.course_id
    `;

    let whereClause = '';
    let params = [];

    if (role !== 'root') {
      whereClause = `
        WHERE c.instructor_id = ? OR ce.student_id = ?
      `;
      params = [userId, userId];
    }

    const [courses] = await db.query(`${coursesQuery} ${whereClause} ORDER BY year DESC, semester ASC`, params);
    res.json(courses.map(course => ({ ...course })));

  } catch (err) {
    console.error("Error fetching courses:", err);
    res.status(500).json({ error: "Database error" });
  }
}

// POST create a new course
async function createCourse(req, res) {
  const { name, code, section, semester, year, instructor_id, class_id } =
    req.body;

  const conn = await db.getConnection(); // get manual connection so we can use transaction

  try {
    await conn.beginTransaction();

    // 1. Create the course
    const [result] = await conn.query(
      `INSERT INTO courses
       (name, code, section, semester, year, instructor_id, class_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, code, section, semester, year, instructor_id, class_id || null]
    );

    const courseId = result.insertId;

    // 2. Auto-enroll the instructor in the new course
    await conn.query(
      `INSERT INTO course_enrollments (student_id, course_id) VALUES (?, ?)`,
      [instructor_id, courseId]
    );

    await conn.commit();

    res.status(201).json({ success: true, courseId });
  } catch (err) {
    await conn.rollback();
    console.error(
      "❌ Error creating course or enrolling instructor:",
      err.message
    );
    res.status(500).json({ error: "Failed to create course" });
  } finally {
    conn.release();
  }
}

async function getCourseEnrollments(req, res) {
  const { courseId } = req.params;
  const userId = req.user?.id; // Add this line
  try {
    const [rows] = await db.query(
      `SELECT 
         c.id, c.name, c.code, c.section, c.semester, c.year,
         u.name AS instructor_name
       FROM course_enrollments ce
       JOIN courses c ON ce.course_id = c.id
       LEFT JOIN users u ON c.instructor_id = u.id
       WHERE ce.student_id = ?`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to get enrollments:", err);
    res.status(500).json({ error: "Failed to retrieve enrollments" });
  }
}

// DELETE a course
async function deleteCourse(req, res) {
  const user = req.user;
  const courseId = req.params.id;

  try {
    // Step 1: Get the course's instructor ID
    const [result] = await db.query(
      "SELECT instructor_id FROM courses WHERE id = ?",
      [courseId]
    );

    if (result.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    const course = result[0];

    // Step 2: Check if user is allowed to delete
    const isOwner = user.id === course.instructor_id;
    const isAdmin = user.role === "root" || user.role === "creator";

    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete this course" });
    }

    // Step 3: Proceed to delete
    await db.query("DELETE FROM courses WHERE id = ?", [courseId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting course:", err);
    res.status(500).json({ error: "Delete failed" });
  }
}

// GET activities for a course, with student instance info
// GET activities for a course, returning one row per activity_instance (i.e. per group)
async function getCourseActivities(req, res) {
  const { courseId } = req.params;
  const userId = req.user?.id;

  console.log("🔍 getCourseActivities for course:", courseId, "and user:", userId);

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const role = req.user?.role;

    // Students: only show activities that have groups (instances) AND are not hidden
    const studentHaving = (role === 'student')
      ? `HAVING COUNT(ai.id) > 0 AND MAX(COALESCE(ai.hidden, 0)) = 0`
      : '';
    const [rows] = await db.query(
      `
  SELECT 
    a.id AS activity_id,
    a.name AS activity_name,
    a.title AS activity_title,
    a.order_index AS activity_index,
    a.is_test AS is_test,

    -- instance id
    (
      SELECT ai2.id
      FROM activity_instances ai2
      JOIN group_members gm ON gm.activity_instance_id = ai2.id
      WHERE ai2.activity_id = a.id
        AND ai2.course_id = c.id
        AND gm.student_id = ?
      LIMIT 1
    ) AS instance_id,

    -- submitted_at
    (
      SELECT ai2.submitted_at
      FROM activity_instances ai2
      JOIN group_members gm ON gm.activity_instance_id = ai2.id
      WHERE ai2.activity_id = a.id
        AND ai2.course_id = c.id
        AND gm.student_id = ?
      LIMIT 1
    ) AS submitted_at,

    -- instance_status (keep for now, but no longer primary)
    (
      SELECT ai2.status
      FROM activity_instances ai2
      JOIN group_members gm ON gm.activity_instance_id = ai2.id
      WHERE ai2.activity_id = a.id
        AND ai2.course_id = c.id
        AND gm.student_id = ?
      LIMIT 1
    ) AS instance_status,

    -- 🔥 NEW: progress_status (source of truth)
    (
      SELECT ai2.progress_status
      FROM activity_instances ai2
      JOIN group_members gm ON gm.activity_instance_id = ai2.id
      WHERE ai2.activity_id = a.id
        AND ai2.course_id = c.id
        AND gm.student_id = ?
      LIMIT 1
    ) AS progress_status,

    -- 🔥 NEW: completed_groups
    (
      SELECT ai2.completed_groups
      FROM activity_instances ai2
      JOIN group_members gm ON gm.activity_instance_id = ai2.id
      WHERE ai2.activity_id = a.id
        AND ai2.course_id = c.id
        AND gm.student_id = ?
      LIMIT 1
    ) AS completed_groups,

    -- 🔥 NEW: total_groups
    (
      SELECT ai2.total_groups
      FROM activity_instances ai2
      JOIN group_members gm ON gm.activity_instance_id = ai2.id
      WHERE ai2.activity_id = a.id
        AND ai2.course_id = c.id
        AND gm.student_id = ?
      LIMIT 1
    ) AS total_groups,

    COUNT(ai.id) AS group_count,
    MAX(ai.status = 'in_progress') AS is_ready,
    MAX(COALESCE(ai.hidden, 0)) AS hidden

  FROM pogil_activities a
  JOIN courses c ON a.class_id = c.class_id
  LEFT JOIN activity_instances ai
    ON ai.activity_id = a.id
   AND ai.course_id = c.id
  WHERE c.id = ?
  GROUP BY a.id, a.name, a.title, a.order_index, a.is_test
  ${studentHaving}
  ORDER BY a.order_index ASC
  `,
      [
        userId, // instance_id
        userId, // submitted_at
        userId, // instance_status
        userId, // progress_status
        userId, // completed_groups
        userId, // total_groups
        courseId
      ]
    );

    const activities = rows.map((row) => {
      const is_test = row.is_test; // 1 / 0 / null
      const status = (row.progress_status || '').toLowerCase();
      const tg = Number(row.total_groups || 0);
      const cg = Number(row.completed_groups || 0);

      let student_status = 'not_started';

      if (status === 'completed' || (tg > 0 && cg >= tg)) {
        student_status = 'complete';
      } else if (status === 'not_started' || (!status && cg === 0)) {
        student_status = 'not_started';
      } else {
        student_status = 'in_progress';
      }
      const isComplete = student_status === 'complete';

      return {
        activity_id: row.activity_id,
        activity_name: row.activity_name,
        title: row.activity_title || row.activity_name,
        order_index: row.activity_index,

        is_test,
        isTest: is_test === 1,
        isTestKnown: is_test !== null && is_test !== undefined,

        instance_id: row.instance_id || null,
        submitted_at: row.submitted_at || null,
        instance_status: row.instance_status || null,

        student_status,
        is_complete: isComplete,

        is_ready: !!row.is_ready,
        has_groups: row.group_count > 0,
        hidden: !!row.hidden,
      };
    });


    res.json(activities);
  } catch (err) {
    console.error("❌ Error fetching activities for course:", err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
}



// GET all courses a user is enrolled in
async function getUserEnrollments(req, res) {
  const { userId } = req.params;
  //console.log("getUserEnrollments", userId);

  try {
    const [rows] = await db.query(
      `SELECT 
     c.id, c.name, c.code, c.section, c.semester, c.year,
     c.instructor_id,
     u.name AS instructor_name,
     pc.name AS class_name
   FROM course_enrollments ce
   JOIN courses c ON ce.course_id = c.id
   LEFT JOIN users u ON c.instructor_id = u.id
   LEFT JOIN pogil_classes pc ON c.class_id = pc.id
   WHERE ce.student_id = ?`,
      [userId]
    );
    //console.log("getUserEnrollments:", rows);

    res.json(rows.map(r => ({ ...r }))); // ✅ Flatten enrollment rows
  } catch (err) {
    console.error("Error fetching enrolled courses:", err);
    res.status(500).json({ error: "Failed to load enrolled courses" });
  }
}

// POST enroll in a course by course code
async function enrollByCode(req, res) {
  const { userId, code } = req.body;
  console.log("enrollByCode:", userId, code);

  try {
    const [courses] = await db.query(`SELECT * FROM courses WHERE code = ?`, [
      code,
    ]);
    console.log("Courses:", courses);

    if (!Array.isArray(courses) || courses.length === 0) {
      return res.status(404).json({ error: "Course code not found" });
    }

    const course = { ...courses[0] }; // ✅ Flatten single course immediately

    const [enrollments] = await db.query(
      `SELECT * FROM course_enrollments WHERE student_id = ? AND course_id = ?`,
      [userId, course.id]
    );
    console.log("Enrollments:", enrollments);

    if (enrollments.length > 0) {
      return res.status(400).json({ error: "Already enrolled in this course" });
    }

    // Enroll the user
    await db.query(
      `INSERT INTO course_enrollments (student_id, course_id) VALUES (?, ?)`,
      [userId, course.id]
    );

    res.status(201).json({
      success: true,
      newCourse: {
        id: course.id,
        name: course.name,
        code: course.code,
        section: course.section,
        semester: course.semester,
        year: course.year,
      },
    });
  } catch (err) {
    console.error("Error enrolling in course:", err);
    res.status(500).json({ error: "Failed to enroll" });
  }
}

async function getStudentsForCourse(req, res) {
  const { courseId } = req.params;

  try {
    const [students] = await db.query(
      `SELECT u.id, u.name, u.email, u.role
   FROM course_enrollments ce
   JOIN users u ON ce.student_id = u.id
   WHERE ce.course_id = ?`,
      [courseId]
    );

    res.json(students);
  } catch (err) {
    console.error("❌ Failed to fetch students for course:", err);
    res.status(500).json({ error: "Failed to fetch students" });
  }
}

async function unenrollStudentFromCourse(req, res) {
  const { courseId, studentId } = req.params;
  const user = req.user;

  // Check permissions
  const [result] = await db.query(
    `SELECT instructor_id FROM courses WHERE id = ?`,
    [courseId]
  );

  if (!result.length) {
    return res.status(404).json({ error: "Course not found" });
  }

  const course = result[0];
  const isOwner = user.id === course.instructor_id;
  const isAdmin = user.role === 'root' || user.role === 'creator';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  // Remove enrollment
  await db.query(
    `DELETE FROM course_enrollments WHERE student_id = ? AND course_id = ?`,
    [studentId, courseId]
  );

  res.json({ success: true });
}

async function getCourseInfo(req, res) {
  const { courseId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT id, name, code, section, semester, year, instructor_id
       FROM courses
       WHERE id = ?`,
      [courseId]
    );
    console.log("getCourseInfo for courseId:", courseId, "Result:", rows);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error fetching course info:", err);
    res.status(500).json({ error: "Failed to get course info" });
  }
}

async function getCourseProgress(req, res) {
  const { courseId } = req.params;

  try {
    // 1) Get enrolled students
    const [studentsRows] = await db.query(
      `SELECT u.id, u.name, u.email
       FROM course_enrollments ce
       JOIN users u ON ce.student_id = u.id
       WHERE ce.course_id = ?`,
      [courseId]
    );

    // 2) Get NON-TEST activities for this course's class_id
    const [activitiesRows] = await db.query(
      `SELECT id, name, is_test
       FROM pogil_activities
       WHERE class_id = (
         SELECT class_id FROM courses WHERE id = ?
       )
         AND is_test = 0
       ORDER BY order_index`,
      [courseId]
    );

    // 3) Pull cached instance progress for these activities in this course
    const [instanceRows] = await db.query(
      `
  SELECT
    ai.activity_id,
    ai.points_earned,
    ai.points_possible,
    ai.progress_status,
    gm.student_id,
    ai.id AS instance_id,
    COALESCE(ai.graded_at, ai.submitted_at) AS last_ts
  FROM activity_instances ai
  JOIN pogil_activities a ON a.id = ai.activity_id
  JOIN group_members gm   ON gm.activity_instance_id = ai.id
  JOIN (
    SELECT
      gm2.student_id,
      ai2.activity_id,
      MAX(COALESCE(ai2.graded_at, ai2.submitted_at)) AS last_ts,
      MAX(ai2.id) AS last_id
    FROM activity_instances ai2
    JOIN pogil_activities a2 ON a2.id = ai2.activity_id
    JOIN group_members gm2   ON gm2.activity_instance_id = ai2.id
    WHERE ai2.course_id = ?
      AND a2.is_test = 1
    GROUP BY gm2.student_id, ai2.activity_id
  ) latest
    ON latest.student_id = gm.student_id
   AND latest.activity_id = ai.activity_id
   AND COALESCE(ai.graded_at, ai.submitted_at) = latest.last_ts
   AND ai.id = latest.last_id
  WHERE ai.course_id = ?
    AND a.is_test = 1
  `,
      [courseId, courseId]
    );


    // 4) Build per-student structure
    const progressByStudent = new Map();
    for (const s of studentsRows) {
      progressByStudent.set(s.id, {
        id: s.id,
        name: s.name,
        email: s.email,
        completeCount: 0,
        partialCount: 0,
        // activityId -> { status, completedGroups, totalGroups }
        progress: {}
      });
    }

    // Helper to choose the "better" progress if we ever see multiple instances
    const statusRank = {
      not_started: 0,
      in_progress: 1,
      completed: 2,
    };

    function betterProgress(a, b) {
      if (!a) return b;
      if (!b) return a;
      const ra = statusRank[a.status] ?? 0;
      const rb = statusRank[b.status] ?? 0;
      if (rb > ra) return b;
      if (rb < ra) return a;
      // same status: prefer the one with more completedGroups
      if ((b.completedGroups || 0) > (a.completedGroups || 0)) return b;
      return a;
    }

    // 5) Fill per-student per-activity from cached instance rows
    for (const row of instanceRows) {
      const {
        student_id,
        activity_id,
        total_groups,
        completed_groups,
        progress_status,
      } = row;

      const student = progressByStudent.get(student_id);
      if (!student) continue;

      const status =
        progress_status ||
        (completed_groups && total_groups && completed_groups >= total_groups
          ? 'completed'
          : completed_groups > 0
            ? 'in_progress'
            : 'not_started');

      const entry = {
        status,
        completedGroups: completed_groups || 0,
        totalGroups: total_groups || 0,
      };

      const existing = student.progress[activity_id];
      student.progress[activity_id] = betterProgress(existing, entry);
    }

    // 6) Ensure every activity has an entry for every student,
    //    and compute complete/partial counts.
    for (const student of progressByStudent.values()) {
      for (const a of activitiesRows) {
        const actId = a.id;
        let prog = student.progress[actId];

        if (!prog) {
          prog = {
            status: 'not_started',
            completedGroups: 0,
            totalGroups: 0,
          };
          student.progress[actId] = prog;
        }

        if (prog.status === 'completed') {
          student.completeCount += 1;
        } else if (prog.status === 'in_progress') {
          student.partialCount += 1;
        }
      }
    }

    // 7) Shape response
    res.json({
      activities: activitiesRows.map(a => ({
        id: a.id,
        name: a.name,
        isTest: false, // we filtered them out
      })),
      students: Array.from(progressByStudent.values()),
    });
  } catch (err) {
    console.error("❌ Failed to load progress:", err);
    res.status(500).json({ error: "Failed to get student progress" });
  }
}
// GET test results for a course (only test activities)
// Shape:
// {
//   tests: [{ id, name }],
//   students: [
//     {
//       id, name, email,
//       scores: {
//         [testId]: { status, pointsEarned, pointsPossible }
//       }
//     }
//   ]
// }
async function getCourseTestResults(req, res) {
  const { courseId } = req.params;

  try {
    // 1) Enrolled students
    const [studentsRows] = await db.query(
      `SELECT u.id, u.name, u.email
       FROM course_enrollments ce
       JOIN users u ON ce.student_id = u.id
       WHERE ce.course_id = ?`,
      [courseId]
    );

    // 2) Test activities for this course's class_id
    const [testsRows] = await db.query(
      `SELECT id, name, is_test
       FROM pogil_activities
       WHERE class_id = (
         SELECT class_id FROM courses WHERE id = ?
       )
       AND is_test = 1
       ORDER BY order_index`,
      [courseId]
    );

    if (testsRows.length === 0) {
      return res.json({ tests: [], students: [] });
    }

    // 3) Pull LATEST cached test instance scores for this course (one row per student x test)
    const [instanceRows] = await db.query(
      `
  SELECT
    ai.activity_id,
    ai.points_earned,
    ai.points_possible,
    ai.progress_status,
    gm.student_id,
    ai.id AS instance_id
  FROM activity_instances ai
  JOIN pogil_activities a ON a.id = ai.activity_id
  JOIN group_members gm   ON gm.activity_instance_id = ai.id
  JOIN (
    SELECT
      gm2.student_id,
      ai2.activity_id,
      MAX(COALESCE(ai2.graded_at, ai2.submitted_at, ai2.start_time)) AS last_ts,
      MAX(ai2.id) AS last_id
    FROM activity_instances ai2
    JOIN pogil_activities a2 ON a2.id = ai2.activity_id
    JOIN group_members gm2   ON gm2.activity_instance_id = ai2.id
    WHERE ai2.course_id = ?
      AND a2.is_test = 1
    GROUP BY gm2.student_id, ai2.activity_id
  ) latest
    ON latest.student_id = gm.student_id
   AND latest.activity_id = ai.activity_id
   AND COALESCE(ai.graded_at, ai.submitted_at, ai.start_time) = latest.last_ts
   AND ai.id = latest.last_id
  WHERE ai.course_id = ?
    AND a.is_test = 1
  `,
      [courseId, courseId]
    );


    // 4) Build per-student structure
    const resultsByStudent = new Map();
    for (const s of studentsRows) {
      resultsByStudent.set(s.id, {
        id: s.id,
        name: s.name,
        email: s.email,
        // testId -> { status, pointsEarned, pointsPossible }
        scores: {}
      });
    }

    const statusRank = {
      not_started: 0,
      in_progress: 1,
      completed: 2,
    };

    /*function betterScore(a, b) {
      if (!a) return b;
      if (!b) return a;

      const ra = statusRank[a.status] ?? 0;
      const rb = statusRank[b.status] ?? 0;

      if (rb > ra) return b;
      if (rb < ra) return a;

      // Same status: prefer the one with higher pointsEarned
      const aEarned = a.pointsEarned ?? 0;
      const bEarned = b.pointsEarned ?? 0;
      if (bEarned > aEarned) return b;

      // As a tie-breaker, prefer higher pointsPossible (fully graded)
      const aPossible = a.pointsPossible ?? 0;
      const bPossible = b.pointsPossible ?? 0;
      if (bPossible > aPossible) return b;

      return a;
    }*/

    // 5) Fill per-student per-test from LATEST instance rows (no "best score" merging)
    for (const row of instanceRows) {
      const {
        student_id,
        activity_id,
        points_earned,
        points_possible,
        progress_status,
      } = row;

      const student = resultsByStudent.get(student_id);
      if (!student) continue;

      let status = progress_status || 'not_started';

      // If we have pointsPossible > 0, treat as completed (graded)
      if (!status || status === 'in_progress') {
        if (points_possible && Number(points_possible) > 0) {
          status = 'completed';
        } else if (points_earned && Number(points_earned) > 0) {
          status = 'in_progress';
        } else {
          status = 'not_started';
        }
      }

      student.scores[activity_id] = {
        status,
        pointsEarned: points_earned != null ? Number(points_earned) : null,
        pointsPossible: points_possible != null ? Number(points_possible) : null,
      };
    }


    // 6) Ensure every test has a slot for every student
    for (const student of resultsByStudent.values()) {
      for (const t of testsRows) {
        const testId = t.id;
        if (!student.scores[testId]) {
          student.scores[testId] = {
            status: 'not_started',
            pointsEarned: null,
            pointsPossible: null,
          };
        }
      }
    }

    res.json({
      tests: testsRows.map(t => ({
        id: t.id,
        name: t.name,
      })),
      students: Array.from(resultsByStudent.values()),
    });
  } catch (err) {
    console.error("❌ Failed to load test results:", err);
    res.status(500).json({ error: "Failed to get test results" });
  }
}

// PUT /api/courses/:courseId/activities/:activityId/hidden
// Body: { hidden: true/false }
async function setCourseActivityHidden(req, res) {
  const { courseId, activityId } = req.params;
  const hidden = req.body?.hidden ? 1 : 0;

  const role = req.user?.role;
  if (!['instructor', 'root', 'creator'].includes(role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const [result] = await db.query(
      `UPDATE activity_instances
       SET hidden = ?
       WHERE course_id = ? AND activity_id = ?`,
      [hidden, courseId, activityId]
    );

    return res.json({ ok: true, hidden: !!hidden, affected: result.affectedRows || 0 });
  } catch (err) {
    console.error('❌ setCourseActivityHidden:', err);
    return res.status(500).json({ error: 'Failed to update hidden flag' });
  }
}

// /courses/controller.js
async function getGroupsConfigForActivity(req, res) {
  const { courseId, sourceActivityId } = req.params;

  // permission: instructor/root/creator only (or whatever you want)
  const role = req.user?.role;
  if (!['instructor', 'root', 'creator'].includes(role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const [rows] = await db.query(
      `
      SELECT
        ai.id AS instance_id,
        gm.student_id,
        gm.role
      FROM activity_instances ai
      JOIN group_members gm ON gm.activity_instance_id = ai.id
      WHERE ai.course_id = ?
        AND ai.activity_id = ?
      ORDER BY ai.id ASC, gm.id ASC
      `,
      [courseId, sourceActivityId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "No saved groups found for that activity in this course."
      });
    }

    // group by instance_id -> members[]
    const byInstance = new Map();
    for (const r of rows) {
      if (!byInstance.has(r.instance_id)) byInstance.set(r.instance_id, []);
      byInstance.get(r.instance_id).push({
        student_id: r.student_id,
        role: r.role || null,
      });
    }

    const groups = Array.from(byInstance.values()).map((members) => ({ members }));

    return res.json({ groups });
  } catch (err) {
    console.error('❌ getGroupsConfigForActivity:', err);
    return res.status(500).json({ error: 'Failed to load group config' });
  }
}


module.exports = {
  getAllCourses,
  createCourse,
  deleteCourse,
  getCourseActivities,
  getUserEnrollments,
  enrollByCode,
  getCourseEnrollments,
  getStudentsForCourse,
  unenrollStudentFromCourse,
  getCourseInfo,
  getCourseProgress,
  getCourseTestResults,
  setCourseActivityHidden,
  getGroupsConfigForActivity,
};