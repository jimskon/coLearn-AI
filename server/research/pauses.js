'use strict';

// Instructor pauses. While an activity is paused students cannot act, so paused
// time is never counted as idle or as time spent: every duration subtracts it.
// Pause/resume events are recorded per run in audit_log ('activity_paused',
// 'activity_resumed') from deployment onward; earlier pauses are unknown.

/** [[startMs, endMs|null], ...] from pause/resume events (null end = still paused). */
function pauseIntervals(events = []) {
  const sorted = events
    .filter((e) => e.type === 'activity_paused' || e.type === 'activity_resumed')
    .sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));
  const intervals = [];
  let open = null;
  for (const e of sorted) {
    if (e.type === 'activity_paused') {
      if (open == null) open = e.at;
    } else if (open != null) {
      intervals.push([open, e.at]);
      open = null;
    }
  }
  if (open != null) intervals.push([open, null]);
  return intervals;
}

/** Milliseconds of [a, b] that fall inside a pause. `now` closes an open pause. */
function pausedWithin(intervals, a, b, now = Date.now()) {
  if (a == null || b == null || b <= a) return 0;
  let total = 0;
  for (const [start, endOrNull] of intervals) {
    const end = endOrNull ?? now;
    const lo = Math.max(a, start);
    const hi = Math.min(b, end);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

/** Unpaused milliseconds in [a, b]. */
function activeWithin(intervals, a, b, now = Date.now()) {
  if (a == null || b == null || b <= a) return 0;
  return b - a - pausedWithin(intervals, a, b, now);
}

module.exports = { pauseIntervals, pausedWithin, activeWithin };
