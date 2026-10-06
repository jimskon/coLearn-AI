import React from 'react';
import { computeStrip, formatClock } from '../../utils/liveStrip';

// Colors are fixed (not theme-dependent) so they read the same on a projector
// and a tablet; every color is also explained in the legend.
const COLORS = {
  active: { background: '#a3cfbb', border: '#198754' },
  sandbox: { background: '#d1e7dd', border: '#75b798' },
  over: { background: '#ffe69c', border: '#cc9a06' },
};
const DOT_COLORS = { advanced: '#0d6efd', sent_back: '#dc3545', other: '#6c757d' };
const IDLE_WARN_MS = 2 * 60 * 1000;

export function StripLegend() {
  const swatch = (c) => (
    <span style={{ display: 'inline-block', width: 14, height: 10, background: c.background, border: `1px solid ${c.border}`, marginRight: 4, verticalAlign: 'middle' }} />
  );
  const dot = (color) => (
    <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', border: `2px solid ${color}`, marginRight: 4, verticalAlign: 'middle' }} />
  );
  return (
    <div className="d-flex flex-wrap gap-3 small text-muted mb-3">
      <span>{swatch(COLORS.active)}active</span>
      <span>{swatch(COLORS.sandbox)}others working in their sandbox</span>
      <span>{swatch({ background: '#fff', border: '#ced4da' })}idle</span>
      <span>{swatch(COLORS.over)}past the current section&apos;s time</span>
      <span>{dot(DOT_COLORS.advanced)}submit accepted</span>
      <span>{dot(DOT_COLORS.sent_back)}submit sent back</span>
      <span>Strip: start (left) to now (right), scaled to the planned time; compresses when over.</span>
    </div>
  );
}

export default function GroupActivityStrip({ live, now, sliceSeconds = 10, finished = false }) {
  const strip = computeStrip(live, now, sliceSeconds);

  if (!strip.started) {
    return <div className="small text-muted">Not started</div>;
  }

  const idle = strip.idleMs;
  const section = strip.section;

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center small mb-1 gap-2 flex-wrap">
        <span className="text-muted text-truncate" style={{ maxWidth: '65%' }} title={section?.title || ''}>
          {section
            ? (
              <>
                {section.title || 'Section'}
                {section.minutes
                  ? section.overMs > 0
                    ? <span className="ms-1 fw-semibold" style={{ color: '#997404' }}>+{formatClock(section.overMs)} over</span>
                    : <span className="ms-1">{formatClock(section.elapsedMs)} of {section.minutes} min</span>
                  : null}
              </>
            )
            : null}
        </span>
        {finished ? (
          <span className="text-muted">finished</span>
        ) : (
          <span className={idle != null && idle >= IDLE_WARN_MS ? 'fw-semibold text-danger' : 'text-muted'}>
            idle {formatClock(idle)}
          </span>
        )}
      </div>

      <div
        style={{ position: 'relative', height: 16, border: '1px solid #ced4da', borderRadius: 3, background: '#fff' }}
        aria-label="Activity over time"
      >
        {strip.segments.map((s, i) => (
          <div
            key={i}
            style={{
              position: 'absolute', top: 1, bottom: 1, left: `${s.left}%`, width: `${s.width}%`,
              background: COLORS[s.kind].background, borderLeft: `1px solid ${COLORS[s.kind].border}`,
            }}
          />
        ))}
        {strip.plannedEndLeft != null && (
          <div
            title="Planned end of the activity"
            style={{ position: 'absolute', top: -4, bottom: -4, left: `${strip.plannedEndLeft}%`, borderLeft: '2px dashed #6c757d' }}
          />
        )}
      </div>

      <div style={{ position: 'relative', height: 12, marginTop: 2 }}>
        {strip.dots.map((d, i) => (
          <span
            key={i}
            title={d.status === 'advanced' ? 'Submit accepted' : d.status === 'sent_back' ? 'Submit sent back' : 'Submit'}
            style={{
              position: 'absolute', left: `calc(${d.left}% - 4px)`, top: 1, width: 9, height: 9, borderRadius: '50%',
              border: `2px solid ${DOT_COLORS[d.status] || DOT_COLORS.other}`, background: '#fff',
            }}
          />
        ))}
      </div>
    </div>
  );
}
