import React, { useMemo } from 'react';
import { Alert, Card } from 'react-bootstrap';
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

function buildRowsByQuestion(historyRows = []) {
  const map = new Map();
  const sorted = [...historyRows].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));

  for (const row of sorted) {
    const baseQid = getBaseQid(row.question_id);
    if (!baseQid) continue;

    const c = classifyRow(row);
    if (!c) continue;

    const value = asString(row.response).trim();
    if (!value) continue;

    if (!map.has(baseQid)) map.set(baseQid, []);
    map.get(baseQid).push({
      ...row,
      transcriptType: c.type,
      transcriptLabel: c.label,
      value,
    });
  }

  return map;
}

function dedupeTranscriptRows(rows = [], originalCode = []) {
  const out = [];

  let lastCodeState =
    originalCode.length > 0
      ? normalizeCode(originalCode[originalCode.length - 1].content)
      : null;

  for (const row of rows) {
    if (row.transcriptType === 'student_code') {
      const now = normalizeCode(row.value);
      if (now === lastCodeState) continue;
      out.push(row);
      lastCodeState = now;
      continue;
    }

    out.push(row);
  }

  return out;
}

function speakerName(row, userNameById = {}) {
  const id = row?.answered_by_user_id;
  if (row?.transcriptType === 'ai_feedback') return 'AI';
  if (id != null && userNameById[id]) return userNameById[id];
  return row?.transcriptLabel || 'Student';
}

function TranscriptEntry({ row, userNameById = {} }) {
  const who = speakerName(row, userNameById);

  if (row.transcriptType === 'student_code') {
    return (
      <div className="mb-3">
        <div className="fw-semibold">{who}:</div>
        <div className="small text-muted mb-1">{row.submitted_at || row.updated_at || ''}</div>
        <div className="mb-1">Modified code</div>
        <pre className="border rounded p-2 bg-light mb-0" style={{ whiteSpace: 'pre-wrap' }}>
          <code>{row.value}</code>
        </pre>
      </div>
    );
  }

  if (row.transcriptType === 'code_output') {
    return (
      <div className="mb-3">
        <div className="fw-semibold">Code output</div>
        <div className="small text-muted mb-1">{row.submitted_at || row.updated_at || ''}</div>
        <pre className="border rounded p-2 bg-light mb-0" style={{ whiteSpace: 'pre-wrap' }}>
          <code>{row.value}</code>
        </pre>
      </div>
    );
  }

  if (row.transcriptType === 'code_feedback') {
    return (
      <div className="mb-3">
        <div className="fw-semibold">AI code feedback</div>
        <div className="small text-muted mb-1">{row.submitted_at || row.updated_at || ''}</div>
        <div className="border rounded p-2 bg-light">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.value}</ReactMarkdown>
        </div>
      </div>
    );
  }

  if (row.transcriptType === 'ai_feedback') {
    return (
      <div className="mb-3">
        <div className="fw-semibold">AI:</div>
        <div className="small text-muted mb-1">{row.submitted_at || row.updated_at || ''}</div>
        <div className="border rounded p-2 bg-light">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.value}</ReactMarkdown>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="fw-semibold">{who}:</div>
      <div className="small text-muted mb-1">{row.submitted_at || row.updated_at || ''}</div>
      <div className="border rounded p-2 bg-light" style={{ whiteSpace: 'pre-wrap' }}>
        {row.value}
      </div>
    </div>
  );
}

export default function RunActivityHistoryView({
  historyRows = [],
  groups = [],
  userNameById = {},
  title = 'Submission History',
}) {
  const questions = useMemo(() => buildQuestionList(groups), [groups]);
  const rowsByQuestion = useMemo(() => buildRowsByQuestion(historyRows), [historyRows]);

  if (!historyRows.length) {
    return <Alert variant="info">No response history has been recorded for this instance yet.</Alert>;
  }

  return (
    <div>
      <h4 className="mb-3">{title}</h4>
      {questions.map(({ qid, block }) => {
        const originalCode = uniqueOriginalCode(block);
        const rows = dedupeTranscriptRows(rowsByQuestion.get(qid) || [], originalCode);

        if (!rows.length && originalCode.length === 0) return null;

        return (
          <Card key={qid} className="mb-4">
            <Card.Body>
              <Card.Title className="mb-2">
                {qid}. {getQuestionPrompt(block, qid)}
              </Card.Title>

              {originalCode.length > 0 && (
                <div className="mb-3">
                  <div className="fw-semibold">Original starter code</div>
                  {originalCode.map((item, idx) => (
                    <pre
                      key={`${qid}-orig-${idx}`}
                      className="border rounded p-2 bg-light mt-2 mb-0"
                      style={{ whiteSpace: 'pre-wrap' }}
                    >
                      <code>{item.content}</code>
                    </pre>
                  ))}
                </div>
              )}

              {rows.length === 0 ? (
                <Alert variant="secondary" className="mb-0">
                  No transcript entries recorded for this question.
                </Alert>
              ) : (
                rows.map((row) => (
                  <TranscriptEntry
                    key={`${row.id}-${row.question_id}`}
                    row={row}
                    userNameById={userNameById}
                  />
                ))
              )}
            </Card.Body>
          </Card>
        );
      })}
    </div>
  );
}
