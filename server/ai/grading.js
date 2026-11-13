// server/ai/grading.js
const OpenAI = require("openai");
require("dotenv").config();
const { envTokens, getAiModels, isReasoningModel, envReasoningEffort } = require("../utils/runtimeFeatures");
const { AiTokenLimitError, recordAiTokenLimit, chatHitLimit } = require("../utils/auditLogger");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// OPENAI_GRADING_MODEL, else OPENAI_MODEL (server/.env; see README, "AI models").
const MODEL = getAiModels().grading;
const GRADING_REASONING_EFFORT = envReasoningEffort("GRADING_REASONING_EFFORT");

function stripHtml(s = "") {
  return String(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[A-Za-z!][^>]*>/g, "");
}

function normalizeScoreBands(scores = {}, rubric = {}) {
  const source = (obj, key) => obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
  const response = source(scores, 'response') ?? source(rubric, 'response') ?? null;
  return {
    code: source(scores, 'code') ?? source(rubric, 'code') ?? null,
    output: source(scores, 'output') ?? source(rubric, 'output') ?? null,
    response,
  };
}

function bucketPoints(bucket) {
  if (bucket == null) return 0;
  if (typeof bucket === "number") return bucket;
  if (typeof bucket === "object" && typeof bucket.points === "number") {
    return bucket.points;
  }
  return 0;
}

function bucketRubricText(bucket) {
  return stripHtml(bucket?.instructionsRaw || bucket?.instructionsHtml || "") || "(none)";
}

function clampScore(value, maxPoints) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(Math.max(0, Math.min(maxPoints, n)));
}

// Code files the program uses (\file blocks). The student may have edited one
// as part of the work, or it may only show what their code builds on.
const MAX_FILE_CHARS = 12000;

function formatSupportingFiles(files = []) {
  if (!Array.isArray(files) || !files.length) return "";
  return files
    .map((f) => {
      const content = String(f?.content ?? "");
      const shown = content.length > MAX_FILE_CHARS
        ? `${content.slice(0, MAX_FILE_CHARS)}\n... (truncated)`
        : content;
      const status = f?.edited ? "edited by the student" : "provided, not changed by the student";
      return [`File ${f?.name} (${status}):`, "```", shown, "```"].join("\n");
    })
    .join("\n\n");
}

function formatCodeBundle(codeCells = []) {
  return Array.isArray(codeCells)
    ? codeCells
      .map((cell, idx) => {
        const lang = (cell.lang || "").toLowerCase();
        const label = cell.label ? ` (${cell.label})` : "";
        const fence =
          lang === "cpp" || lang === "c++"
            ? "cpp"
            : lang === "python"
              ? "python"
              : "";
        return [
          `Code cell ${idx + 1}${label}:`,
          "```" + fence,
          cell.code || "",
          "```",
        ].join("\n");
      })
      .join("\n\n")
    : "";
}

// Output budget per grading call (GRADING_TOKENS in server/.env). Reasoning
// models count their reasoning against it, so large answers (code plus files)
// need room; a call that runs out returns nothing and fails.
const GRADING_TOKENS = envTokens('GRADING_TOKENS', 2500);
// Practice-mode hint after a wrong multiple-choice pick (PRACTICE_HINT_TOKENS).
const PRACTICE_HINT_TOKENS = envTokens('PRACTICE_HINT_TOKENS', 300);

