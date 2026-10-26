// client/src/utils/resultsRoster.js
// Results pages list every enrolled user. Keep only role === 'student'
// (per the course roster) and sort by name.
import { API_BASE_URL } from '../config';

export async function studentsOnlySorted(courseId, rows) {
  let studentIds = null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/courses/${courseId}/students`, {
      credentials: 'include',
    });
    if (res.ok) {
      const roster = await res.json();
      studentIds = new Set(roster.filter((u) => u.role === 'student').map((u) => u.id));
    }
  } catch (err) {
    console.error('Failed to load course roster:', err);
  }

  const filtered = studentIds ? rows.filter((r) => studentIds.has(r.id)) : rows;
  return [...filtered].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
  );
}
