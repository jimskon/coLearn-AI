// Layout for the instructor's activity strip (View Groups, Observation view).
// Pure: takes one group's live data from GET /api/research/live and "now", and
// returns positions in percent. Plain JS so it can be unit-tested with node.

export const FLAG_ACTIVE = 1;
export const FLAG_SANDBOX = 2;
export const FLAG_AI_WAIT = 4;

const MIN_SPAN_MS = 60 * 1000;

// The section a moment belongs to: the last section entered at or before it.
function sectionAt(sections, t) {
  let current = null;
  for (const s of sections || []) {
    if (s.enteredAt <= t) current = s;
    else break;
  }
  return current;
}

function isOverSection(section, t) {
  return !!(section && section.minutes && t > section.enteredAt + section.minutes * 60000);
}

/**
 * @returns {{
 *   started: boolean,
 *   segments: Array<{left:number, width:number, kind:'active'|'sandbox'|'over'}>,
 *   dots: Array<{left:number, status:string}>,
 *   plannedEndLeft: number|null,   // shown once the activity runs past its planned time
 *   idleMs: number|null,
 *   section: {title, minutes, elapsedMs, overMs}|null,
 * }}
 */
export function computeStrip(live, now, sliceSeconds = 10) {
  const empty = { started: false, segments: [], dots: [], plannedEndLeft: null, idleMs: null, section: null };
  if (!live || live.startAt == null) return empty;

  const start = live.startAt;
  const plannedMs = live.plannedMinutes ? live.plannedMinutes * 60000 : null;
  const elapsed = Math.max(0, now - start);
  // Scaled to the planned time; once past it, the whole strip compresses to fit.
  const span = Math.max(plannedMs || 0, elapsed, MIN_SPAN_MS);
  const pct = (t) => Math.min(100, Math.max(0, ((t - start) / span) * 100));
  const sliceMs = sliceSeconds * 1000;

  // Color each slice, then merge adjacent slices of the same color.
  const colored = (live.slices || []).map(([t, flags]) => {
    const active = flags & (FLAG_ACTIVE | FLAG_AI_WAIT);
    if (!active && !(flags & FLAG_SANDBOX)) return null;
    const kind = isOverSection(sectionAt(live.sections, t), t) ? 'over' : active ? 'active' : 'sandbox';
    return { t, kind };
  }).filter(Boolean);

  const segments = [];
  for (const { t, kind } of colored) {
    const last = segments[segments.length - 1];
    if (last && last.kind === kind && t - last.end <= 0) last.end = t + sliceMs;
    else segments.push({ kind, startT: t, end: t + sliceMs });
  }

  const current = live.sections?.length ? live.sections[live.sections.length - 1] : null;
  const sectionElapsed = current ? now - current.enteredAt : null;

  return {
    started: true,
    segments: segments.map((s) => ({
      kind: s.kind,
      left: pct(s.startT),
      width: Math.max(0.4, pct(s.end) - pct(s.startT)),
    })),
    dots: (live.submits || []).map(([t, status]) => ({ left: pct(t), status })),
    plannedEndLeft: plannedMs && elapsed > plannedMs ? pct(start + plannedMs) : null,
    idleMs: live.lastActivityAt != null ? Math.max(0, now - live.lastActivityAt) : null,
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