// limitInfo names the .env setting behind maxCompletionTokens, so a cut-off
// response can be reported: { setting, where, instanceId }.
async function requestJsonGrade(messages, maxCompletionTokens = GRADING_TOKENS, limitInfo = {}) {
  const chat = await openai.chat.completions.create({
    model: MODEL,
    messages,
    max_completion_tokens: maxCompletionTokens,
    response_format: { type: "json_object" },
    ...(GRADING_REASONING_EFFORT && isReasoningModel(MODEL) ? { reasoning_effort: GRADING_REASONING_EFFORT } : {}),
  });

  if (chatHitLimit(chat)) {
    const setting = limitInfo.setting || "GRADING_TOKENS";
    recordAiTokenLimit({
      setting,
      limit: maxCompletionTokens,
      model: MODEL,
      where: limitInfo.where || "grading",
      activityInstanceId: limitInfo.instanceId,
    });
    throw new AiTokenLimitError(setting, maxCompletionTokens);
  }

  const choice = chat.choices?.[0];
  const raw = (choice?.message?.content ?? "").trim();

  if (!raw) {
    console.error("❌ gradeTestQuestion empty OpenAI response:", {
      model: MODEL,
      finishReason: choice?.finish_reason,
      usage: chat.usage,
    });
    throw new Error("OpenAI returned an empty grading response");
  }

  try {
    const parsed = JSON.parse(raw);
    // Output tokens used, reasoning included (shown to instructors as used/limit).
    if (parsed && typeof parsed === "object") {
      Object.defineProperty(parsed, "_tokensUsed", { value: Number(chat.usage?.completion_tokens) || null });
    }
    return parsed;
  } catch (parseErr) {
    console.error("❌ gradeTestQuestion invalid JSON response:", {
      model: MODEL,
      finishReason: choice?.finish_reason,
      raw,
      usage: chat.usage,
    });
    throw parseErr;
  }
}

// Practice mode: the score is still graded, but the feedback scaffolds like
// group mode -- a hint or directed question, never the answer.
function buildPracticeFeedbackRules(practice) {
  if (!practice) return [];
  const attempt = Math.max(1, Number(practice.attemptNumber) || 1);
  const prior = (Array.isArray(practice.priorFeedback) ? practice.priorFeedback : [])
    .map((f) => String(f || '').trim())
    .filter(Boolean)
    .slice(-3);
  const guidance = String(practice.feedbackPrompt || '').trim();

  return [
    "",
    "PRACTICE MODE: this is a practice check, not a test. The student will revise and check again.",
    "The feedback must scaffold learning. Never state the correct answer, never quote a model or sample answer, and never write or fix code for the student.",
    "If the work earns full credit, confirm in one short sentence what is right.",
    "Otherwise, briefly say what is right, then ask ONE directed question or give ONE simple hint that points toward what is missing or wrong.",
    `This is check attempt ${attempt} for this question.`,
    "- Attempt 1: a gentle nudge or focused question.",
    "- Attempt 2: point to the missing idea or the part of the question to revisit.",
    "- Attempt 3 or later: a more directed hint that names exactly what to look at, still without giving the answer.",
    prior.length ? `Earlier feedback for this question (do not repeat its wording): ${prior.join(' / ')}` : "",
    guidance ? `Instructor guidance for this question: ${guidance}` : "",
    "Keep the feedback to 1-3 sentences.",
  ].filter((line) => line !== "");
}

async function gradeResponseBand({
  questionText,
  responseText,
  responseRubricText,
  maxRespPts,
  practice = null,
  instanceId = null,
}) {
  if (maxRespPts <= 0) {
    return { responseScore: 0, responseFeedback: "" };
  }

  const literalResponse = stripHtml(responseText || "").trim();
  if (!literalResponse) {
    return {
      responseScore: 0,
      responseFeedback: "No written response was provided.",
    };
  }

  const sys = [
    "You grade only the written-response part of one assignment question.",
    "The question text describes what the student was asked to do.",
    "The rubric is the grading authority and may be more lenient than the question text.",
    "Award the score the rubric allows, even when the answer omits something the question asked for, if the rubric permits that leniency.",
    "However, feedback must be evidence-honest.",
    "Never claim the student included something unless it is literally present in the written response.",
    "Do not infer actual results, pass/fail conclusions, tests run, calculations, or explanations that are not written in the response.",
    "Do not use code, program output, or other questions as evidence; they are not provided to you.",
    "If the rubric allows full credit for a partial but good-faith response, you may give full credit, but your feedback should honestly say what is present and what is missing or not explicit.",
    "Return only JSON.",
  ].join("\n");

  const user = [
    "Question:",
    stripHtml(questionText || "(missing)"),
    "",
    `Max response points: ${maxRespPts}`,
    "",
    "Rubric for RESPONSE band:",
    responseRubricText || "(none)",
    "",
    "Literal student written response:",
    literalResponse,
    "",
    "Return strict JSON only in this form:",
    "{",
    '  "responseScore": number,',
    '  "responseFeedback": string',
    "}",
    `responseScore must be between 0 and ${maxRespPts}.`,
    "Do not mention points, scores, grading, or rubrics in the feedback.",
    ...buildPracticeFeedbackRules(practice),
  ].join("\n");

  const obj = await requestJsonGrade([
    { name: "response_grader", role: "system", content: sys },
    { role: "user", content: user },
  ], GRADING_TOKENS, { where: "written-answer grading", instanceId });

  return {
    responseScore: clampScore(obj.responseScore, maxRespPts),
    responseFeedback: obj.responseFeedback ? String(obj.responseFeedback).trim() : "",
    responseTokens: obj._tokensUsed ?? null,
  };
}

