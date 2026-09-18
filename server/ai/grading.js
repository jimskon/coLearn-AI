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
  const bucketPoints = (bucket) => {
    if (bucket == null) return 0;
    if (typeof bucket === "number") return bucket;
    if (typeof bucket === "object" && typeof bucket.points === "number") {
      return bucket.points;
    }
    return 0;
  };

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

  const codeRubricText =
    stripHtml(codeBucket.instructionsRaw || codeBucket.instructionsHtml || "") || "(none)";
  const runRubricText =
    stripHtml(runBucket.instructionsRaw || runBucket.instructionsHtml || "") || "(none)";
  const responseRubricText =
    stripHtml(respBucket.instructionsRaw || respBucket.instructionsHtml || "") || "(none)";

  const codeBundle = Array.isArray(codeCells)
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

  const sys = [
    "You are grading one question from an introductory programming assignment.",

    "GRADING PRIORITY:",
    "Functional correctness matters much more than presentation or style.",
    "Award full credit when the submitted work satisfies the explicit requirements of the current question.",

    "QUESTION ISOLATION:",
    "Grade ONLY the code, response, and output supplied for this question.",
    "Never assume anything from another question in the assignment.",

    "CRITICAL TEST-CASE RULE:",
    "Values described in the question as a suggested test, example test, sample test, or phrases such as 'try' and 'should produce' are examples only unless the question explicitly says those exact values MUST be submitted.",
    "A student may use different valid inputs.",
    "NEVER deduct because actual execution output differs from the result of a suggested test when the student used different inputs.",

    "IMPORTANT OUTPUT RULE:",
    "Do not compare program output with suggested-test expected values unless the supplied evidence establishes that the student actually used those suggested-test inputs.",
    "If the actual runtime input values are not available, do not infer that an output is wrong merely because it differs from a suggested example.",
    "Instead, inspect the submitted code directly and determine whether the formula or computation is correct.",

    "VERIFY BEFORE DEDUCTING:",
    "Before deducting for a computational error, you must be able to identify a specific incorrect expression in the submitted code, OR identify the exact actual runtime inputs, calculate the correct result from those inputs, and identify the different result the program produced.",
    "If you cannot identify a specific functional or computational error from the evidence for this question, do not deduct points.",

    "DO NOT DEDUCT FOR:",
    "- spelling or grammar",
    "- capitalization or punctuation",
    "- prompt wording or output label wording",
    "- formatting or spacing",
    "- variable names",
    "- comments or lack of comments",
    "- input or output order unless explicitly required",
    "- int versus float when either works",
    "- equivalent numeric output such as 200 and 200.0",
    "- extra harmless input or output",
    "- lack of input validation",
    "- programming style",
    "- not matching a sample solution exactly",

    "You will assign numeric points separately for CODE, RUN, and RESPONSE.",
    "Use the rubric to determine required functionality, but distinguish requirements from examples, suggested tests, and sample outputs.",
    "Partial credit is allowed.",
    "Always provide concise, concrete feedback for every band that has points available.",
    "Return ONLY JSON, no commentary.",
  ].join("\n");

  const userLines = [];
  userLines.push("Question:");
  userLines.push(stripHtml(questionText || "(missing)"));
  userLines.push("");

  userLines.push(`Max code points: ${maxCodePts}`);
  userLines.push(`Max run/output points: ${maxRunPts}`);
  userLines.push(`Max response points: ${maxRespPts}`);
  userLines.push("");

  userLines.push("Rubric for CODE band:");
  userLines.push(codeRubricText);
  userLines.push("");

  userLines.push("Rubric for RUN/OUTPUT band:");
  userLines.push(runRubricText);
  userLines.push("");

  userLines.push("Rubric for RESPONSE band:");
  userLines.push(responseRubricText);
  userLines.push("");

  userLines.push("Student written RESPONSE (if any):");
  userLines.push(stripHtml(responseText || "(none)"));
  userLines.push("");

  userLines.push("Student CODE submission(s):");
  userLines.push(codeBundle || "(none)");
  userLines.push("");

  userLines.push("CODE VERIFICATION RULE:");
  userLines.push(
    "Inspect the student's actual expressions before claiming that a formula is wrong. " +
    "If the submitted code contains the formula requested by the question, do not deduct " +
    "for that formula merely because an observed output differs from a suggested example."
  );
  userLines.push("");

  userLines.push("PROGRAM OUTPUT / TEST OUTPUT:");
  userLines.push(outputText ? stripHtml(outputText) : "(none provided)");
  userLines.push("");

  if (maxRunPts <= 0) {
    userLines.push(
      "There is no separately scored RUN/OUTPUT component for this question. " +
      "Program output may be used only as supporting evidence. " +
      "Do not override visibly correct code merely because output differs from a suggested example."
    );
    userLines.push("");
  }
  userLines.push(
    `Return strict JSON only in this form:\n` +
    `{"codeScore": number, "codeFeedback": string, ` +
    `"runScore": number, "runFeedback": string, ` +
    `"responseScore": number, "responseFeedback": string}\n` +
    `- codeScore must be between 0 and ${maxCodePts}.\n` +
    `- runScore must be between 0 and ${maxRunPts}.\n` +
    `- responseScore must be between 0 and ${maxRespPts}.\n` +
    `- Feedback should always be present, even for full-credit work.\n` +
    `- DO NOT mention grading, points, rubrics, or scores.\n`
  );

  const user = userLines.join("\n");

  try {
    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { name: "grader", role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      max_tokens: 260,
      response_format: { type: "json_object" },
    });

    const raw = (chat.choices?.[0]?.message?.content ?? "").trim();
    const obj = JSON.parse(raw);

    let codeScore = Number(obj.codeScore ?? 0);
    let runScore = Number(obj.runScore ?? 0);
    let responseScore = Number(obj.responseScore ?? 0);

    if (!Number.isFinite(codeScore)) codeScore = 0;
    if (!Number.isFinite(runScore)) runScore = 0;
    if (!Number.isFinite(responseScore)) responseScore = 0;

    codeScore = Math.max(0, Math.min(maxCodePts, codeScore));
    runScore = Math.max(0, Math.min(maxRunPts, runScore));
    responseScore = Math.max(0, Math.min(maxRespPts, responseScore));

    const codeFeedback = obj.codeFeedback ? String(obj.codeFeedback).trim() : "";
    const runFeedback = obj.runFeedback ? String(obj.runFeedback).trim() : "";
    const responseFeedback = obj.responseFeedback ? String(obj.responseFeedback).trim() : "";

    return { codeScore, codeFeedback, runScore, runFeedback, responseScore, responseFeedback };
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
