import React from 'react';
import { Modal, Button, Spinner, Alert, Table, Badge } from 'react-bootstrap';
import { API_BASE_URL } from '../../config';

/**
 * Instructor summary of one activity across its groups (View Groups):
 * per-question time and submit statistics, a per-group table, and a saved
 * AI review of where groups struggled and what could be improved.
 * Statistics come from the research reconstruction (/api/research/summary).
 */

const OUTCOME = {
  ai_accepted: { label: 'Accepted', short: '✓', variant: 'success' },
  continued: { label: 'Continue (bypass)', short: 'C', variant: 'warning' },
  instructor_advanced: { label: 'Instructor advanced', short: 'I', variant: 'info' },
  unresolved: { label: 'Unresolved', short: '?', variant: 'danger' },
  advanced_other: { label: 'Advanced', short: '→', variant: 'secondary' },
  survey: { label: 'Survey', short: 'S', variant: 'light' },
  not_attempted: { label: 'Not attempted', short: '–', variant: 'light' },
};

const STATUS = { completed: 'Completed in class', not_finished: 'Not finished in class', no_submits: 'No submits' };

function fmtTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

const fmtNum = (n) => (n == null || !Number.isFinite(n) ? '—' : (Math.round(n * 10) / 10).toString());

function statCells(d, fmt) {
  return ['min', 'median', 'mean', 'max'].map((k) => (
    <td key={k} className="text-end">{d ? fmt(d[k]) : '—'}</td>
  ));
}

// Highlight the questions that stand out: the slowest and most-retried quarter.
function topQuarter(questions, pick) {
  const values = questions.map(pick).filter((v) => v != null).sort((a, b) => b - a);
  if (values.length < 4) return Infinity;
  return values[Math.floor(values.length / 4) - 1] ?? Infinity;
}

