const db = require('../db');

let ensured = false;
let ensurePromise = null;

// Source metadata tracks the relationship between the editable database copy
// and an optional linked Google Doc. It intentionally does not change for
// class-list edits such as a title or order change.
async function ensureActivitySourceSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = db.query(`
      ALTER TABLE pogil_activities
        ADD COLUMN IF NOT EXISTS source_updated_at DATETIME(3) NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS source_revision INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS source_origin VARCHAR(32) NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS local_source_hash CHAR(64) NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS remote_source_hash CHAR(64) NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS remote_updated_at DATETIME(3) NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS last_synced_hash CHAR(64) NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS last_synced_at DATETIME(3) NULL DEFAULT NULL
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