async function gradeCodeRunBands({
  questionText,
  codeCells,
  outputText,
  codeRubricText,
  runRubricText,
  maxCodePts,
  maxRunPts,
  practice = null,
  supportingFiles = [],
  instanceId = null,
}) {
  if (maxCodePts <= 0 && maxRunPts <= 0) {
    return {
      codeScore: 0,
      codeFeedback: "",
      runScore: 0,
      runFeedback: "",
    };
  }

  const codeBundle = formatCodeBundle(codeCells);
  const cleanOutput = stripHtml(outputText || "").trim();
  const filesText = formatSupportingFiles(supportingFiles);

  const sys = [
    "You grade the code and/or run-output part of one introductory programming assignment question.",
    "Grade only the submitted code and output supplied for this question.",
    "Supporting code files may be listed. They are part of the student's program: use them to understand what the code builds on.",
    "If the question asks the student to write or change code in a supporting file, grade that file's contents as part of the code. Do not grade files the question does not ask about.",
    "Functional correctness matters more than presentation, prompt wording, formatting, variable names, comments, or style.",
    "Suggested test values in the question are examples only unless the question explicitly says they must be submitted.",
    "If actual runtime inputs are not available, inspect the submitted code formulas directly instead of comparing output to a suggested example.",
    "Before deducting for a computational error, identify a specific incorrect or missing expression in the submitted code, or identify exact runtime inputs and the mismatching output.",
    "Do not grade any written-response requirements here.",
    "Return only JSON.",
  ].join("\n");

  const user = [
    "Question:",
    stripHtml(questionText || "(missing)"),
    "",
    `Max code points: ${maxCodePts}`,
    `Max run/output points: ${maxRunPts}`,
    "",
    "Rubric for CODE band:",
    codeRubricText || "(none)",
    "",
    "Rubric for RUN/OUTPUT band:",
    runRubricText || "(none)",
    "",
    "Student code submission(s):",
    codeBundle || "(none)",
    "",
    ...(filesText ? ["Supporting code files:", filesText, ""] : []),
    "Program/run output:",
    cleanOutput || "(none provided)",
    "",
    "Return strict JSON only in this form:",
    "{",
    '  "codeScore": number,',
    '  "codeFeedback": string,',
    '  "runScore": number,',
    '  "runFeedback": string',
    "}",
    `codeScore must be between 0 and ${maxCodePts}.`,
    `runScore must be between 0 and ${maxRunPts}.`,
    "Do not mention points, scores, grading, or rubrics in the feedback.",
    ...buildPracticeFeedbackRules(practice),
  ].join("\n");

  const obj = await requestJsonGrade([
    { name: "code_run_grader", role: "system", content: sys },
    { role: "user", content: user },
  ], GRADING_TOKENS, { where: "code grading", instanceId });

  return {
    codeScore: clampScore(obj.codeScore, maxCodePts),
    codeFeedback: obj.codeFeedback ? String(obj.codeFeedback).trim() : "",
    runScore: clampScore(obj.runScore, maxRunPts),
    runFeedback: obj.runFeedback ? String(obj.runFeedback).trim() : "",
    codeRunTokens: obj._tokensUsed ?? null,
  };
}

