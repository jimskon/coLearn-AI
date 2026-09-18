// server/ai/grading.js
const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL =
  process.env.OPENAI_GRADING_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-5.6-luna";

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

async function requestJsonGrade(messages, maxCompletionTokens = 700) {
  const chat = await openai.chat.completions.create({
    model: MODEL,
    messages,
    max_completion_tokens: maxCompletionTokens,
    response_format: { type: "json_object" },
  });

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
    return JSON.parse(raw);
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

async function gradeResponseBand({
  questionText,
  responseText,
  responseRubricText,
  maxRespPts,
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
  ].join("\n");

  const obj = await requestJsonGrade([
    { name: "response_grader", role: "system", content: sys },
    { role: "user", content: user },
  ]);

  return {
    responseScore: clampScore(obj.responseScore, maxRespPts),
    responseFeedback: obj.responseFeedback ? String(obj.responseFeedback).trim() : "",
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

  const sys = [
    "You grade the code and/or run-output part of one introductory programming assignment question.",
    "Grade only the submitted code and output supplied for this question.",
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
  ].join("\n");

  const obj = await requestJsonGrade([
    { name: "code_run_grader", role: "system", content: sys },
    { role: "user", content: user },
  ]);

  return {
    codeScore: clampScore(obj.codeScore, maxCodePts),
    codeFeedback: obj.codeFeedback ? String(obj.codeFeedback).trim() : "",
    runScore: clampScore(obj.runScore, maxRunPts),
    runFeedback: obj.runFeedback ? String(obj.runFeedback).trim() : "",
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
    });

    const response = await gradeResponseBand({
      questionText,
      responseText,
      responseRubricText,
      maxRespPts,
    });

    return { ...codeRun, ...response };
  } catch (err) {
    console.error("❌ gradeTestQuestion OpenAI error:", err);
    return {
      codeScore: 0, codeFeedback: "",
      runScore: 0, runFeedback: "",
      responseScore: 0, responseFeedback: "",
    };
  }
}

// ---------------------- HTTP wrapper for gradeTestQuestion ----------------------
async function gradeTestQuestionHttp(req, res) {
  try {
    const { questionText, scores, responseText, codeCells, outputText, rubric } = req.body || {};

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
    });

    return res.json(result);
  } catch (err) {
    console.error("❌ gradeTestQuestionHttp failed:", err);
    return res.status(500).json({ error: "grading failed" });
  }
}

module.exports = { gradeTestQuestion, gradeTestQuestionHttp };
