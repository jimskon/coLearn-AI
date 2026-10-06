// Layout for the instructor's activity strip (View Groups, Observation view).
// Pure: takes one group's live data from GET /api/research/live and "now", and
// returns positions in percent. Plain JS so it can be unit-tested with node.

export const FLAG_ACTIVE = 1;
export const FLAG_SANDBOX = 2;
export const FLAG_AI_WAIT = 4;

const MIN_SPAN_MS = 60 * 1000;

// Instructor pauses ([start, end|null]): students cannot act, so paused time
// never counts as idle, toward a section's minutes, or toward the plan.
function pausedWithin(pauses, a, b, now) {
  if (a == null || b == null || b <= a) return 0;
  let total = 0;
  for (const [start, endOrNull] of pauses || []) {
    const lo = Math.max(a, start);
    const hi = Math.min(b, endOrNull ?? now);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

function activeWithin(pauses, a, b, now) {
  if (a == null || b == null || b <= a) return 0;
  return b - a - pausedWithin(pauses, a, b, now);
}

// Wall-clock time at which `activeMs` of unpaused time has passed since `start`.
function wallTimeAfterActive(pauses, start, activeMs, now) {
  let cursor = start;
  let remaining = activeMs;
  for (const [ps, peOrNull] of [...(pauses || [])].sort((a, b) => a[0] - b[0])) {
    const pe = peOrNull ?? now;
    if (pe <= cursor) continue;
    if (ps >= cursor + remaining) break;
    remaining -= Math.max(0, ps - cursor);
    cursor = pe;
  }
  return cursor + remaining;
}

// The section a moment belongs to: the last section entered at or before it.
function sectionAt(sections, t) {
  let current = null;
  for (const s of sections || []) {
    if (s.enteredAt <= t) current = s;
    else break;
  }
  return current;
}

function isOverSection(section, t, pauses, now) {
  return !!(section && section.minutes && activeWithin(pauses, section.enteredAt, t, now) > section.minutes * 60000);
}

/**
 * @returns {{
 *   started: boolean,
 *   segments: Array<{left:number, width:number, kind:'active'|'sandbox'|'over'}>,
 *   dots: Array<{left:number, status:string}>,
 *   tags: Array<{left:number, label:string}>,     // instructor observation tags
 *   paused: boolean,               // an instructor pause is in effect now
 *   pauses: Array<{left:number, width:number}>,
 *   plannedEndLeft: number|null,   // shown once the activity runs past its planned time
 *   idleMs: number|null,
 *   section: {title, minutes, elapsedMs, overMs}|null,
 * }}
 */
export function computeStrip(live, now, sliceSeconds = 10) {
  const empty = { started: false, paused: false, segments: [], pauses: [], dots: [], tags: [], plannedEndLeft: null, idleMs: null, section: null };
  if (!live || live.startAt == null) return empty;

  const start = live.startAt;
  const pauses = live.pauses || [];
  const plannedMs = live.plannedMinutes ? live.plannedMinutes * 60000 : null;
  const elapsed = Math.max(0, now - start);
  const activeElapsed = activeWithin(pauses, start, now, now);
  const pausedSoFar = elapsed - activeElapsed;
  // Scaled to the planned time (plus any pauses so far); once the unpaused
  // time passes the plan, the whole strip compresses to fit.
  const span = Math.max((plannedMs || 0) + pausedSoFar, elapsed, MIN_SPAN_MS);
  const pct = (t) => Math.min(100, Math.max(0, ((t - start) / span) * 100));
  const sliceMs = sliceSeconds * 1000;

  // Color each slice, then merge adjacent slices of the same color.
  const colored = (live.slices || []).map(([t, flags]) => {
    const active = flags & (FLAG_ACTIVE | FLAG_AI_WAIT);
    if (!active && !(flags & FLAG_SANDBOX)) return null;
    const kind = isOverSection(sectionAt(live.sections, t), t, pauses, now) ? 'over' : active ? 'active' : 'sandbox';
    return { t, kind };
  }).filter(Boolean);

  const segments = [];
  for (const { t, kind } of colored) {
    const last = segments[segments.length - 1];
    if (last && last.kind === kind && t - last.end <= 0) last.end = t + sliceMs;
    else segments.push({ kind, startT: t, end: t + sliceMs });
  }

  const current = live.sections?.length ? live.sections[live.sections.length - 1] : null;
  const sectionElapsed = current ? activeWithin(pauses, current.enteredAt, now, now) : null;

  return {
    started: true,
    paused: pauses.some(([, end]) => end == null),
    pauses: pauses
      .map(([ps, pe]) => ({ left: pct(Math.max(ps, start)), right: pct(Math.min(pe ?? now, now)) }))
      .filter((p) => p.right > p.left)
      .map((p) => ({ left: p.left, width: p.right - p.left })),
    segments: segments.map((s) => ({
      kind: s.kind,
      left: pct(s.startT),
      width: Math.max(0.4, pct(s.end) - pct(s.startT)),
    })),
    dots: (live.submits || []).map(([t, status]) => ({ left: pct(t), status })),
    tags: (live.tags || []).map(([t, label]) => ({ left: pct(t), label })),
    plannedEndLeft: plannedMs && activeElapsed > plannedMs ? pct(wallTimeAfterActive(pauses, start, plannedMs, now)) : null,
    idleMs: live.lastActivityAt != null ? activeWithin(pauses, live.lastActivityAt, now, now) : null,
    section: current
      ? {
        title: current.title,
        minutes: current.minutes,
        elapsedMs: sectionElapsed,
        overMs: current.minutes ? Math.max(0, sectionElapsed - current.minutes * 60000) : 0,
      }
      : null,
  };
}

export function formatClock(ms) {
  if (ms == null) return '—';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
