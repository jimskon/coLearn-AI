// Trial Run (activity editor): answer every question with a correct answer,
// run any code the way a student's Run button would, and send the answer to
// the grader students use for this activity's mode. Nothing is saved: the
// group graders get dryRun, and test grading is stateless.
//
//   group / demo / playground  -> group Check (/evaluate-response, /evaluate-code)
//   test / practice / assignment -> scored grading (/grade-test-question)
import React, { useMemo, useRef, useState } from 'react';
import { Modal, Button, Table, Badge, Alert, ProgressBar } from 'react-bootstrap';
import { parseSheetToBlocks } from '../../utils/parseSheet';
import { runSkulptCode } from '../../utils/runSkulptCode';
import { API_BASE_URL } from '../../config';

const GRADED_MODES = new Set(['test', 'practice', 'assignment']);
const TURTLE_TARGET_ID = 'trial-run-turtle';

const stripHtml = (s = '') =>
  String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[A-Za-z!][^>]*>/g, '')
    .trim();

const bandPoints = (band) =>
  typeof band === 'number' ? band : Number(band?.points) || 0;

function maxPoints(scores = {}) {
  return ['code', 'output', 'response'].reduce((sum, k) => sum + bandPoints(scores?.[k]), 0);
}

function headerValues(blocks) {
  const out = {};
  for (const b of blocks) {
    if (b.type === 'header' && b.tag && !(b.tag in out)) out[b.tag] = stripHtml(b.content);
  }
  return out;
}

function starterFiles(blocks) {
  const files = {};
  for (const b of blocks) {
    if (b.type === 'file' && b.filename && !(b.filename in files)) {
      files[b.filename] = { content: b.content || '', readonly: !!b.readonly };
    }
  }
  return files;
}

// The question's last code box (the page grades only the last one) and how it runs.
function codeBoxFor(q) {
  const box = (q.codeBlocks || []).at(-1);
  if (!box) return null;
  const runner = box.lang === 'cpp' ? 'cpp'
    : box.runner === 'remote' ? 'pyremote'
      : box.width ? 'turtle'
        : 'skulpt';
  return {
    lang: box.lang === 'cpp' ? 'cpp' : 'python',
    runner,
    starter: box.content || '',
    timeLimit: Number(box.timeLimit) || (runner === 'cpp' ? 5000 : 50000),
    includeFiles: Array.isArray(box.includeFiles) ? box.includeFiles : [],
    width: box.width,
    height: box.height,
  };
}

function tableTextFor(q) {
  return (q.tableBlocks || [])
    .map((t) => [
      stripHtml(t.title) ? `Table: ${stripHtml(t.title)}` : '',
      ...t.rows.map((row) => `| ${row.map((c) => (c.type === 'input' ? '___' : stripHtml(c.content))).join(' | ')} |`),
    ].filter(Boolean).join('\n'))
    .join('\n\n');
}

// Same rule as the page: the default text box shows unless the question
// answers some other way (multiple choice, code, table, or an AI block).
function wantsTextFor(q) {
  const hasCode = (q.pythonBlocks?.length || 0) + (q.cppBlocks?.length || 0) > 0;
  if (q.multipleChoice?.choices?.length) return false;
  return !!q.hasTextResponse ||
    (!(q.aiBlocks?.length) && !hasCode && !q.hasTableResponse);
}

const sameCode = (a, b) => String(a || '').replace(/\s+/g, '') === String(b || '').replace(/\s+/g, '');

// Which files a runner sends: the include list (if any) plus every data file,
// as the C++ and remote Python blocks do.
function filesForRunner(files, includeList, codeExt) {
  const names = Object.keys(files);
  if (!includeList.length) return Object.fromEntries(names.map((n) => [n, files[n]]));
  const out = {};
  for (const n of includeList) if (n in files) out[n] = files[n];
  for (const n of names) if (!codeExt.test(n) && !(n in out)) out[n] = files[n];
  return out;
}