// ---------------------- TEST-MODE: gradeTestQuestion ----------------------
async function gradeTestQuestion({
  questionText,
  scores = {},
  responseText = "",
  codeCells = [],
  outputText = "",
  rubric = {},
  detailedFeedback = true,
  practice = null,
  supportingFiles = [],
  instanceId = null,
}) {
  const normalizedScores = normalizeScoreBands(scores, rubric);
  const codeBucket = normalizedScores.code || {};
  const runBucket = normalizedScores.output || {};
  const respBucket = normalizedScores.response || {};

  const maxCodePts = bucketPoints(codeBucket);
  const maxRunPts = bucketPoints(runBucket);
  const maxRespPts = bucketPoints(respBucket);

  const maxTotal = maxCodePts + maxRunPts + maxRespPts;
  if (maxTotal <= 0) {
    return {
      codeScore: 0, codeFeedback: "",
      runScore: 0, runFeedback: "",
      responseScore: 0, responseFeedback: "",
    };
  }

  const codeRubricText = bucketRubricText(codeBucket);
  const runRubricText = bucketRubricText(runBucket);
  const responseRubricText = bucketRubricText(respBucket);

  try {
    const codeRun = await gradeCodeRunBands({
      questionText,
      codeCells,
      outputText,
      codeRubricText,
      runRubricText,
      maxCodePts,
      maxRunPts,
      practice,
      supportingFiles,
      instanceId,
    });

    const response = await gradeResponseBand({
      questionText,
      responseText,
      responseRubricText,
      maxRespPts,
      practice,
      instanceId,
    });

    // The larger of the (up to two) grading calls: each has the same limit.
    const used = [codeRun.codeRunTokens, response.responseTokens].filter((n) => n != null);
    const aiTokens = used.length ? { used: Math.max(...used), limit: GRADING_TOKENS } : null;
    return { ...codeRun, ...response, aiTokens };
  } catch (err) {
    console.error("❌ gradeTestQuestion OpenAI error:", err);
    // Say so in the feedback: a silent 0 looks like a real grade.
    const note = err?.code === "AI_TOKEN_LIMIT"
      ? `⚠ AI grading did not finish: ${err.message} Then regrade this question.`
      : "⚠ AI grading failed for this question (the AI service returned an error). Please regrade it.";
    const onCode = maxCodePts + maxRunPts > 0;
    return {
      codeScore: 0, codeFeedback: onCode ? note : "",
      runScore: 0, runFeedback: "",
      responseScore: 0, responseFeedback: onCode ? "" : note,
      gradingFailed: true,
      aiTokens: err?.code === "AI_TOKEN_LIMIT" ? { used: err.limit, limit: err.limit } : null,
    };
  }
}

// ---------------------- HTTP wrapper for gradeTestQuestion ----------------------
async function gradeTestQuestionHttp(req, res) {
  try {
    const { questionText, scores, responseText, codeCells, outputText, rubric } = req.body || {};
    const supportingFiles = (Array.isArray(req.body?.supportingFiles) ? req.body.supportingFiles : [])
      .filter((f) => f && typeof f.name === "string" && typeof f.content === "string")
      .slice(0, 20)
      .map((f) => ({ name: f.name.slice(0, 200), content: f.content, edited: !!f.edited }));

    if (!questionText || !scores) {
      return res.status(400).json({ error: "Missing questionText or scores" });
    }

    const result = await gradeTestQuestion({
      questionText,
      scores,
      responseText: responseText || "",
      codeCells: Array.isArray(codeCells) ? codeCells : [],
      outputText: outputText || "",
      rubric: rubric || scores,
      supportingFiles,
    });

    return res.json(result);
  } catch (err) {
    console.error("❌ gradeTestQuestionHttp failed:", err);
    return res.status(500).json({ error: "grading failed" });
  }
}

