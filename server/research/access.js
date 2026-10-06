'use strict';

// Which courses a user may see in research statistics:
// root sees every course; instructors and creators see the courses they teach
// and the courses of classes they created.
const RESEARCH_ROLES = new Set(['root', 'instructor', 'creator']);

function canUseResearch(user) {
  return RESEARCH_ROLES.has(user?.role);
}

async function accessibleCourseIds(db, user) {
  if (!canUseResearch(user)) return [];
  if (user.role === 'root') {
    const [rows] = await db.query('SELECT id FROM courses');
    return rows.map((r) => r.id);
  }
  const [rows] = await db.query(
    `SELECT c.id
       FROM courses c
       LEFT JOIN pogil_classes pc ON pc.id = c.class_id
      WHERE c.instructor_id = ? OR pc.created_by = ?`,
    [user.id, user.id]
  );
  return rows.map((r) => r.id);
}

/** Keep only requested course ids the user may see. */
async function filterAccessibleCourses(db, user, requestedIds) {
  const allowed = new Set(await accessibleCourseIds(db, user));
  return [...new Set(requestedIds)].filter((id) => allowed.has(id));
}

module.exports = { canUseResearch, accessibleCourseIds, filterAccessibleCourses };