async function runSkulpt(box, code, files, stdinLines) {
  if (!window.Sk || !window.Sk.configure) return { output: '', note: 'Python (Skulpt) is not loaded.' };
  let prelude = '';
  for (const name of box.includeFiles) {
    const src = files[name];
    if (src) prelude += `# ===== BEGIN ${name} =====\n${src}${src.endsWith('\n') ? '' : '\n'}# ===== END ${name} =====\n\n`;
  }
  let output = '';
  const queue = [...stdinLines];
  await runSkulptCode({
    code: prelude + code,
    fileContents: { ...files },
    setOutput: (v) => { output = typeof v === 'function' ? v(output) : v; },
    setFileContents: null,
    execLimit: box.timeLimit,
    turtleTargetId: box.runner === 'turtle' ? TURTLE_TARGET_ID : null,
    turtleWidth: box.width || 600,
    turtleHeight: box.height || 400,
    stdin: {
      readLine: () => {
        const line = queue.length ? String(queue.shift()) : '';
        output += `${line}\n`;
        return Promise.resolve(line);
      },
    },
  });
  return {
    output,
    note: box.runner === 'turtle' ? 'Turtle drawing ran; the drawing itself was not checked.' : '',
  };
}

function runRemote(box, code, files, stdinLines) {
  const base = box.runner === 'cpp' ? '/cxx-run' : '/py-run';
  const codeExt = box.runner === 'cpp' ? /\.(cpp|cc|cxx|c)$/i : /\.py$/i;
  const selected = filesForRunner(files, box.includeFiles, codeExt);
  const timeLimit = box.timeLimit;

  return (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(timeLimit, 15000));
    let data;
    try {
      const res = await fetch(`${base}/session/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          code,
          ...(Object.keys(selected).length ? { files: selected } : {}),
          timeout_ms: timeLimit,
          idle_timeout_ms: timeLimit,
        }),
      });
      if (!(res.headers.get('content-type') || '').includes('application/json')) {
        return { output: '', note: `The runner did not answer (${res.status}).` };
      }
      data = await res.json();
    } catch (err) {
      return { output: '', note: err?.name === 'AbortError' ? 'Timed out starting the program.' : `Runner error: ${err.message}` };
    } finally {
      clearTimeout(timer);
    }
    if (!data?.ok) {
      const label = box.runner === 'cpp' ? 'Compile error' : 'Run error';
      return { output: `${label}:\n${data?.compile_error || data?.error || '(no details)'}`, note: '' };
    }

    return new Promise((resolve) => {
      let output = '';
      let note = '';
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}${base}/session/ws/${data.sessionId}`);
      const limit = setTimeout(() => {
        note = `Stopped at the time limit (${timeLimit} ms).`;
        try { ws.send('\u0003'); } catch { /* ignore */ }
        setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, 250);
      }, timeLimit);
      ws.onopen = () => {
        // The program's terminal buffers input, so all lines can go at once.
        for (const line of stdinLines) ws.send(`${line}\n`);
      };
      ws.onmessage = (ev) => {
        const msg = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
        if (!msg.startsWith('[FILES]')) output += msg;
      };
      ws.onerror = () => { note = note || 'Connection to the runner failed.'; };
      ws.onclose = () => {
        clearTimeout(limit);
        resolve({ output, note });
      };
    });
  })();
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw.slice(0, 200) }; }
  if (!res.ok) throw new Error(data?.error || `${path} failed (${res.status})`);
  return data;
}

