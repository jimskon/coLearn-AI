import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, ButtonGroup, Spinner, Alert, Table, ProgressBar, Badge } from 'react-bootstrap';
import { API_BASE_URL } from '../../config';
import { parseSheetToBlocks } from '../../utils/parseSheet';
import { parseMultipleChoiceSelections } from '../../utils/multipleChoice';

/**
 * Results of a \mode{survey} activity for the instructor (View Groups).
 *
 * The server sends respondents in random order with no names or ids, so
 * nothing here can tie an answer to a student. The completion list shows who
 * submitted, never what they answered.
 */

const stripHtml = (html) => {
  const div = document.createElement('div');
  div.innerHTML = String(html || '');
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
};

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

// One entry per question, with the answer keys it uses (same keys the run page saves).
function surveyQuestions(lines) {
  const parsed = parseSheetToBlocks(lines || [], { returnIssues: true });
  return (parsed?.blocks || [])
    .filter((b) => b.type === 'question')
    .map((q) => {
      const qid = `${q.groupId}${q.id}`;
      const mc = q.multipleChoice?.choices?.length ? q.multipleChoice : null;
      const tables = (q.tableBlocks || []).map((t, ti) => {
        const header = (t.rows[0] || []).map((c) => (c.type === 'input' ? '' : stripHtml(c.content)));
        const cells = [];
        t.rows.forEach((row, ri) => row.forEach((cell, ci) => {
          if (cell.type !== 'input') return;
          const rowLabel = row.map((c) => (c.type === 'input' ? '' : stripHtml(c.content))).find(Boolean) || `row ${ri + 1}`;
          cells.push({
            key: `${qid}table${ti}cell${ri}_${ci}`,
            label: [rowLabel, header[ci]].filter(Boolean).join(' / ') || `row ${ri + 1}, column ${ci + 1}`,
          });
        }));
        return { title: stripHtml(t.title), cells };
      });
      return {
        qid,
        prompt: q.prompt || '',
        promptText: stripHtml(q.prompt) || `Question ${qid}`,
        mc,
        multiple: mc?.selectionMode === 'multiple',
        hasText: !mc && (!!q.hasTextResponse || !tables.length),
        tables,
      };
    });
}

function choiceCounts(q, respondents) {
  const counts = new Map(q.mc.choices.map((c) => [c.value, 0]));
  let answered = 0;
  for (const r of respondents) {
    const raw = r[q.qid];
    const picked = q.multiple ? parseMultipleChoiceSelections(raw) : (raw ? [String(raw)] : []);
    if (picked.length) answered += 1;
    for (const v of picked) if (counts.has(v)) counts.set(v, counts.get(v) + 1);
  }
  return { counts, answered };
}

