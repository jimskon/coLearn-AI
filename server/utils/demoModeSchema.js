const db = require('../db');

let ensured = false;
let ensurePromise = null;

async function ensureDemoModeSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = db.query(`
      ALTER TABLE pogil_classes
        ADD COLUMN IF NOT EXISTS demo_mode TINYINT(1) NOT NULL DEFAULT 0
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

module.exports = {
  ensureDemoModeSchema,
};
