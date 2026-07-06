import React, { useMemo } from 'react';
import { Alert } from 'react-bootstrap';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function asString(value) {
  return value == null ? '' : String(value);
}

function stripHtml(s = '') {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*?)?>/g, '');
}

function normalizeCode(s = '') {
  return String(s).replace(/\r\n/g, '\n').trim();
}

function getBaseQid(questionIdRaw) {
  const qid = String(questionIdRaw || '').trim();
  if (!qid) return null;

  if (/^\d+[a-z]+f\d+$/i.test(qid)) return qid.replace(/f\d+$/i, '');
  if (/^\d+[a-z]+fa\d+$/i.test(qid)) return qid.replace(/fa\d+$/i, '');
  if (/^\d+[a-z]+code\d+$/i.test(qid)) return qid.replace(/code\d+$/i, '');
  if (/^\d+[a-z]+output\d*$/i.test(qid)) return qid.replace(/output\d*$/i, '');
  if (/^\d+[a-z]+Output$/i.test(qid)) return qid.replace(/Output$/i, '');
  if (/^\d+[a-z]+CodeFeedback$/i.test(qid)) return qid.replace(/CodeFeedback$/i, '');
  if (/^\d+[a-z]+RunFeedback$/i.test(qid)) return qid.replace(/RunFeedback$/i, '');
  if (/^\d+[a-z]+ResponseFeedback$/i.test(qid)) return qid.replace(/ResponseFeedback$/i, '');
  if (/^\d+[a-z]+CodeScore$/i.test(qid)) return qid.replace(/CodeScore$/i, '');
  if (/^\d+[a-z]+RunScore$/i.test(qid)) return qid.replace(/RunScore$/i, '');
  if (/^\d+[a-z]+ResponseScore$/i.test(qid)) return qid.replace(/ResponseScore$/i, '');
  if (/^\d+[a-z]+S$/i.test(qid)) return qid.replace(/S$/i, '');
  if (/^\d+[a-z]+AF$/i.test(qid)) return qid.replace(/AF$/i, '');
  if (/^\d+[a-z]+FM$/i.test(qid)) return qid.replace(/FM$/i, '');

  if (/^\d+[a-z]+$/i.test(qid)) return qid;

  return null;
}


function groupTranscriptRowsBySubmit(rows = []) {
  const groups = new Map();

  for (const row of rows) {
    const submitId = row?.submit_id || `row-${row.id}`;
    if (!groups.has(submitId)) groups.set(submitId, []);
    groups.get(submitId).push(row);
  }

  return Array.from(groups.entries()).map(([submitId, rows]) => ({
    submitId,
    rows: rows.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)),
  }));
}

function isHiddenMetadataKey(questionIdRaw) {
  const qid = String(questionIdRaw || '').trim();
  if (!qid) return true;

  if (/^Rmax:\d+$/i.test(qid)) return true;
  if (/^Rcnt:\d+$/i.test(qid)) return true;
  if (/^Rhash:\d+$/i.test(qid)) return true;
  if (/^attempt:\d+$/i.test(qid)) return true;
  if (/^\d+state$/i.test(qid)) return true;

  if (/^\d+[a-z]+AF$/i.test(qid)) return true;
  if (/^\d+[a-z]+FM$/i.test(qid)) return true;
  if (/^\d+[a-z]+S$/i.test(qid)) return true;
  if (/SubmissionString$/i.test(qid)) return true;

  if (/Score$/i.test(qid)) return true;

  return false;
}

function classifyRow(row) {
  const key = String(row?.question_id || '').trim();
  if (!key || isHiddenMetadataKey(key)) return null;

  if (/^\d+[a-z]+F\d+$/i.test(key)) {
    return { type: 'ai_feedback', label: 'AI' };
  }

  if (/^\d+[a-z]+CodeFeedback$/i.test(key)) {
    return { type: 'code_feedback', label: 'AI' };
  }
  if (/^\d+[a-z]+RunFeedback$/i.test(key)) {
    return { type: 'ai_feedback', label: 'AI' };
  }

  if (/^\d+[a-z]+ResponseFeedback$/i.test(key)) {
    return { type: 'ai_feedback', label: 'AI' };
  }

  if (/^\d+[a-z]+code\d+$/i.test(key)) {
    return { type: 'student_code', label: 'Student' };
  }

  if (/^\d+[a-z]+output\d*$/i.test(key) || /^\d+[a-z]+Output$/i.test(key)) {
    return { type: 'code_output', label: 'Program Output' };
  }

  if (/^\d+[a-z]+$/i.test(key)) {
    return { type: 'student_text', label: 'Student' };
  }

  return null;
}