export default function TrialRunModal({ show, onHide, sourceText = '', features = {} }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const stopRef = useRef(false);

  const parsed = useMemo(
    () => (show ? parseSheetToBlocks(String(sourceText).split('\n'), { returnIssues: true }) : null),
    [show, sourceText],
  );
  const blocks = parsed?.blocks || [];
  const meta = parsed?.meta || {};
  const mode = meta.mode || 'group';
  const graded = GRADED_MODES.has(mode);
  const questions = blocks.filter((b) => b.type === 'question');
  const parseErrors = (parsed?.issues || []).filter((i) => i.severity === 'error');

  async function trialQuestion(q, ctx) {
    const qid = `${q.groupId}${q.id}`;
    const base = { qid, status: 'skip', detail: '', answer: null, output: '', note: '', feedback: '', score: '' };
    const max = maxPoints(q.scores);

    if (q.multipleChoice?.choices?.length) {
      const mc = q.multipleChoice;
      if (!mc.correctAnswer && !mc.hasChoiceScores) {
        return { ...base, detail: 'Survey question (no keyed answer); not checked.' };
      }
      if (graded && max <= 0) return { ...base, detail: 'No \\score, so it is not graded in this mode.' };
      return {
        ...base,
        status: 'pass',
        detail: mc.correctAnswer
          ? `Multiple choice, keyed to "${mc.correctAnswer}". Scored without AI.`
          : `Multiple choice, scored by choice points (best: ${mc.maxChoicePoints}). Scored without AI.`,
      };
    }
    if (graded && max <= 0) return { ...base, detail: 'No \\score, so it is not graded in this mode.' };

    const box = codeBoxFor(q);
    const wantsText = wantsTextFor(q);
    const tableText = q.hasTableResponse ? tableTextFor(q) : '';
    if (!box && !wantsText && !tableText) {
      return { ...base, detail: 'Nothing for a student to answer here (for example, an AI conversation); not checked.' };
    }

    // 1) A correct answer.
    const questionText = stripHtml(q.prompt) || `Question ${qid}`;
    const fileList = Object.entries(ctx.files).map(([name, f]) => ({ name, content: f.content, readonly: f.readonly }));
    const answer = await postJson('/api/ai/trial-answer', {
      questionText,
      activityContext: ctx.headers.activitycontext || ctx.headers.title || '',
      studentLevel: ctx.headers.studentlevel || '',
      language: meta.language || '',
      wantsText,
      tableText,
      code: box ? { lang: box.lang, starter: box.starter } : null,
      samples: q.samples || [],
      feedbackPrompt: q.feedback?.[0] || '',
      scores: q.scores || {},
      files: fileList,
    });

    // Edits to files stay in place for later questions, as they do for students.
    for (const [name, content] of Object.entries(answer.files || {})) {
      if (ctx.files[name]) ctx.files[name] = { ...ctx.files[name], content };
    }
    const contents = Object.fromEntries(Object.entries(ctx.files).map(([n, f]) => [n, f.content]));
    const supportingFiles = Object.entries(ctx.files).map(([name, f]) => ({
      name,
      content: f.content,
      edited: f.content.trimEnd() !== (ctx.starters[name]?.content || '').trimEnd(),
    }));

    // 2) Run the code like the Run button.
    let output = '';
    let note = '';
    if (box && answer.code) {
      if (box.runner === 'pyremote' && features.remotePython === false) {
        note = 'Not run: remote Python is turned off on this server.';
      } else if (box.runner === 'cpp' && features.remoteCpp === false) {
        note = 'Not run: remote C++ is turned off on this server.';
      } else {
        const ran = box.runner === 'skulpt' || box.runner === 'turtle'
          ? await runSkulpt(box, answer.code, contents, answer.stdin || [])
          : await runRemote(box, answer.code, contents, answer.stdin || []);
        output = String(ran.output || '').trim();
        note = ran.note;
      }
    }

    const shown = { ...base, answer, output, note, tokens: answer.aiTokens };

    // 3) Grade it with this mode's grader.
    if (graded) {
      const codeCells = box && answer.code ? [{ code: answer.code, lang: box.lang, label: `${qid}code1` }] : [];
      const codeRunPts = bandPoints(q.scores?.code) + bandPoints(q.scores?.output);
      const g = await postJson('/api/ai/grade-test-question', {
        questionText,
        scores: q.scores,
        rubric: q.scores,
        responseText: answer.responseText || '',
        codeCells,
        outputText: output,
        supportingFiles: codeRunPts > 0 ? supportingFiles : [],
      });
      const earned = (Number(g.codeScore) || 0) + (Number(g.runScore) || 0) + (Number(g.responseScore) || 0);
      const feedback = [g.codeFeedback, g.runFeedback, g.responseFeedback].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
      if (g.gradingFailed) return { ...shown, status: 'error', score: `${earned}/${max}`, feedback, detail: 'The grader did not finish.' };
      const pass = earned >= max;
      return {
        ...shown,
        status: pass ? 'pass' : 'fail',
        score: `${earned}/${max}`,
        feedback,
        detail: pass ? 'A correct answer earned full marks.' : `A correct answer earned only ${earned} of ${max}.`,
      };
    }

    // Group Check: written/table answers go to the response checker, code-only
    // questions to the code checker (same split as the run page).
    const common = {
      questionText,
      sampleResponse: q.samples?.[0] || '',
      feedbackPrompt: q.feedback?.[0] || '',
      followupPrompt: q.followups?.[0] || '',
      guidance: ctx.headers.aicodeguidance || '',
      activityAiMode: meta.aiMode || 'no-positive',
      questionAiMode: q.aiMode || '',
      activityLanguage: meta.language || '',
      retriesRequired: q.retriesRequired ?? 0,
      dryRun: true,
    };
    let g;
    if (wantsText || q.hasTableResponse) {
      g = await postJson('/api/ai/evaluate-response', {
        ...common,
        qid,
        responseMode: q.responseMode || 'answer',
        studentAnswer: answer.responseText || '',
        hasTableResponse: !!q.hasTableResponse,
        context: {
          activitycontext: ctx.headers.activitycontext || 'Unnamed Activity',
          studentLevel: ctx.headers.studentlevel || 'intro',
        },
        codeContext: (q.codeBlocks || []).map((b) => b.content).filter(Boolean).join('\n\n'),
      });
    } else {
      if (sameCode(answer.code, box.starter)) {
        return {
          ...shown,
          status: 'fail',
          detail: 'The correct answer leaves the starter code unchanged, but the group Check requires students to change the code.',
        };
      }
      g = await postJson('/api/ai/evaluate-code', {
        ...common,
        studentCode: answer.code,
        codeVersion: qid,
        lang: box.lang,
        isCodeOnly: true,
        outputText: output,
        supportingFiles: supportingFiles.filter((f) => f.content.trim()),
      });
    }
    const feedback = [g.feedback || g.comment, g.followup || g.followupQuestion]
      .map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
    const accepted = g.accepted === true;
    return {
      ...shown,
      status: accepted ? 'pass' : 'fail',
      score: accepted ? 'accepted' : 'not accepted',
      feedback,
      detail: accepted ? 'A correct answer was accepted.' : 'A correct answer was not accepted.',
    };
  }

  async function start() {
    stopRef.current = false;
    setRunning(true);
    setError('');
    setResults([]);
    const starters = starterFiles(blocks);
    const ctx = {
      headers: headerValues(blocks),
      starters,
      files: Object.fromEntries(Object.entries(starters).map(([n, f]) => [n, { ...f }])),
    };
    const out = [];
    for (let i = 0; i < questions.length; i += 1) {
      if (stopRef.current) break;
      const q = questions[i];
      const qid = `${q.groupId}${q.id}`;
      setProgress({ done: i, total: questions.length, current: qid });
      let r;
      try {
        r = await trialQuestion(q, ctx);
      } catch (err) {
        r = { qid, status: 'error', detail: err?.message || String(err) };
      }
      out.push(r);
      setResults([...out]);
    }
    setProgress((p) => ({ ...p, done: out.length, current: '' }));
    setRunning(false);
  }

  const close = () => {
    stopRef.current = true;
    onHide();
  };

  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  const badge = { pass: 'success', fail: 'danger', error: 'warning', skip: 'secondary' };

  return (
    <Modal show={show} onHide={close} size="xl" backdrop={running ? 'static' : true}>
      <Modal.Header closeButton={!running}>
        <Modal.Title>Trial Run: correct answers</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-2">
          The AI answers every question correctly, runs any code, and sends the answer to the
          {graded
            ? ` scored grading used in ${mode} mode. Each question should get full marks.`
            : ' group Check. Each answer should be accepted.'}
          {' '}Uses the text in the editor. Nothing is saved.
        </p>
        <p className="text-muted small mb-3">
          {questions.length} question{questions.length === 1 ? '' : 's'} · mode: {mode}
        </p>

        {parseErrors.length > 0 && (
          <Alert variant="warning" className="py-2">
            The activity has {parseErrors.length} markup error{parseErrors.length === 1 ? '' : 's'}; fix them first for reliable results.
          </Alert>
        )}
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}

        {(running || results.length > 0) && (
          <div className="mb-3">
            <ProgressBar
              now={progress.total ? (100 * progress.done) / progress.total : 0}
              label={`${progress.done}/${progress.total}`}
            />
            <div className="small mt-1">
              {running && progress.current && <>Working on {progress.current}… </>}
              {!running && (
                <>
                  {counts.pass || 0} passed · {counts.fail || 0} failed
                  {counts.error ? ` · ${counts.error} errors` : ''}
                  {counts.skip ? ` · ${counts.skip} not checked` : ''}
                </>
              )}
            </div>
          </div>
        )}

        {results.length > 0 && (
          <Table size="sm" bordered responsive>
            <thead>
              <tr>
                <th style={{ width: '4rem' }}>Q</th>
                <th style={{ width: '6rem' }}>Result</th>
                <th style={{ width: '8rem' }}>Score</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.qid}>
                  <td>{r.qid}</td>
                  <td>
                    <Badge bg={badge[r.status] || 'secondary'}>
                      {r.status === 'skip' ? 'not checked' : r.status}
                    </Badge>
                  </td>
                  <td>{r.score}</td>
                  <td>
                    <div>{r.detail}</div>
                    {r.note && <div className="small text-warning-emphasis">{r.note}</div>}
                    {r.feedback && (
                      <div className="small mt-1" style={{ whiteSpace: 'pre-wrap' }}>
                        <strong>Grader feedback:</strong> {r.feedback}
                      </div>
                    )}
                    {r.answer && (
                      <details className="small mt-1">
                        <summary>Answer used{r.output ? ' and output' : ''}</summary>
                        {r.answer.responseText && (
                          <pre className="bg-light p-2 mb-1" style={{ whiteSpace: 'pre-wrap' }}>{r.answer.responseText}</pre>
                        )}
                        {r.answer.code && <pre className="bg-light p-2 mb-1">{r.answer.code}</pre>}
                        {r.answer.stdin?.length > 0 && <div>Input: {r.answer.stdin.join(' ⏎ ')}</div>}
                        {Object.keys(r.answer.files || {}).length > 0 && (
                          <div>Edited files: {Object.keys(r.answer.files).join(', ')}</div>
                        )}
                        {r.output && (
                          <>
                            <div className="mt-1">Output:</div>
                            <pre className="bg-dark text-light p-2 mb-1">{r.output}</pre>
                          </>
                        )}
                        {r.tokens?.limit && (
                          <div className="text-muted">Answer tokens: {r.tokens.used ?? '?'}/{r.tokens.limit}</div>
                        )}
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {/* Turtle programs draw here, out of sight. */}
        <div id={TURTLE_TARGET_ID} style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }} />
      </Modal.Body>
      <Modal.Footer>
        {running ? (
          <Button variant="outline-danger" onClick={() => { stopRef.current = true; }}>
            Stop after this question
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>Close</Button>
            <Button variant="primary" onClick={start} disabled={!questions.length}>
              {results.length ? 'Run again' : 'Start'}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
