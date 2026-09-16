'use strict';

const db = require('../db');

let ensured = false;
let ensurePromise = null;

// Randomise MC answer choices per student at render time. Added after initial
// schema -- must be ensured before INSERT/SELECT on activity_instances.
async function ensureRandomizeOrderSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = db.query(`
      ALTER TABLE activity_instances
        ADD COLUMN IF NOT EXISTS randomize_order TINYINT(1) NOT NULL DEFAULT 0
    `)
      .then(() => { ensured = true; })
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  await ensurePromise;
}

module.exports = { ensureRandomizeOrderSchema };