// ---------------- PRACTICE: multiple-choice hint ----------------
// The score for a multiple-choice question is exact and never uses AI. This
// only writes the scaffolding hint for a wrong pick, so the student gets a
// directed question instead of "wrong". Returns '' if the AI call fails.
async function practiceMultipleChoiceHint({
  questionText,
  choices = [],
  selected,
  correctAnswer,
  practice = null,
}) {
  const attempt = Math.max(1, Number(practice?.attemptNumber) || 1);
  const prior = (Array.isArray(practice?.priorFeedback) ? practice.priorFeedback : [])
    .map((f) => String(f || "").trim())
    .filter(Boolean)
    .slice(-3);

  const sys = [
    "You coach a first-year programming student who picked the wrong answer on a practice multiple-choice question.",
    "Write ONE short directed question (or a one-sentence hint followed by a question) that helps them reason toward the right answer themselves.",
    "Never state, quote, paraphrase, or point to the correct choice. Never say which choice is right, and never rule choices in or out by letter or by text.",
    "Focus on the idea behind the question: what the code does step by step, what a term means, or why the choice they picked does not fit.",
    "Match the level of help to the attempt number:",
    "- Attempt 1: a gentle question about the key idea.",
    "- Attempt 2: point to the specific detail they are probably overlooking.",
    "- Attempt 3 or later: a very directed question, such as asking them to trace a specific value or line, still without giving the answer.",
    "Do not repeat earlier hints. Do not mention points, scores, or grading. One or two sentences.",
    "Return only JSON.",
  ].join("\n");

  const user = [
    "Question:",
    stripHtml(questionText || "(missing)"),
    "",
    "Choices:",
    ...choices.map((c) => `- ${String(c)}`),
    "",
    `Student picked: ${String(selected || "")}`,
    `Correct answer (for your reasoning only -- NEVER reveal it): ${String(correctAnswer || "")}`,
    `Check attempt: ${attempt}`,
    prior.length ? `Earlier hints (do not repeat): ${prior.join(" / ")}` : "",
    practice?.feedbackPrompt ? `Instructor guidance: ${practice.feedbackPrompt}` : "",
    "",
    'Return strict JSON only: { "hint": string }',
  ].filter((line) => line !== "").join("\n");

  try {
    const obj = await requestJsonGrade([
      { name: "practice_mc_hint", role: "system", content: sys },
      { role: "user", content: user },
    ], PRACTICE_HINT_TOKENS, { setting: "PRACTICE_HINT_TOKENS", where: "practice hint" });
    return obj?.hint ? String(obj.hint).trim() : "";
  } catch (err) {
    console.error("❌ practiceMultipleChoiceHint failed:", err?.message || err);
    return "";
  }
}

// ---------------- TRIAL RUN: write a correct student answer ----------------
// Instructor tool (Trial Run in the activity editor). Writes the answer a
// strong student would give to one question, so the editor can run it and
// send it to the same graders students use. Nothing is saved.
const TRIAL_ANSWER_TOKENS = envTokens('TRIAL_ANSWER_TOKENS', 4000);
const TRIAL_ROLES = new Set(["instructor", "root", "creator"]);

