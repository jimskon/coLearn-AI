'use strict';

// "Ended - incomplete" (research/autoEnd.js): a run whose students all left
// before finishing. Students may review it but may not answer, submit, or use
// AI help. ended_at is added on first use, like the other late columns
// (migration 027 adds it too).
const db = require('../db');

let ensured = false;
let ensurePromise = null;

// Look the column up first: ALTER TABLE ... IF NOT EXISTS still waits for a
// metadata lock even when the column exists, and an open transaction on
// activity_instances anywhere would block it (for up to a year by default).
// When the column really is missing, the ALTER gives up after 5 seconds and
// is retried on the next call.
async function addEndedAtIfMissing() {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS n
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'activity_instances'
        AND COLUMN_NAME = 'ended_at'`
  );
  if (Number(row?.n) > 0) return;
  await db.query(`
    SET STATEMENT lock_wait_timeout = 5 FOR
    ALTER TABLE activity_instances
      ADD COLUMN IF NOT EXISTS ended_at DATETIME NULL DEFAULT NULL
  `);
}

async function ensureEndedAtSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = addEndedAtIfMissing()
      .then(() => { ensured = true; })
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  await ensurePromise;
}

async function instanceEndedAt(instanceId) {
  const id = Number(instanceId);
  if (!Number.isInteger(id) || id <= 0) return null;
  await ensureEndedAtSchema();
  const [[row]] = await db.query('SELECT ended_at FROM activity_instances WHERE id = ?', [id]);
  return row?.ended_at ?? null;
}

const ENDED_MESSAGE = 'This activity has ended. You can review it, but answers can no longer be changed.';

/** Sends 409 and returns true when the run has ended; otherwise false. */
async function rejectIfEnded(instanceId, res) {
  if (!(await instanceEndedAt(instanceId))) return false;
  res.status(409).json({ error: ENDED_MESSAGE, code: 'ACTIVITY_ENDED' });
  return true;
}

module.exports = { ensureEndedAtSchema, instanceEndedAt, rejectIfEnded, ENDED_MESSAGE };
