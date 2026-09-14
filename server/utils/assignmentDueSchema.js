const db = require('../db');

let ensured = false;
let ensurePromise = null;

// Assignment deadlines belong to an activity instance, so the same activity
// can have a different deadline in another course or offering.
async function ensureAssignmentDueSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = db.query(`
      ALTER TABLE activity_instances
        ADD COLUMN IF NOT EXISTS assignment_due_at DATETIME NULL,
        ADD COLUMN IF NOT EXISTS submitted_late TINYINT(1) NOT NULL DEFAULT 0
    `)
      .then(() => { ensured = true; })
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  await ensurePromise;
}

module.exports = { ensureAssignmentDueSchema };