async function trialAnswerHttp(req, res) {
  if (!TRIAL_ROLES.has(String(req.user?.role || "").toLowerCase())) {
    return res.status(403).json({ error: "Trial Run is for instructors." });
  }

  const b = req.body || {};
  const clip = (s, n = 6000) => String(s ?? "").slice(0, n);
  const questionText = clip(stripHtml(b.questionText || ""));
  if (!questionText.trim()) {
    return res.status(400).json({ error: "questionText is required" });
  }

  const files = (Array.isArray(b.files) ? b.files : [])
    .filter((f) => f && typeof f.name === "string")
    .slice(0, 20);
  const code = b.code && typeof b.code === "object" ? b.code : null;
  const bands = ["code", "output", "response"]
    .map((k) => {
      const band = b.scores?.[k];
      const pts = bucketPoints(band);
      return pts > 0 ? `- ${k} (${pts} pts): ${bucketRubricText(band)}` : "";
    })
    .filter(Boolean);

  const sys = [
    "You are testing a classroom activity before students see it.",
    "Write the answer a strong student would submit for ONE question.",
    "The answer must be fully correct and complete, follow every instruction in the question, and agree with the sample answer and grading guidance when they are given.",
    "Write at the level of the stated students: correct, clear, and no more advanced than the question needs.",
    "Return only JSON.",
  ].join("\n");

  const user = [
    b.activityContext ? `Activity: ${clip(stripHtml(b.activityContext), 1000)}` : "",
    b.studentLevel ? `Student level: ${clip(stripHtml(b.studentLevel), 200)}` : "",
    b.language ? `Write the written answer in: ${clip(b.language, 50)}` : "",
    "",
    "Question:",
    questionText,
    "",
    "The student answers with:",
    b.wantsText ? "- a written answer" : "",
    b.tableText ? `- a filled-in table (return it as a markdown table with every cell filled):\n${clip(b.tableText, 3000)}` : "",
    code ? `- ${code.lang === "cpp" ? "C++" : "Python"} code in the question's code box. Starter code:\n${clip(code.starter || "(empty)")}` : "",
    "",
    ...(Array.isArray(b.samples) && b.samples.length
      ? ["Instructor's sample answer:", ...b.samples.map((s) => clip(stripHtml(s), 3000)), ""]
      : []),
    b.feedbackPrompt ? `Instructor's grading guidance: ${clip(stripHtml(b.feedbackPrompt), 2000)}\n` : "",
    bands.length ? `Rubric:\n${bands.join("\n")}\n` : "",
    ...(files.length
      ? [
          "Files in the activity (the code can import or read them):",
          ...files.map((f) => `--- ${f.name}${f.readonly ? " (read-only)" : " (the student may edit it)"} ---\n${clip(f.content)}`),
          "",
        ]
      : []),
    "Return strict JSON only:",
    "{",
    '  "responseText": string,   // the written answer, or the markdown table; "" if neither is asked for',
    '  "code": string,           // the complete code for the code box, built from the starter code; "" if there is no code box',
    '  "stdin": [string],        // input lines the program reads, in order; [] if none',
    '  "files": { "name": string } // full new contents of editable files the question asks the student to change; {} if none',
    "}",
  ].filter((line) => line !== "").join("\n");

  try {
    const obj = await requestJsonGrade([
      { role: "system", content: sys },
      { role: "user", content: user },
    ], TRIAL_ANSWER_TOKENS, { setting: "TRIAL_ANSWER_TOKENS", where: "trial run answer" });

    const editable = new Set(files.filter((f) => !f.readonly).map((f) => f.name));
    const outFiles = {};
    for (const [name, content] of Object.entries(obj?.files || {})) {
      if (editable.has(name) && typeof content === "string") outFiles[name] = content;
    }
    return res.json({
      responseText: typeof obj?.responseText === "string" ? obj.responseText : "",
      code: typeof obj?.code === "string" ? obj.code : "",
      stdin: Array.isArray(obj?.stdin) ? obj.stdin.map(String).slice(0, 200) : [],
      files: outFiles,
      aiTokens: { used: obj?._tokensUsed ?? null, limit: TRIAL_ANSWER_TOKENS },
    });
  } catch (err) {
    console.error("❌ trialAnswerHttp failed:", err?.message || err);
    const status = err?.code === "AI_TOKEN_LIMIT" ? 503 : 500;
    return res.status(status).json({ error: err?.message || "Could not write a trial answer." });
  }
}

module.exports = { gradeTestQuestion, gradeTestQuestionHttp, practiceMultipleChoiceHint, requestJsonGrade, trialAnswerHttp };