export default function ActivitySummaryModal({ show, onHide, courseId, activityId, groups = [], onOpenGroup }) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState('');

  React.useEffect(() => {
    if (!show) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`${API_BASE_URL}/api/research/summary/${courseId}/${activityId}`, { credentials: 'include' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'Could not load the summary');
        if (!cancelled) setData(json);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [show, courseId, activityId]);

  const generateAi = async () => {
    setAiBusy(true);
    setAiError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/research/summary/${courseId}/${activityId}/ai`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Could not generate the AI summary');
      setData((prev) => ({ ...prev, ai: json }));
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiBusy(false);
    }
  };

  const groupByInstance = new Map(groups.map((g) => [Number(g.instance_id), g]));
  const groupLabel = (instanceId) => {
    const g = groupByInstance.get(Number(instanceId));
    return g ? `Group ${g.group_number}` : `Run ${instanceId}`;
  };
  const groupNames = (instanceId) => (groupByInstance.get(Number(instanceId))?.members || [])
    .map((m) => m.name).filter(Boolean).join(', ');

  const questions = data?.questions || [];
  const slowCut = topQuarter(questions, (q) => q.seconds?.median ?? null);
  const retryCut = topQuarter(questions, (q) => q.submits?.mean ?? null);
  const ai = data?.ai;

  return (
    <Modal show={show} onHide={onHide} size="xl" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>Activity summary{data?.activityTitle ? `: ${data.activityTitle}` : ''}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading && !data ? <Spinner animation="border" /> : null}
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {data && !data.groups.length ? (
          <Alert variant="info">No student groups to summarize yet. Tests, sandbox runs, and groups with no students are not included.</Alert>
        ) : null}

        {data && data.groups.length ? (
          <>
            <p className="text-muted small mb-3">
              {data.groups.length} group{data.groups.length === 1 ? '' : 's'}
              {' · '}{data.groups.filter((g) => g.status === 'completed').length} completed in class
              {' · '}group time: median {fmtTime(data.groupTotalSeconds?.median)}, range {fmtTime(data.groupTotalSeconds?.min)}–{fmtTime(data.groupTotalSeconds?.max)}
              {data.plannedMinutes ? ` (planned ${data.plannedMinutes} min)` : ''}.
              {' '}Time is active work from when a group reaches a question until it is accepted or left;
              {' '}idle gaps count at most {data.idleMinutes} min. Only in-class work counts: work after a break
              {' '}of more than {data.breakMinutes ?? 30} min, or more than {data.maxSessionMinutes ?? 60} min after a group started, is not counted
              {data.groupsWithAfterClassWork ? ` (${data.groupsWithAfterClassWork} group${data.groupsWithAfterClassWork === 1 ? '' : 's'} had after-class work)` : ''}.
              {' '}Submits are evaluated attempts.
            </p>

            {data.tokenLimits?.length ? (
              <Alert variant="warning" className="small">
                <strong>The AI ran out of output tokens during this activity</strong>, so some feedback or grades may be missing or cut short:
                <ul className="mb-1">
                  {data.tokenLimits.map((t) => (
                    <li key={`${t.setting}|${t.where}`}>
                      {t.where || 'AI call'}: {t.count} time{t.count === 1 ? '' : 's'} (<code>{t.setting}</code>{t.limit ? ` = ${t.limit}` : ''})
                    </li>
                  ))}
                </ul>
                Raise the setting in <code>server/.env</code> and restart the server. Affected graded questions can then be regraded.
              </Alert>
            ) : null}

            <h5>By question</h5>
            <div className="table-responsive mb-4">
              <Table size="sm" bordered hover className="align-middle small">
                <thead className="table-light">
                  <tr>
                    <th rowSpan={2}>Q</th>
                    <th rowSpan={2} className="text-end">Groups</th>
                    <th colSpan={4} className="text-center">Time</th>
                    <th colSpan={4} className="text-center">Submits</th>
                    <th rowSpan={2} className="text-end" title="Accepted on the first submit">1st try</th>
                    <th rowSpan={2} className="text-end" title="Skipped with the Continue button">Continue</th>
                    <th rowSpan={2} className="text-end" title="Advanced by the instructor">Instr.</th>
                    <th rowSpan={2} className="text-end" title="Attempted but never accepted or left">Unres.</th>
                  </tr>
                  <tr>
                    <th className="text-end">min</th><th className="text-end">median</th><th className="text-end">mean</th><th className="text-end">max</th>
                    <th className="text-end">min</th><th className="text-end">median</th><th className="text-end">mean</th><th className="text-end">max</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => {
                    const slow = (q.seconds?.median ?? -1) >= slowCut;
                    const retried = (q.submits?.mean ?? -1) >= retryCut;
                    return (
                      <tr key={q.qid} className={slow || retried ? 'table-warning' : undefined}>
                        <td>
                          <strong>{q.qid}</strong>
                          {q.hasCode ? <Badge bg="secondary" className="ms-1">code</Badge> : null}
                          {q.isSurvey ? <Badge bg="light" text="dark" className="ms-1">survey</Badge> : null}
                        </td>
                        <td className="text-end">{q.reached}</td>
                        {statCells(q.seconds, fmtTime)}
                        {statCells(q.submits, fmtNum)}
                        <td className="text-end">{q.reached ? q.firstTryAccepted : '—'}</td>
                        <td className="text-end">{q.continued || ''}</td>
                        <td className="text-end">{q.instructorAdvanced || ''}</td>
                        <td className="text-end">{q.unresolved || ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <div className="small text-muted">Highlighted: among the slowest or most-retried quarter of questions.</div>
            </div>

            <h5>By group</h5>
            <div className="table-responsive mb-2">
              <Table size="sm" bordered hover className="align-middle small">
                <thead className="table-light">
                  <tr>
                    <th>Group</th>
                    <th>Status</th>
                    <th className="text-end">Total</th>
                    {questions.map((q) => <th key={q.qid} className="text-center">{q.qid}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => (
                    <tr key={g.instanceId}>
                      <td>
                        {onOpenGroup ? (
                          <Button variant="link" size="sm" className="p-0" onClick={() => onOpenGroup(g.instanceId)}>
                            {groupLabel(g.instanceId)}
                          </Button>
                        ) : groupLabel(g.instanceId)}
                        <div className="text-muted">{groupNames(g.instanceId)}</div>
                      </td>
                      <td>{STATUS[g.status] || g.status}</td>
                      <td className="text-end">{fmtTime(g.totalSeconds)}</td>
                      {questions.map((q) => {
                        const cell = g.questions[q.qid];
                        if (!cell) return <td key={q.qid} className="text-center text-muted">–</td>;
                        const o = OUTCOME[cell.outcome] || OUTCOME.advanced_other;
                        return (
                          <td key={q.qid} className="text-center text-nowrap" title={`${o.label} · ${cell.submits} submit${cell.submits === 1 ? '' : 's'}`}>
                            {fmtTime(cell.seconds)}
                            <div>
                              {cell.submits}× <Badge bg={o.variant} text={o.variant === 'light' || o.variant === 'warning' ? 'dark' : undefined}>{o.short}</Badge>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <div className="small text-muted mb-4">
              Each cell: time, then submits and outcome —{' '}
              {['ai_accepted', 'continued', 'instructor_advanced', 'unresolved'].map((k) => (
                <span key={k} className="me-2"><Badge bg={OUTCOME[k].variant} text={k === 'continued' ? 'dark' : undefined}>{OUTCOME[k].short}</Badge> {OUTCOME[k].label}</span>
              ))}
            </div>

            <div className="d-flex align-items-center justify-content-between mb-2">
              <h5 className="mb-0">AI review</h5>
              <Button size="sm" variant="outline-primary" onClick={generateAi} disabled={aiBusy}>
                {aiBusy ? <><Spinner size="sm" animation="border" className="me-1" />Generating…</> : (ai ? 'Regenerate' : 'Generate AI summary')}
              </Button>
            </div>
            {aiError ? <Alert variant="danger">{aiError}</Alert> : null}
            {ai ? (
              <div className="border rounded p-3 bg-light">
                <div className="small text-muted mb-2">
                  Generated {new Date(ai.generatedAt).toLocaleString()} from {ai.groups} group{ai.groups === 1 ? '' : 's'}
                  {ai.groups !== data.groups.length ? ' (the groups have changed since — regenerate to update)' : ''}.
                </div>
                {ai.overview ? <p>{ai.overview}</p> : null}
                {ai.struggles?.length ? (
                  <>
                    <h6>Where groups struggled</h6>
                    <ul>{ai.struggles.map((s, i) => <li key={i}>{s.question ? <strong>{s.question}: </strong> : null}{s.observation}</li>)}</ul>
                  </>
                ) : null}
                {ai.improvements?.length ? (
                  <>
                    <h6>Suggested improvements</h6>
                    <ul>{ai.improvements.map((s, i) => <li key={i}>{s.question ? <strong>{s.question}: </strong> : null}{s.suggestion}</li>)}</ul>
                  </>
                ) : null}
                {ai.timing ? (<><h6>Timing</h6><p className="mb-0">{ai.timing}</p></>) : null}
              </div>
            ) : (
              <p className="text-muted small">
                Sends the activity, these statistics, and samples of the AI feedback on rejected answers (no student names) for a review. The result is saved for next time.
              </p>
            )}
          </>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}