const textAnswers = (key, respondents) =>
  respondents.map((r) => String(r[key] || '').trim()).filter(Boolean);

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(questions, respondents) {
  const cols = [];
  for (const q of questions) {
    if (q.mc) cols.push({ head: `${q.qid}: ${q.promptText}`, get: (r) => (q.multiple ? parseMultipleChoiceSelections(r[q.qid]).join('; ') : r[q.qid] || '') });
    if (q.hasText) cols.push({ head: `${q.qid}: ${q.promptText}`, get: (r) => r[q.qid] || '' });
    for (const t of q.tables) for (const c of t.cells) cols.push({ head: `${q.qid} ${t.title ? `${t.title} ` : ''}(${c.label})`, get: (r) => r[c.key] || '' });
  }
  const rows = [['Respondent', ...cols.map((c) => c.head)]];
  respondents.forEach((r, i) => rows.push([i + 1, ...cols.map((c) => c.get(r))]));
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

// Anonymous results as text for the AI summary.
function buildDigest(questions, respondents) {
  const out = [`Respondents: ${respondents.length}`, ''];
  for (const q of questions) {
    out.push(`Question ${q.qid}: ${q.promptText}`);
    if (q.mc) {
      const { counts, answered } = choiceCounts(q, respondents);
      out.push(q.multiple ? `(select all that apply; ${answered} answered)` : `(${answered} answered)`);
      for (const c of q.mc.choices) out.push(`- ${c.value}: ${counts.get(c.value)} (${pct(counts.get(c.value), answered)}%)`);
    }
    if (q.hasText) {
      const answers = textAnswers(q.qid, respondents);
      out.push(`Written answers (${answers.length}):`);
      for (const a of answers) out.push(`- ${a.replace(/\s+/g, ' ').slice(0, 800)}`);
    }
    for (const t of q.tables) {
      for (const c of t.cells) {
        const answers = textAnswers(c.key, respondents);
        if (!answers.length) continue;
        out.push(`Table ${t.title || ''} (${c.label}):`);
        for (const a of answers) out.push(`- ${a.slice(0, 300)}`);
      }
    }
    out.push('');
  }
  return out.join('\n');
}

function AnswerList({ answers }) {
  if (!answers.length) return <div className="text-muted small">No answers.</div>;
  return (
    <ul className="small mb-0" style={{ maxHeight: '16em', overflowY: 'auto' }}>
      {answers.map((a, i) => <li key={i} style={{ whiteSpace: 'pre-wrap' }}>{a}</li>)}
    </ul>
  );
}

export default function SurveyResultsModal({ show, onHide, courseId, activityId }) {
  const [scope, setScope] = useState('course');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [showCompletion, setShowCompletion] = useState(false);

  useEffect(() => {
    if (!show) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`${API_BASE_URL}/api/activity-instances/survey-results/${courseId}/${activityId}?scope=${scope}`, { credentials: 'include' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        if (!cancelled) setData(json);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load results.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [show, scope, courseId, activityId]);

  const questions = useMemo(() => (data ? surveyQuestions(data.lines) : []), [data]);
  const respondents = data?.respondents || [];
  const completion = data?.completion || [];
  const submitted = completion.filter((c) => c.status === 'submitted').length;

  const downloadCsv = () => {
    const blob = new Blob([`﻿${buildCsv(questions, respondents)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = String(data?.activityTitle || 'survey').replace(/[^\w-]+/g, '_').slice(0, 60);
    a.href = url;
    a.download = `${name}_${scope === 'class' ? 'all_courses' : 'course'}_results.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const summarize = async () => {
    setAiBusy(true);
    setAiError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/survey-results/${courseId}/${activityId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scope, respondents: respondents.length, digest: buildDigest(questions, respondents) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData((prev) => ({ ...prev, ai: json }));
    } catch (err) {
      setAiError(err.message || 'Could not summarize.');
    } finally {
      setAiBusy(false);
    }
  };

  const ai = data?.ai;

  return (
    <Modal show={show} onHide={onHide} size="xl" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>Survey results{data?.activityTitle ? `: ${data.activityTitle}` : ''}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <ButtonGroup size="sm">
            <Button variant={scope === 'course' ? 'secondary' : 'outline-secondary'} onClick={() => setScope('course')}>This course</Button>
            <Button variant={scope === 'class' ? 'secondary' : 'outline-secondary'} onClick={() => setScope('class')}>All courses in the class</Button>
          </ButtonGroup>
          {data && (
            <span className="text-muted">
              {respondents.length} response{respondents.length === 1 ? '' : 's'} · {submitted} of {completion.length} students submitted
            </span>
          )}
          <div className="ms-auto d-flex gap-2">
            <Button size="sm" variant="outline-primary" disabled={!respondents.length} onClick={downloadCsv}>Download CSV</Button>
            <Button size="sm" variant="outline-secondary" disabled={!data} onClick={() => setShowCompletion((v) => !v)}>
              {showCompletion ? 'Hide completion list' : 'Completion list'}
            </Button>
          </div>
        </div>

        <Alert variant="light" className="small py-2">
          Responses are shown without names, in random order. The completion list shows who submitted, not what they answered.
        </Alert>

        {loading && <Spinner animation="border" size="sm" />}
        {error && <Alert variant="danger">{error}</Alert>}

        {data && showCompletion && (
          <Table size="sm" bordered className="mb-4">
            <thead><tr><th>Student</th>{scope === 'class' && <th>Course</th>}<th>Status</th></tr></thead>
            <tbody>
              {completion.map((c, i) => (
                <tr key={i}>
                  <td>{c.name} <span className="text-muted small">{c.email}</span></td>
                  {scope === 'class' && <td>{c.course}</td>}
                  <td>
                    <Badge bg={c.status === 'submitted' ? 'success' : c.status === 'started' ? 'warning' : 'secondary'}>{c.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {data && (
          <div className="border rounded p-3 mb-4 bg-light">
            <div className="d-flex align-items-center gap-2 mb-2">
              <strong>AI summary</strong>
              {ai?.generatedAt && (
                <span className="text-muted small">
                  {new Date(ai.generatedAt).toLocaleString()}{ai.respondents ? ` · ${ai.respondents} responses` : ''}
                </span>
              )}
              <Button size="sm" className="ms-auto" variant="outline-primary" disabled={aiBusy || !respondents.length} onClick={summarize}>
                {aiBusy ? 'Summarizing…' : ai ? 'Regenerate' : 'Summarize with AI'}
              </Button>
            </div>
            {aiError && <Alert variant="danger" className="py-1 small">{aiError}</Alert>}
            {ai ? (
              <>
                {ai.overview && <p className="mb-2">{ai.overview}</p>}
                {ai.questions?.length > 0 && (
                  <ul className="small">
                    {ai.questions.map((q, i) => <li key={i}><strong>{q.question}</strong>: {q.summary}</li>)}
                  </ul>
                )}
                {ai.takeaways?.length > 0 && (
                  <>
                    <div className="small fw-bold">Takeaways</div>
                    <ul className="small mb-0">{ai.takeaways.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  </>
                )}
              </>
            ) : (
              <div className="text-muted small">No summary yet. The AI sees only the anonymous results below.</div>
            )}
          </div>
        )}

        {data && !respondents.length && <Alert variant="info">No one has submitted yet.</Alert>}

        {respondents.length > 0 && questions.map((q) => {
          const mcResult = q.mc ? choiceCounts(q, respondents) : null;
          return (
            <div key={q.qid} className="mb-4">
              <div className="mb-2">
                <strong>{q.qid}.</strong>{' '}
                <span dangerouslySetInnerHTML={{ __html: q.prompt }} />
              </div>
              {mcResult && (
                <Table size="sm" borderless className="mb-2">
                  <tbody>
                    {q.mc.choices.map((c) => {
                      const n = mcResult.counts.get(c.value);
                      const p = pct(n, mcResult.answered);
                      return (
                        <tr key={c.value}>
                          <td style={{ width: '35%' }} dangerouslySetInnerHTML={{ __html: c.content || c.value }} />
                          <td><ProgressBar now={p} label={p >= 8 ? `${p}%` : ''} style={{ height: '1.2rem' }} /></td>
                          <td className="text-end text-nowrap" style={{ width: '6em' }}>{n} ({p}%)</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
              {mcResult && (
                <div className="text-muted small mb-2">
                  {mcResult.answered} answered{q.multiple ? ' · select all that apply, so percentages add up to more than 100' : ''}
                </div>
              )}
              {q.hasText && <AnswerList answers={textAnswers(q.qid, respondents)} />}
              {q.tables.map((t, ti) => (
                <div key={ti} className="mt-2">
                  {t.title && <div className="small fw-bold">{t.title}</div>}
                  {t.cells.map((c) => (
                    <div key={c.key} className="mb-2">
                      <div className="small text-muted">{c.label}</div>
                      <AnswerList answers={textAnswers(c.key, respondents)} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}
