'use strict';

// "Ended - incomplete". A group activity run whose students have all been away
// for AWAY_MINUTES before finishing is ended: ended_at is set and the turn is
// cleared, so nobody can answer, submit, or use AI help any more. Students can
// still open it to review their work and try code in their Local Sandbox. An
// instructor can reopen it from View Groups (ended_at back to NULL) for a
// chosen number of minutes; it is not ended again before those minutes pass.
//
// Only group activities (\mode{group}, the default): not tests, assignments,
// demos, playgrounds, demo classes, or sandbox runs. A run must have at least one
// group submit, so opening an activity early and closing it never ends it.

const db = require('../db');
const { recordAuditEvent } = require('../utils/auditLogger');
const { recordTurnChange, TURN_REASONS } = require('../utils/turnEvents');
const { inferActivityTypeFromActivity } = require('../utils/activityType');
const { ensureEndedAtSchema } = require('../utils/instanceEnded');
const { ensureDemoModeSchema } = require('../utils/demoModeSchema');

const AWAY_MINUTES = 15;
// Runs whose students left before this feature existed are left as they were:
// only runs with a heartbeat in the last day are considered.
const LOOKBACK_HOURS = 24;
const CHECK_EVERY_MS = 60 * 1000;

const typeCache = new Map(); // activityId -> { key, type }

async function activityType(activity) {
  const key = `${activity.source_revision ?? ''}:${activity.source_updated_at ?? ''}:${activity.is_test}`;
  const cached = typeCache.get(activity.id);
  if (cached && cached.key === key) return cached.type;
  const type = await inferActivityTypeFromActivity(activity);
  typeCache.set(activity.id, { key, type });
  return type;
}

/** Runs to end now: group activities, started, unfinished, everyone gone 15+ min. */
async function findCandidates() {
  const [rows] = await db.query(
    `SELECT ai.id AS instanceId, ai.active_student_id AS activeStudentId,
            a.id, a.is_test, a.source_type, a.sheet_url, a.content_text,
            a.source_revision, a.source_updated_at,
            -- When students were last here. No heartbeat at all means everyone
            -- logged out under the old logout, which erased it; the run's last
            -- saved response is then the best evidence of when they left.
            -- An instructor reopen counts as "here", so a run reopened long
            -- after everyone left is not skipped by the lookback window.
            GREATEST(
              COALESCE(
                presence.lastHeartbeat,
                (SELECT MAX(r.submitted_at) FROM responses r WHERE r.activity_instance_id = ai.id)
              ),
              COALESCE(
                (SELECT MAX(al.created_at) FROM audit_log al
                  WHERE al.activity_instance_id = ai.id AND al.event_type = 'activity_reopened'),
                '1970-01-01'
              )
            ) AS lastSeen
       FROM activity_instances ai
       JOIN pogil_activities a ON a.id = ai.activity_id
       JOIN courses c ON c.id = ai.course_id
       LEFT JOIN pogil_classes pc ON pc.id = c.class_id
       JOIN (
         SELECT activity_instance_id, MAX(last_heartbeat) AS lastHeartbeat
           FROM group_members
          GROUP BY activity_instance_id
       ) presence ON presence.activity_instance_id = ai.id
      WHERE ai.ended_at IS NULL
        AND ai.progress_status <> 'completed'
        AND ai.submitted_at IS NULL
        AND ai.sandbox_owner_id IS NULL
        AND COALESCE(ai.active_rotation_mode, '') <> 'sandbox'
        AND COALESCE(pc.demo_mode, 0) = 0
        AND COALESCE(a.is_test, 0) = 0
        AND EXISTS (
          SELECT 1 FROM responses r
           WHERE r.activity_instance_id = ai.id
             AND BINARY r.question_id REGEXP '^[0-9]+state$'
        )
     HAVING lastSeen < NOW() - INTERVAL ? MINUTE
        AND lastSeen > NOW() - INTERVAL ? HOUR`,
    [AWAY_MINUTES, LOOKBACK_HOURS]
  );
  return rows;
}

/**
 * True while an instructor reopen is still in force: the instructor chose how
 * many minutes the group has to come back, and the run is left open until then.
 */
async function inReopenWindow(instanceId) {
  const [[row]] = await db.query(
    `SELECT details, created_at AS at, NOW() AS now
       FROM audit_log
      WHERE activity_instance_id = ? AND event_type = 'activity_reopened'
      ORDER BY id DESC LIMIT 1`,
    [instanceId]
  );
  if (!row) return false;
  let minutes = AWAY_MINUTES;
  try {
    const m = Number(JSON.parse(row.details || '{}').minutes);
    if (m > 0) minutes = m;
  } catch { /* older reopen without minutes */ }
  return new Date(row.at).getTime() + minutes * 60000 > new Date(row.now).getTime();
}

async function endRun(row) {
  const [result] = await db.query(
    `UPDATE activity_instances
        SET ended_at = NOW(), active_student_id = NULL
      WHERE id = ? AND ended_at IS NULL AND progress_status <> 'completed'`,
    [row.instanceId]
  );
  if (!result?.affectedRows) return false;
  recordTurnChange(null, row.instanceId, row.activeStudentId, null, TURN_REASONS.ENDED_INCOMPLETE);
  void recordAuditEvent('activity_ended_incomplete', {
    activityInstanceId: row.instanceId,
    details: { awayMinutes: AWAY_MINUTES },
  });
  global.emitInstanceState?.(Number(row.instanceId), {
    ended_at: new Date().toISOString(),
    activeStudentId: null,
  });
  return true;
}

let running = false;

async function endAbandonedRuns() {
  if (running) return 0;
  running = true;
  let ended = 0;
  try {
    await ensureEndedAtSchema();
    await ensureDemoModeSchema();
    for (const row of await findCandidates()) {
      if ((await activityType(row)) !== 'group') continue;
      if (await inReopenWindow(row.instanceId)) continue;
      if (await endRun(row)) {
        ended += 1;
        console.log(`⏹️ auto-end: run ${row.instanceId} ended (everyone away ${AWAY_MINUTES}+ min)`);
      }
    }
  } catch (err) {
    console.error('❌ auto-end:', err);
  } finally {
    running = false;
  }
  return ended;
}

function startAutoEnd() {
  const timer = setInterval(endAbandonedRuns, CHECK_EVERY_MS);
  timer.unref?.();
  return timer;
}

module.exports = { startAutoEnd, endAbandonedRuns, AWAY_MINUTES };