function buildQuestionList(groups = []) {
  const out = [];

  for (const group of groups || []) {
    const blocks = [group?.intro, ...(group?.content || [])];
    for (const block of blocks) {
      if (block?.type !== 'question') continue;
      const qid = `${block.groupId}${block.id}`;
      out.push({ qid, block });
    }
  }

  return out;
}

function getQuestionPrompt(block, qid) {
  if (!block) return `Question ${qid}`;

  const pieces = [
    block.prompt,
    block.content,
    block.title,
    block.introText,
    block.header,
    block.text,
  ]
    .map((x) => stripHtml(asString(x)).trim())
    .filter(Boolean);

  return pieces[0] || `Question ${qid}`;
}

function uniqueOriginalCode(block) {
  if (!block) return [];

  const raw = [
    ...(block.pythonBlocks || []).map((b) => ({ lang: 'python', content: asString(b?.content).trim() })),
    ...(block.turtleBlocks || []).map((b) => ({ lang: 'python', content: asString(b?.content).trim() })),
    ...(block.cppBlocks || []).map((b) => ({ lang: 'cpp', content: asString(b?.content).trim() })),
    ...(block.codeBlocks || []).map((b) => ({
      lang: asString(b?.lang || 'text').trim() || 'text',
      content: asString(b?.content).trim(),
    })),
  ].filter((x) => x.content);

  const seen = new Set();
  const out = [];

  for (const item of raw) {
    const sig = `${item.lang}:::${normalizeCode(item.content)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(item);
  }

  return out;
}

function speakerName(row, userNameById = {}) {
  const id = row?.answered_by_user_id;
  if (row?.transcriptType === 'ai_feedback') return 'AI';
  if (id != null && userNameById[id]) return userNameById[id];
  return row?.transcriptLabel || 'Student';
}

function isAnswerRow(row) {
  return row?.transcriptType === 'student_text' || row?.transcriptType === 'student_code';
}

function isFeedbackRow(row) {
  return row?.transcriptType === 'ai_feedback' || row?.transcriptType === 'code_feedback';
}

function isOutputRow(row) {
  return row?.transcriptType === 'code_output';
}

function normalizeTranscriptValue(row) {
  if (!row) return '';
  if (row.transcriptType === 'student_code') return normalizeCode(row.value);
  if (row.transcriptType === 'code_output') return normalizeCode(row.value);
  return stripHtml(asString(row.value)).trim();
}

function formatSubmitWhen(rows = []) {
  const first = rows.find((row) => row?.submitted_at || row?.updated_at);
  return first?.submitted_at || first?.updated_at || '';
}

function formatSubmitter(rows = [], userNameById = {}) {
  const humanRow =
    rows.find((row) => row?.answered_by_user_id != null) ||
    rows[0] ||
    null;
  return speakerName(humanRow, userNameById);
}

function buildSubmitGroups(historyRows = []) {
  const sorted = [...historyRows].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  const groups = new Map();
  const order = [];

  for (const row of sorted) {
    const baseQid = getBaseQid(row.question_id);
    if (!baseQid) continue;

    const c = classifyRow(row);
    if (!c) continue;

    const value = asString(row.response).trim();
    if (!value) continue;

    const submitId = row?.submit_id || `row-${row.id}`;
    if (!groups.has(submitId)) {
      groups.set(submitId, {
        submitId,
        firstRowId: Number(row.id) || 0,
        rows: [],
      });
      order.push(submitId);
    }

    const normalizedRow = {
      ...row,
      transcriptType: c.type,
      transcriptLabel: c.label,
      value,
      baseQid,
    };

    groups.get(submitId).rows.push(normalizedRow);
  }

  return order.map((submitId) => groups.get(submitId));
}

function buildQuestionThread(qid, rows, previousSnapshot = null) {
  const sorted = [...rows].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  const steps = [];
  let lastAnswer = previousSnapshot?.answer ?? null;
  let lastFeedback = previousSnapshot?.feedback ?? null;
  let lastOutput = previousSnapshot?.output ?? null;
  let sawMeaningfulChange = false;
  let currentAnswer = previousSnapshot?.answer ?? null;

  for (const row of sorted) {
    if (isAnswerRow(row)) {
      const normalized = normalizeTranscriptValue(row);
      if (!normalized || normalized === lastAnswer) continue;

      steps.push({ ...row, stepType: 'answer' });
      lastAnswer = normalized;
      currentAnswer = normalized;
      sawMeaningfulChange = true;
      continue;
    }

    if (isFeedbackRow(row)) {
      const normalized = normalizeTranscriptValue(row);
      if (!normalized || normalized === lastFeedback) continue;

      steps.push({ ...row, stepType: 'feedback' });
      lastFeedback = normalized;
      sawMeaningfulChange = true;
      continue;
    }

    if (isOutputRow(row)) {
      const normalized = normalizeTranscriptValue(row);
      if (!normalized || normalized === lastOutput) continue;

      steps.push({ ...row, stepType: 'output' });
      lastOutput = normalized;
      sawMeaningfulChange = true;
    }
  }

  if (!sawMeaningfulChange || steps.length === 0) {
    return null;
  }

  return {
    qid,
    rows: sorted,
    steps,
    currentAnswer,
    latestFeedback: lastFeedback,
    latestOutput: lastOutput,
  };
}

function TimelineStep({ row, userNameById = {} }) {
  const who = speakerName(row, userNameById);

  if (row.stepType === 'answer' && row.transcriptType === 'student_code') {
    return (
      <div>
        <div className="fw-semibold">{who} answer</div>
        <pre className="border rounded p-2 bg-white mb-0" style={{ whiteSpace: 'pre-wrap' }}>
          <code>{row.value}</code>
        </pre>
      </div>
    );
  }

  if (row.stepType === 'answer') {
    return (
      <div>
        <div className="fw-semibold">{who} answer</div>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {row.value}
        </ReactMarkdown>
      </div>
    );
  }

  if (row.stepType === 'feedback') {
    return (
      <div>
        <div className="fw-semibold">AI feedback</div>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {row.value}
        </ReactMarkdown>
      </div>
    );
  }

  if (row.stepType === 'output') {
    return (
      <div>
        <div className="fw-semibold">Program output</div>
        <pre className="border rounded p-2 bg-white mb-0" style={{ whiteSpace: 'pre-wrap' }}>
          <code>{row.value}</code>
        </pre>
      </div>
    );
  }

  return null;
}

function QuestionThread({ thread, block, userNameById = {} }) {
  const prompt = getQuestionPrompt(block, thread.qid);
  const stepCount = thread.steps.length;
  const answerCount = thread.steps.filter((step) => step.stepType === 'answer').length;

  return (
    <div className="border rounded-3 bg-light p-3 mb-3">
      <div className="d-flex justify-content-between gap-3 align-items-start flex-wrap">
        <div>
          <div className="fw-semibold">
            {thread.qid}. {prompt}
          </div>
          <div className="small text-muted">
            {answerCount > 0 ? `${answerCount} answer${answerCount === 1 ? '' : 's'}` : 'No new answer'}
          </div>
        </div>
        <div className="small text-muted text-nowrap">
          {stepCount} step{stepCount === 1 ? '' : 's'}
        </div>
      </div>

      <div className="mt-3 d-grid gap-3">
        {thread.steps.map((step) => (
          <div key={step.id} className="d-flex gap-3 align-items-start">
            <div
              style={{
                width: 12,
                paddingTop: 8,
                flex: '0 0 12px',
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background:
                    step.stepType === 'feedback'
                      ? '#198754'
                      : step.stepType === 'output'
                      ? '#6c757d'
                      : '#0d6efd',
                }}
              />
            </div>
            <div className="flex-grow-1">
              <TimelineStep row={step} userNameById={userNameById} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RunActivityHistoryView({
  historyRows = [],
  groups = [],
  title = 'Full Submission History',
  userNameById = {},
}) {
  const questionList = useMemo(() => buildQuestionList(groups), [groups]);
  const questionMap = useMemo(() => new Map(questionList.map((entry) => [entry.qid, entry.block])), [questionList]);
  const submitGroups = useMemo(() => buildSubmitGroups(historyRows), [historyRows]);
  const timeline = useMemo(() => {
    const snapshots = new Map();

    return submitGroups.map((submit, index) => {
      const rowsByQid = new Map();
      for (const row of submit.rows) {
        if (!rowsByQid.has(row.baseQid)) rowsByQid.set(row.baseQid, []);
        rowsByQid.get(row.baseQid).push(row);
      }

      const threads = [];
      const qids = Array.from(rowsByQid.keys()).sort((a, b) => {
        const firstA = rowsByQid.get(a)?.[0]?.id || 0;
        const firstB = rowsByQid.get(b)?.[0]?.id || 0;
        return firstA - firstB;
      });

      for (const qid of qids) {
        const thread = buildQuestionThread(qid, rowsByQid.get(qid), snapshots.get(qid));
        if (!thread) continue;
        threads.push(thread);
        snapshots.set(qid, {
          answer: thread.currentAnswer,
          feedback: thread.latestFeedback,
          output: thread.latestOutput,
        });
      }

      return {
        submitId: submit.submitId,
        firstRowId: submit.firstRowId,
        index,
        when: formatSubmitWhen(submit.rows),
        submitter: formatSubmitter(submit.rows, userNameById),
        rows: submit.rows,
        threads,
      };
    });
  }, [submitGroups, userNameById]);

  if (!historyRows.length) {
    return (
      <Alert variant="secondary">
        No history rows found for this activity instance.
      </Alert>
    );
  }

  return (
    <div className="mt-3">
      <div className="d-flex justify-content-between align-items-end gap-3 flex-wrap mb-3">
        <h4 className="mb-0">{title}</h4>
        <div className="small text-muted">
          {timeline.length} submit{timeline.length === 1 ? '' : 's'} recorded
        </div>
      </div>
      <style>{`
        .history-submit-details {
          border: 1px solid #dee2e6;
          border-radius: 0.75rem;
          background: #fff;
          overflow: hidden;
          margin-bottom: 1rem;
        }

        .history-submit-details > summary {
          list-style: none;
          cursor: pointer;
          padding: 1rem 1.1rem;
        }

        .history-submit-details > summary::-webkit-details-marker {
          display: none;
        }

        .history-submit-body {
          border-top: 1px solid #dee2e6;
          padding: 1rem 1.1rem 0.9rem;
          background: #f8f9fa;
        }
      `}</style>

      {timeline.map((submit, index) => {
        const changedQids = submit.threads.map((thread) => thread.qid);
        const changedSummary = changedQids.length
          ? changedQids.slice(0, 4).join(', ') + (changedQids.length > 4 ? '…' : '')
          : 'No updated question threads';

        return (
          <details key={submit.submitId} className="history-submit-details" open={submit.threads.length > 0}>
            <summary>
              <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                <div>
                  <div className="fw-semibold">
                    Submit {index + 1}
                  </div>
                  <div className="small text-muted">
                    {submit.when || 'Timestamp unavailable'} · {submit.submitter}
                  </div>
                </div>
                <div className="text-end">
                  <div className="small fw-semibold">
                    {changedQids.length} updated question thread{changedQids.length === 1 ? '' : 's'}
                  </div>
                  <div className="small text-muted">
                    {changedSummary}
                  </div>
                </div>
              </div>
            </summary>

            <div className="history-submit-body">
              {submit.threads.length > 0 ? (
                submit.threads.map((thread) => (
                  <QuestionThread
                    key={`${submit.submitId}:${thread.qid}`}
                    thread={thread}
                    block={questionMap.get(thread.qid)}
                    userNameById={userNameById}
                  />
                ))
              ) : (
                <Alert variant="light" className="mb-0">
                  No updated question threads were recorded in this submit.
                </Alert>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
