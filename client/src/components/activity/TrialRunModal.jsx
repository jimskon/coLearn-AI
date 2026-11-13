// Trial Run (activity editor): answer every question with a correct answer,
// run any code the way a student's Run button would, and send the answer to
// the grader students use for this activity's mode. Nothing is saved: the
// group graders get dryRun, and test grading is stateless.
//
//   group / demo / playground  -> group Check (/evaluate-response, /evaluate-code)
//   test / practice / assignment -> scored grading (/grade-test-question)
import React, { useMemo, useRef, useState } from 'react';
import { Modal, Button, ButtonGroup, Table, Badge, Alert, ProgressBar } from 'react-bootstrap';
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

// One request for one step ("writing the answer", "grading"). A request
// that gets no answer, or a 502/504 from the proxy, is tried once more; the
// error then names the step, the cause, and how long it took.
const RETRY_STATUS = new Set([502, 504]);

async function postJson(path, body, step) {
  let lastError = '';
  let tries = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    tries = attempt;
    const t0 = Date.now();
    const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;
    let res;
    try {
      res = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
    } catch {
      lastError = `no answer from the server after ${secs()} (network drop, server restart, or a proxy time limit)`;
      if (attempt === 1) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      break;
    }
    const raw = await res.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: '' }; }
    if (res.ok) return data;
    lastError = res.status === 504
      ? `the server took too long (504 after ${secs()}; likely a proxy time limit)`
      : `${data?.error || `HTTP ${res.status}`} (after ${secs()})`;
    if (attempt === 1 && RETRY_STATUS.has(res.status)) { await new Promise((r) => setTimeout(r, 2000)); continue; }
    break;
  }
  throw new Error(`${step} failed${tries > 1 ? ' (tried twice)' : ''}: ${lastError}`);
}

