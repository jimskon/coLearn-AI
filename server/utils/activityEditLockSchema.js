const db = require('../db');

let ensured = false;
let ensurePromise = null;

// A lease is deliberately short-lived. It is a courtesy/interlock for people
// editing the same activity, not a permanent lock that can strand an activity
// when a browser crashes or a laptop sleeps.
async function ensureActivityEditLockSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = db.query(`
      CREATE TABLE IF NOT EXISTS activity_edit_locks (
        activity_id INT NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        lease_token CHAR(36) NOT NULL,
        acquired_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        KEY activity_edit_locks_expires_at_idx (expires_at),
        CONSTRAINT activity_edit_locks_activity_fk
          FOREIGN KEY (activity_id) REFERENCES pogil_activities(id) ON DELETE CASCADE
      )
    `)
      .then(() => { ensured = true; })
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  await ensurePromise;
}

module.exports = { ensureActivityEditLockSchema };
