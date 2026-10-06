import React from 'react';
import { API_BASE_URL } from '../../config';
import { OBSERVATION_BY_KEY, OBSERVATION_LABELS } from '../../utils/observationLabels';
import { formatClock } from '../../utils/liveStrip';

const UNDO_MS = 10 * 1000;

/**
 * Tag what a group is doing (View Groups, Observation view). Buttons keep fixed
 * positions so they can be learned; "Code" is disabled unless the current
 * question group has code. Each tag can be undone for 10 seconds.
 */
export default function ObservationButtons({ instanceId, hasCode, now, onTagged }) {
  const [last, setLast] = React.useState(null); // { id, label, at }
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const tag = async (label) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/research/observations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId, label }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Could not save the tag');
      setLast({ id: json.id, label, at: Date.now() });
      onTagged?.();
    } catch (err) {
      setError(err?.message || 'Could not save the tag');
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!last) return;
    const { id } = last;
    setLast(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/research/observations/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || 'Could not undo');
      }
      onTagged?.();
    } catch (err) {
      setError(err?.message || 'Could not undo');
    }
  };

  const sinceLast = last ? Math.max(0, (now ?? Date.now()) - last.at) : null;
  const canUndo = last && sinceLast < UNDO_MS;

  return (
    <div style={{ width: 132 }}>
      <div className="d-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {OBSERVATION_LABELS.map((l) => {
          const disabled = saving || (l.codeOnly && !hasCode);
          return (
            <button
              key={l.key}
              type="button"
              onClick={() => tag(l.key)}
              disabled={disabled}
              title={l.codeOnly && !hasCode ? `${l.name} (this question group has no code)` : `${l.name}: ${l.cue}`}
              style={{
                minHeight: 36,
                background: l.bg,
                border: `1px solid ${l.border}`,
                color: l.text,
                borderRadius: 6,
                fontSize: '0.85rem',
                fontWeight: 600,
                opacity: disabled ? 0.35 : 1,
              }}
            >
              {l.short}
            </button>
          );
        })}
      </div>
      <div className="small mt-1" style={{ minHeight: 18 }}>
        {error ? <span className="text-danger">{error}</span> : last ? (
          <span className="text-muted">
            {OBSERVATION_BY_KEY[last.label]?.short} · {formatClock(sinceLast)} ago
            {canUndo ? (
              <button type="button" className="btn btn-link btn-sm p-0 ms-1 align-baseline" onClick={undo}>Undo</button>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