export default function TrialRunModal({ show, onHide, sourceText = '', features = {} }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const stopRef = useRef(false);
  const [kind, setKind] = useState('correct'); // 'correct' | 'nearmiss'
  const ctxRef = useRef(null); // file state at the end of the last run, for retries

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

  // What a question needs, or a finished row when it is not checked.
  function prepare(q) {
    const qid = `${q.groupId}${q.id}`;
    const base = { qid, status: 'skip', detail: '', feedback: '', score: '', attempts: [] };
    const max = maxPoints(q.scores);

    if (q.multipleChoice?.choices?.length) {
      const mc = q.multipleChoice;
      if (!mc.correctAnswer && !mc.hasChoiceScores) {
        return { done: { ...base, detail: 'Survey question (no keyed answer); not checked.' } };
      }
      if (graded && max <= 0) return { done: { ...base, detail: 'No \\score, so it is not graded in this mode.' } };
      return {
        done: {
          ...base,
          status: 'pass',
          detail: mc.correctAnswer
            ? `Multiple choice, keyed to "${mc.correctAnswer}". Scored without AI.`
            : `Multiple choice, scored by choice points (best: ${mc.maxChoicePoints}). Scored without AI.`,
        },
      };
    }
    if (graded && max <= 0) return { done: { ...base, detail: 'No \\score, so it is not graded in this mode.' } };

    const box = codeBoxFor(q);
    const wantsText = wantsTextFor(q);
    const tableText = q.hasTableResponse ? tableTextFor(q) : '';
    if (!box && !wantsText && !tableText) {
      return { done: { ...base, detail: 'Nothing for a student to answer here (for example, an AI conversation); not checked.' } };
    }
    return { qid, base, max, box, wantsText, tableText, questionText: stripHtml(q.prompt) || `Question ${qid}` };
  }

  // Run one answer's code like the Run button and send it to this mode's
  // grader. files: the activity files as this answer leaves them.
  async function runAndGrade(q, prep, ctx, answer, files) {
    const { qid, box, max, wantsText, questionText } = prep;
    const contents = Object.fromEntries(Object.entries(files).map(([n, f]) => [n, f.content]));
    const supportingFiles = Object.entries(files).map(([name, f]) => ({
      name,
      content: f.content,
      edited: f.content.trimEnd() !== (ctx.starters[name]?.content || '').trimEnd(),
    }));

    let output = '';
    let note = '';
    if (box && answer.code) {
      if (box.runner === 'pyremote' && features.remotePython === false) {
        note = 'Not run: remote Python is turned off on this server.';
      } else if (box.runner === 'cpp' && features.remoteCpp === false) {
        note = 'Not run: remote C++ is turned off on this server.';
      } else {
        try {
          const ran = box.runner === 'skulpt' || box.runner === 'turtle'
            ? await runSkulpt(box, answer.code, contents, answer.stdin || [])
            : await runRemote(box, answer.code, contents, answer.stdin || []);
          output = String(ran.output || '').trim();
          note = ran.note ? `Running the code: ${ran.note}` : '';
        } catch (err) {
          note = `Running the code failed: ${err?.message || err}. Graded without output.`;
        }
      }
    }
    const att = { answer, output, note };

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
      }, 'Grading');
      const earned = (Number(g.codeScore) || 0) + (Number(g.runScore) || 0) + (Number(g.responseScore) || 0);
      return {
        ...att,
        earned,
        full: earned >= max,
        score: `${earned}/${max}`,
        failed: !!g.gradingFailed,
        feedback: [g.codeFeedback, g.runFeedback, g.responseFeedback].map((x) => String(x || '').trim()).filter(Boolean).join('\n\n'),
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
      }, 'Grading (group Check)');
    } else if (sameCode(answer.code, box.starter)) {
      // The run page refuses unchanged starter code before any AI call.
      return {
        ...att,
        accepted: false,
        starterUnchanged: true,
        score: 'not accepted',
        feedback: 'Modify the starter program to solve the task, then submit again.',
      };
    } else {
      g = await postJson('/api/ai/evaluate-code', {
        ...common,
        studentCode: answer.code,
        codeVersion: qid,
        lang: box.lang,
        isCodeOnly: true,
        outputText: output,
        supportingFiles: supportingFiles.filter((f) => f.content.trim()),
      }, 'Grading (group code Check)');
    }
    const accepted = g.accepted === true;
    return {
      ...att,
      accepted,
      score: accepted ? 'accepted' : 'not accepted',
      feedback: [g.feedback || g.comment, g.followup || g.followupQuestion]
        .map((x) => String(x || '').trim()).filter(Boolean).join('\n\n'),
    };
  }

  function answerRequest(prep, q, ctx, kind) {
    const { box, wantsText, tableText, questionText } = prep;
    return postJson('/api/ai/trial-answer', {
      kind,
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
      files: Object.entries(ctx.files).map(([name, f]) => ({ name, content: f.content, readonly: f.readonly })),
    }, kind === 'nearmiss' ? 'Writing the answers' : 'Writing the answer');
  }

  // The activity files with an answer's edits applied (ctx is not changed).
  function filesWith(ctx, answer) {
    const files = Object.fromEntries(Object.entries(ctx.files).map(([n, f]) => [n, { ...f }]));
    for (const [name, content] of Object.entries(answer.files || {})) {
      if (files[name]) files[name] = { ...files[name], content };
    }
    return files;
  }

  // Mode 1: one correct answer must pass.
  async function trialCorrect(q, ctx) {
    const prep = prepare(q);
    if (prep.done) return prep.done;
    const answer = await answerRequest(prep, q, ctx, 'correct');
    // A correct answer's file edits stay for later questions, as for students.
    ctx.files = filesWith(ctx, answer);
    const r = await runAndGrade(q, prep, ctx, answer, ctx.files);
    const attempts = [{ label: 'Correct answer', ...r }];
    const row = { ...prep.base, attempts, tokens: answer.aiTokens, score: r.score, feedback: r.feedback };

    if (graded) {
      if (r.failed) return { ...row, status: 'error', detail: 'The grader did not finish.' };
      return {
        ...row,
        status: r.full ? 'pass' : 'fail',
        detail: r.full ? 'A correct answer earned full marks.' : `A correct answer earned only ${r.earned} of ${prep.max}.`,
      };
    }
    if (r.starterUnchanged) {
      return { ...row, status: 'fail', detail: 'The correct answer leaves the starter code unchanged, but the group Check requires students to change the code.' };
    }
    return {
      ...row,
      status: r.accepted ? 'pass' : 'fail',
      detail: r.accepted ? 'A correct answer was accepted.' : 'A correct answer was not accepted.',
    };
  }

  // Mode 2: a near miss must be caught with feedback that points at the
  // mistake (without giving the answer where feedback scaffolds), and the
  // corrected answer must then pass.
  async function trialNearMiss(q, ctx) {
    const prep = prepare(q);
    if (prep.done) return prep.done;
    const pair = await answerRequest(prep, q, ctx, 'nearmiss');

    const wrong = await runAndGrade(q, prep, ctx, pair.nearMiss, filesWith(ctx, pair.nearMiss));
    ctx.files = filesWith(ctx, pair.correct);
    const right = await runAndGrade(q, prep, ctx, pair.correct, ctx.files);

    const scaffolds = !graded || mode === 'practice';
    const caught = graded ? !wrong.full : !wrong.accepted;
    const passedFix = graded ? right.full : right.accepted;

    let judge = null;
    if (caught && !wrong.starterUnchanged) {
      judge = await postJson('/api/ai/trial-judge', {
        questionText: prep.questionText,
        mistake: pair.mistake,
        answerText: pair.nearMiss.responseText,
        answerCode: pair.nearMiss.code,
        feedback: wrong.feedback,
      }, 'Checking the feedback');
    }

    const checks = [
      {
        ok: caught,
        text: graded
          ? (caught ? `Near miss lost points (${wrong.score}).` : `Near miss got full marks (${wrong.score}); the grading is too lenient.`)
          : (caught ? 'Near miss was not accepted.' : 'Near miss was accepted; the Check is too lenient.'),
      },
    ];
    if (judge) {
      checks.push({
        ok: judge.pointsAtMistake,
        text: judge.pointsAtMistake ? 'Feedback points at the mistake.' : `Feedback misses the mistake. ${judge.reason}`,
      });
      if (scaffolds) {
        checks.push({
          ok: !judge.revealsAnswer,
          text: judge.revealsAnswer ? `Feedback gives the answer away. ${judge.reason}` : 'Feedback does not give the answer away.',
        });
      }
    }
    checks.push({
      ok: passedFix && !right.starterUnchanged,
      text: right.starterUnchanged
        ? 'The fixed answer leaves the starter code unchanged, which the group Check refuses.'
        : graded
          ? (passedFix ? `Fixed answer earned full marks (${right.score}).` : `Fixed answer earned only ${right.score}.`)
          : (passedFix ? 'Fixed answer was accepted.' : 'Fixed answer was not accepted.'),
    });

    const failedGrade = wrong.failed || right.failed;
    return {
      ...prep.base,
      status: failedGrade ? 'error' : checks.every((c) => c.ok) ? 'pass' : 'fail',
      score: `${wrong.score} → ${right.score}`,
      detail: failedGrade ? 'The grader did not finish.' : '',
      checks,
      mistake: pair.mistake,
      tokens: pair.aiTokens,
      attempts: [
        { label: 'Near miss', ...wrong },
        { label: 'Fixed answer', ...right },
      ],
    };
  }

  const trialQuestion = (q, ctx) => (kind === 'nearmiss' ? trialNearMiss(q, ctx) : trialCorrect(q, ctx));

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
    ctxRef.current = ctx;
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

  // Re-run only the rows that errored, in place, with the files as the run left them.
  async function retryErrors() {
    const ctx = ctxRef.current;
    if (!ctx) return;
    stopRef.current = false;
    setRunning(true);
    const out = [...results];
    const todo = out.map((r, i) => (r.status === 'error' ? i : -1)).filter((i) => i >= 0);
    for (let n = 0; n < todo.length; n += 1) {
      if (stopRef.current) break;
      const i = todo[n];
      const q = questions.find((x) => `${x.groupId}${x.id}` === out[i].qid);
      if (!q) continue;
      setProgress({ done: n, total: todo.length, current: out[i].qid });
      try {
        out[i] = await trialQuestion(q, ctx);
      } catch (err) {
        out[i] = { qid: out[i].qid, status: 'error', detail: err?.message || String(err) };
      }
      setResults([...out]);
    }
    setProgress({ done: todo.length, total: todo.length, current: '' });
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
        <Modal.Title>Trial Run</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <ButtonGroup size="sm" className="mb-2">
          <Button
            variant={kind === 'correct' ? 'primary' : 'outline-primary'}
            onClick={() => { setKind('correct'); setResults([]); }}
            disabled={running}
          >
            Correct answers
          </Button>
          <Button
            variant={kind === 'nearmiss' ? 'primary' : 'outline-primary'}
            onClick={() => { setKind('nearmiss'); setResults([]); }}
            disabled={running}
          >
            Near miss, then fixed
          </Button>
        </ButtonGroup>
        <p className="mb-2">
          {kind === 'correct' ? (
            <>
              The AI answers every question correctly, runs any code, and sends the answer to the
              {graded
                ? ` scored grading used in ${mode} mode. Each question should get full marks.`
                : ' group Check. Each answer should be accepted.'}
            </>
          ) : (
            <>
              For each question the AI first submits a near miss (one realistic mistake), then the fixed answer.
              {graded
                ? ' The near miss should lose points, with feedback that points at the mistake'
                : ' The near miss should not be accepted, and its feedback should point at the mistake'}
              {graded && mode !== 'practice' ? '.' : ' without giving the answer away.'}
              {graded ? ' The fixed answer should get full marks.' : ' The fixed answer should be accepted.'}
            </>
          )}
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
                    {r.detail && <div>{r.detail}</div>}
                    {r.checks?.map((c, i) => (
                      <div key={i} className={c.ok ? 'text-success' : 'text-danger'}>
                        {c.ok ? '✓' : '✗'} {c.text}
                      </div>
                    ))}
                    {r.mistake && <div className="small text-muted mt-1">Planted mistake: {r.mistake}</div>}
                    {(r.attempts || []).length === 1 && r.feedback && (
                      <div className="small mt-1" style={{ whiteSpace: 'pre-wrap' }}>
                        <strong>Grader feedback:</strong> {r.feedback}
                      </div>
                    )}
                    {(r.attempts || []).map((a, i) => (
                      <details key={i} className="small mt-1" open={r.attempts.length > 1 && i === 0 && r.status === 'fail'}>
                        <summary>
                          {a.label}: {a.score}
                          {a.note ? ` · ${a.note}` : ''}
                        </summary>
                        {r.attempts.length > 1 && a.feedback && (
                          <div className="mb-1" style={{ whiteSpace: 'pre-wrap' }}>
                            <strong>Grader feedback:</strong> {a.feedback}
                          </div>
                        )}
                        {a.answer?.responseText && (
                          <pre className="bg-light p-2 mb-1" style={{ whiteSpace: 'pre-wrap' }}>{a.answer.responseText}</pre>
                        )}
                        {a.answer?.code && <pre className="bg-light p-2 mb-1">{a.answer.code}</pre>}
                        {a.answer?.stdin?.length > 0 && <div>Input: {a.answer.stdin.join(' ⏎ ')}</div>}
                        {Object.keys(a.answer?.files || {}).length > 0 && (
                          <div>Edited files: {Object.keys(a.answer.files).join(', ')}</div>
                        )}
                        {a.output && (
                          <>
                            <div className="mt-1">Output:</div>
                            <pre className="bg-dark text-light p-2 mb-1">{a.output}</pre>
                          </>
                        )}
                      </details>
                    ))}
                    {r.tokens?.limit && (
                      <div className="small text-muted">Answer tokens: {r.tokens.used ?? '?'}/{r.tokens.limit}</div>
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
            {counts.error > 0 && ctxRef.current && (
              <Button variant="outline-warning" onClick={retryErrors}>
                Retry {counts.error} failed
              </Button>
            )}
            <Button variant="primary" onClick={start} disabled={!questions.length}>
              {results.length ? 'Run again' : 'Start'}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
