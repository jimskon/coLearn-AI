import React from 'react';
import { OverlayTrigger, Popover } from 'react-bootstrap';
import { computeStrip, formatClock } from '../../utils/liveStrip';
import { OBSERVATION_BY_KEY, OBSERVATION_LABELS } from '../../utils/observationLabels';

// Colors are fixed (not theme-dependent) so they read the same on a projector
// and a tablet; every color is also explained in the legend.
const COLORS = {
  active: { background: '#a3cfbb', border: '#198754' },
  sandbox: { background: '#d1e7dd', border: '#75b798' },
  over: { background: '#ffe69c', border: '#cc9a06' },
};
const PAUSED_STYLE = {
  background: 'repeating-linear-gradient(135deg, #e9ecef 0 4px, #f8f9fa 4px 8px)',
  border: '#adb5bd',
};
const DOT_COLORS = { advanced: '#0d6efd', sent_back: '#dc3545', other: '#6c757d' };
const IDLE_WARN_MS = 2 * 60 * 1000;

const swatch = (c) => (
  <span style={{ display: 'inline-block', width: 16, height: 10, background: c.background, border: `1px solid ${c.border}`, marginRight: 6, verticalAlign: 'middle' }} />
);
const dot = (color) => (
  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: `2px solid ${color}`, marginRight: 6, verticalAlign: 'middle' }} />
);

/** Small "i" button that opens the key: strip colors, markers, and tag meanings. */
export function StripKeyButton() {
  const popover = (
    <Popover id="strip-key" style={{ maxWidth: 360 }}>
      <Popover.Header as="div" className="fw-semibold">Key</Popover.Header>
      <Popover.Body className="small">
        <div className="fw-semibold mb-1">Activity strip</div>
        <div className="text-muted mb-2">Start of the activity (left) to now (right), scaled to its planned time. When the activity runs over, the strip compresses and a dashed line marks the planned end.</div>
        <div className="mb-1">{swatch(COLORS.active)}Active: typing, running code, submitting, or waiting on the AI</div>
        <div className="mb-1">{swatch(COLORS.sandbox)}Only teammates working in their Local Sandbox</div>
        <div className="mb-1">{swatch({ background: '#fff', border: '#ced4da' })}Idle</div>
        <div className="mb-1">{swatch(PAUSED_STYLE)}Paused by the instructor (never counted as idle or toward any time)</div>
        <div className="mb-1">{swatch(COLORS.over)}Active, but past the current section&apos;s planned minutes</div>
        <div className="mb-1">{dot(DOT_COLORS.advanced)}Submit accepted, group moved on</div>
        <div className="mb-2">{dot(DOT_COLORS.sent_back)}Submit sent back by the AI</div>
        <div className="mb-1">Idle timer: time since the group&apos;s last activity, not counting pauses; red after 2 minutes.</div>
        <div className="fw-semibold mt-3 mb-1">Observation tags</div>
        <div className="text-muted mb-2">Tap what you see. Tags appear as squares above the strip; undo for 10 s.</div>
        {OBSERVATION_LABELS.map((l) => (
          <div key={l.key} className="mb-1">
            <span style={{ display: 'inline-block', minWidth: 46, textAlign: 'center', marginRight: 6, background: l.bg, border: `1px solid ${l.border}`, color: l.text, borderRadius: 4, padding: '0 4px' }}>
              {l.short}
            </span>
            <strong>{l.name}.</strong> {l.cue}
          </div>
        ))}
      </Popover.Body>
    </Popover>
  );
  return (
    <OverlayTrigger trigger="click" placement="bottom-end" overlay={popover} rootClose>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary rounded-circle d-inline-flex align-items-center justify-content-center"
        style={{ width: 26, height: 26, padding: 0, fontWeight: 600 }}
        aria-label="Key for the activity strip and observation tags"
        title="Key"
      >
        i
      </button>
    </OverlayTrigger>
  );
}

export default function GroupActivityStrip({ live, now, sliceSeconds = 10, finished = false, finishedLabel = 'finished' }) {
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
          <span className="text-muted">{finishedLabel}</span>
        ) : strip.paused ? (
          <span className="text-muted fw-semibold">paused</span>
        ) : (
          <span className={idle != null && idle >= IDLE_WARN_MS ? 'fw-semibold text-danger' : 'text-muted'}>
            idle {formatClock(idle)}
          </span>
        )}
      </div>

      <div style={{ position: 'relative', height: 10, marginBottom: 2 }}>
        {strip.tags.map((tag, i) => {
          const label = OBSERVATION_BY_KEY[tag.label];
          return (
            <span
              key={i}
              title={label ? `Tagged: ${label.name}` : tag.label}
              style={{
                position: 'absolute', left: `calc(${tag.left}% - 4px)`, top: 0, width: 9, height: 9, borderRadius: 2,
                background: label?.bg || '#fff', border: `1px solid ${label?.border || '#6c757d'}`,
              }}
            />
          );
        })}
      </div>
      <div
        style={{ position: 'relative', height: 16, border: '1px solid #ced4da', borderRadius: 3, background: '#fff' }}
        aria-label="Activity over time"
      >
        {strip.pauses.map((p, i) => (
          <div
            key={`pause-${i}`}
            title="Paused by the instructor"
            style={{ position: 'absolute', top: 1, bottom: 1, left: `${p.left}%`, width: `${p.width}%`, background: PAUSED_STYLE.background }}
          />
        ))}
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
