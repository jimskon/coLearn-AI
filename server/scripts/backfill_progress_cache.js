// server/scripts/backfill_progress_cache.js
// One-time script to backfill activity_instances progress/test caches
//
// Usage (from project root):
//   node server/scripts/backfill_progress_cache.js

// 1️⃣ Load environment variables from server/.env
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),  // <-- server/.env
});

const db = require('../db');

async function backfill() {
  console.log('🔧 Backfilling activity_instances progress/test caches...');

  // Grab all instances + is_test flag
  const [instances] = await db.query(`
    SELECT ai.id,
           ai.activity_id,
           ai.course_id,
           ai.total_groups,
           ai.completed_groups,
           ai.progress_status,
           COALESCE(a.is_test, 0) AS is_test
    FROM activity_instances ai
    JOIN pogil_activities a ON a.id = ai.activity_id
  `);

  console.log(`Found ${instances.length} activity_instances to inspect.`);

  for (const inst of instances) {
    const instanceId = inst.id;
    const isTest = !!inst.is_test;

    if (isTest) {
      // ---------- TEST INSTANCE ----------
      const [[scores]] = await db.query(
        `
        SELECT
          MAX(CASE WHEN question_id = 'testTotalScore'
                   THEN CAST(response AS SIGNED) END) AS earned,
          MAX(CASE WHEN question_id = 'testMaxScore'
                   THEN CAST(response AS SIGNED) END) AS possible
        FROM responses
        WHERE activity_instance_id = ?
        `,
        [instanceId]
      );

      const earned = scores?.earned ?? null;
      const possible = scores?.possible ?? null;

      if (earned != null || possible != null) {
        let status = 'not_started';
        if (possible > 0) {
          status = 'completed';
        } else if (earned > 0) {
          status = 'in_progress';
        }

        console.log(
          `🧪 Instance ${instanceId}: test scores earned=${earned}, possible=${possible}, status=${status}`
        );

        await db.query(
          `
          UPDATE activity_instances
          SET points_earned   = ?,
              points_possible = ?,
              progress_status = ?
          WHERE id = ?
          `,
          [earned, possible, status, instanceId]
        );
      }

      continue;
    }

    // ---------- REGULAR (NON-TEST) INSTANCE ----------
    // If it already has data, we can choose to leave it or recompute. Let's recompute to be safe.

    // 1) Find all group-state markers like "1state", "2state", ...
    const [stateRows] = await db.query(
      `
      SELECT question_id, response
      FROM responses
      WHERE activity_instance_id = ?
        AND question_id REGEXP '^[0-9]+state$'
      `,
      [instanceId]
    );

    if (stateRows.length === 0) {
      // No states at all; treat as not started
      console.log(`📄 Instance ${instanceId}: no group state rows; marking not_started.`);
      await db.query(
        `
        UPDATE activity_instances
        SET total_groups    = COALESCE(total_groups, 0),
            completed_groups = 0,
            progress_status  = 'not_started'
        WHERE id = ?
        `,
        [instanceId]
      );
      continue;
    }

    // Determine total_groups as max group index we see
    const groupNums = stateRows
      .map((r) => {
        const m = r.question_id.match(/^(\d+)state$/);
        return m ? Number(m[1]) : null;
      })
      .filter((n) => Number.isFinite(n));

    const totalGroups = groupNums.length ? Math.max(...groupNums) : 0;

    // Count sequential completed groups from 1..totalGroups
    const stateMap = new Map(stateRows.map((r) => [r.question_id, r.response]));
    let completedGroups = 0;
    for (let i = 1; i <= totalGroups; i++) {
      const key = `${i}state`;
      if (stateMap.get(key) === 'completed') {
        completedGroups++;
      } else {
        break; // stop at first incomplete group
      }
    }

    let status = 'not_started';
    if (totalGroups > 0 && completedGroups >= totalGroups) {
      status = 'completed';
    } else if (completedGroups > 0) {
      status = 'in_progress';
    }

    console.log(
      `📄 Instance ${instanceId}: total_groups=${totalGroups}, completed_groups=${completedGroups}, status=${status}`
    );

    await db.query(
      `
      UPDATE activity_instances
      SET total_groups    = ?,
          completed_groups = ?,
          progress_status  = ?
      WHERE id = ?
      `,
      [totalGroups || 0, completedGroups, status, instanceId]
    );
  }

  console.log('✅ Backfill complete.');
  process.exit(0);
}

backfill().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
