'use strict';

// When no student was in the activity. Built from 'member_joined' (first
// heartbeat after being away, with the previous heartbeat as lastSeenAt) and
// 'member_left' (leave beacon) events in audit_log, recorded from deployment
// onward. Time while every student member is away is removed from every
// duration, like an instructor pause: a group that leaves an unfinished
// activity and comes back later is not credited with the time in between.

/** Merge [start, end|null] intervals (null = open-ended) into sorted, disjoint ones. */
function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(([a, b]) => a != null && (b == null || b > a))
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && (last[1] == null || a <= last[1])) {
      last[1] = last[1] == null || b == null ? null : Math.max(last[1], b);
    } else {
      out.push([a, b]);
    }
  }
  return out;
}

const toMs = (value) => {
  if (value == null) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Presence intervals for one member: from each arrival until they next go away.
 * An absence starts at their last leave beacon before returning, or else at
 * their last heartbeat (tab closed without a beacon, laptop asleep).
 */
function memberPresence(joins, lefts) {
  const present = [];
  for (let i = 0; i < joins.length; i += 1) {
    const from = joins[i].at;
    const next = joins[i + 1] || null;
    let to = null;
    if (next) {
      const leftBetween = lefts.filter((l) => l > from && l <= next.at);
      to = leftBetween.length ? Math.max(...leftBetween) : (toMs(next.details?.lastSeenAt) ?? next.at);
      to = Math.min(Math.max(to, from), next.at);
    } else {
      const leftAfter = lefts.filter((l) => l > from);
      to = leftAfter.length ? Math.max(...leftAfter) : null;
    }
    present.push([from, to]);
  }
  return present;
}

/**
 * Intervals in which no student member was present, or [] when the run has no
 * presence data covering its start (runs before deployment, or runs already in
 * progress when it was deployed): absence is then unknown and nothing is removed.
 *
 * @param {Array<{type, at, userId, details}>} events  audit events, any order
 * @param {Set<number>} studentIds
 * @param {number|null} firstStudentActivityAt  first submit or activity slice
 */
function awayIntervals(events, studentIds, firstStudentActivityAt) {
  const joins = new Map();
  const lefts = new Map();
  for (const e of [...events].sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0))) {
    if (!studentIds.has(e.userId)) continue;
    if (e.type === 'member_joined') {
      if (!joins.has(e.userId)) joins.set(e.userId, []);
      joins.get(e.userId).push(e);
    } else if (e.type === 'member_left') {
      if (!lefts.has(e.userId)) lefts.set(e.userId, []);
      lefts.get(e.userId).push(e.at);
    }
  }
  const firstJoin = Math.min(...[...joins.values()].map((list) => list[0].at));
  if (!Number.isFinite(firstJoin)) return [];
  if (firstStudentActivityAt != null && firstJoin > firstStudentActivityAt) return [];

  const present = mergeIntervals(
    [...joins.entries()].flatMap(([id, list]) => memberPresence(list, lefts.get(id) || []))
  );
  // Before anyone arrived, and every gap between presence intervals.
  const away = [[0, present[0][0]]];
  for (let i = 0; i < present.length; i += 1) {
    const end = present[i][1];
    if (end == null) break;
    away.push([end, present[i + 1]?.[0] ?? null]);
  }
  return away;
}

module.exports = { awayIntervals, mergeIntervals, memberPresence };
