const db = require('../db');

let ensured = false;
let ensurePromise = null;

// This timestamp versions the authored activity source. It intentionally does
// not change for class-list edits such as a title or order change.
async function ensureActivitySourceSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = db.query(`
      ALTER TABLE pogil_activities
        ADD COLUMN IF NOT EXISTS source_updated_at DATETIME(3) NULL DEFAULT NULL
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

module.exports = { ensureActivitySourceSchema };
