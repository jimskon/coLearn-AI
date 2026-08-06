const db = require('../db');

let ensured = false;
let ensurePromise = null;

// Keep the focus-loss count on the test attempt itself. This is deliberately
// separate from audit_log so clearing/reopening an attempt can reset the rule
// without deleting its audit trail.
async function ensureTestFocusSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = db.query(`
      ALTER TABLE activity_instances
        ADD COLUMN IF NOT EXISTS test_focus_loss_count INT NOT NULL DEFAULT 0
    `)
      .then(() => {
        ensured = true;
      })
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  await ensurePromise;
}

module.exports = { ensureTestFocusSchema };
