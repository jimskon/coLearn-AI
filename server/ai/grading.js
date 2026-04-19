// server/ai/grading.js
const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function stripHtml(s = "") {
  return String(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[A-Za-z!][^>]*>/g, "");
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

  const codeBucket = scores.code || rubric.code || {};
  const runBucket = scores.output || rubric.output || {};
  const respBucket = scores.response || rubric.response || {};

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
    "You are grading a short quiz/exam question for an intro programming course.",
    "You will assign numeric points separately for:",
    "- CODE (implementation quality / correctness)",
    "- RUN (program output, tests, harness behavior)",
    "- RESPONSE (written explanation or short answer).",
    "Use the rubric text exactly; partial credit is allowed.",
    "If a band has full credit, feedback for that band should be null.",
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

  userLines.push("PROGRAM OUTPUT / TEST OUTPUT:");
  userLines.push(outputText ? stripHtml(outputText) : "(none provided)");
  userLines.push("");

  userLines.push(
    `Return strict JSON only in this form:\n` +
      `{"codeScore": number, "codeFeedback": string|null, ` +
      `"runScore": number, "runFeedback": string|null, ` +
      `"responseScore": number, "responseFeedback": string|null}\n` +
      `- codeScore must be between 0 and ${maxCodePts}.\n` +
      `- runScore must be between 0 and ${maxRunPts}.\n` +
      `- responseScore must be between 0 and ${maxRespPts}.\n` +
      `- For any band with full credit, feedback for that band MUST be null.\n` +
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
