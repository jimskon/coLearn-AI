const db = require('../db');

let ensured = false;
let ensurePromise = null;

// A Test Run sandbox belongs to the author who opened it, and must keep
// belonging to them after they leave the page. active_student_id cannot carry
// that: it is a rotation slot, cleared to NULL when the author disconnects and
// on group submit, so a lookup keyed on it missed every time after the first
// visit and inserted another sandbox instance.
//
// Ensured in code as well as in migration 021 because the alternative is a
// deploy-order trap: ship the code that reads this column before the migration
// runs and every Test Run fails with "Failed to open activity sandbox", which
// is exactly what happened. Matching the pattern already used for test-focus
// and assignment-due columns.
async function ensureSandboxOwnerSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = db.query(`
      ALTER TABLE activity_instances
        ADD COLUMN IF NOT EXISTS sandbox_owner_id INT(11) DEFAULT NULL
    `)
      .then(() => { ensured = true; })
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  await ensurePromise;
}

module.exports = { ensureSandboxOwnerSchema };
