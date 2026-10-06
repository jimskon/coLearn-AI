'use strict';

// Records activity into group_activity_slices (migration 025): one row per
// student per 10-second slice. Each kind column is set to 1 when that kind of
// activity happened in the slice (edits arrive once per keystroke, so writes
// are limited to one per student, kind, and slice). Never content.
// Fire-and-forget: recording never blocks or fails a request.

const db = require('../db');

const SLICE_SECONDS = 10;
const KINDS = new Set(['edits', 'runs', 'submits', 'sandbox', 'ai_waits']);

let disabledReason = null; // set once if the table is missing, to avoid log spam

// "instance|user|kind" -> last slice number written. Bounded by active users.
const lastWritten = new Map();

function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * @param {number} instanceId
 * @param {number} userId
 * @param {'edits'|'runs'|'submits'|'sandbox'|'ai_waits'} kind
 */
function recordActivity(instanceId, userId, kind) {
  const instance = toId(instanceId);
  const user = toId(userId);
  if (!instance || !user || !KINDS.has(kind) || disabledReason) return;

  const slice = Math.floor(Date.now() / 1000 / SLICE_SECONDS);
  const key = `${instance}|${user}|${kind}`;
  if (lastWritten.get(key) === slice) return;
  lastWritten.set(key, slice);
  if (lastWritten.size > 10000) lastWritten.clear(); // safety valve

  // `kind` is checked against KINDS above, so it is safe as a column name.
  db.query(
    `INSERT INTO group_activity_slices (activity_instance_id, slice_start, user_id, ${kind})
     VALUES (?, FROM_UNIXTIME(? * ?), ?, 1)
     ON DUPLICATE KEY UPDATE ${kind} = 1`,
    [instance, slice, SLICE_SECONDS, user]
  ).catch((err) => {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      disabledReason = 'group_activity_slices table missing (run migration 025)';
      console.warn(`[activity] recording disabled: ${disabledReason}`);
      return;
    }
    if (err?.code === 'ER_NO_REFERENCED_ROW_2' || err?.code === 'ER_NO_REFERENCED_ROW') return; // unknown instance/user
    console.error('[activity] failed to record', kind, err?.message || err);
  });
}

module.exports = { recordActivity, SLICE_SECONDS, KINDS };
