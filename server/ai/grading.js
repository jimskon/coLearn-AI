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

    "EVIDENCE-ONLY GRADING RULE:",
    "Grade ONLY what is explicitly present in the student's submitted response, code, or execution output for the current question.",
    "NEVER infer that the student performed a step merely because the question asked for it.",
    "NEVER invent or assume actual test results that are not written or shown.",
    "NEVER claim that a test passed or failed unless the student explicitly says so or execution output directly demonstrates it.",
    "NEVER invent or assume inputs, outputs, explanations, calculations, or conclusions that are not present in the supplied evidence.",
    "If a question asks for several distinct components, check independently that each requested component is actually present.",
    "Do not complete missing work on the student's behalf.",
    "Feedback must describe only evidence that actually appears in the submission.",

    "WRITTEN RESPONSE COMPLETENESS:",
    "For written-response questions, compare each requested component against the student's literal submitted response.",
    "Do not award credit for a requested component unless evidence for that component appears in the response or supplied execution output.",
    "For example, if a testing question asks for inputs, expected results, actual results, and a pass/fail conclusion, a response containing only inputs and expected results is incomplete.",
    "Do not claim that actual results or a pass/fail conclusion were provided when they are absent.",

    "EVIDENCE QUOTING REQUIREMENT:",
    "For every written-response requirement you claim is present, you must provide a short verbatim excerpt from the student's response or supplied execution output that proves it.",
    "If you cannot quote evidence for a requirement, treat that requirement as missing.",
    "Never paraphrase invented evidence and never use text from the question itself as evidence of student work.",

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

  userLines.push("RESPONSE EVIDENCE RULE:");
  userLines.push(
    "Treat the text above literally. Do not infer missing statements, test results, pass/fail conclusions, " +
    "or explanations merely because the question requested them. Award credit only for components that are " +
    "actually present in the response or directly demonstrated by supplied output."
  );
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
    `Before assigning scores, first identify only the evidence that is literally present.\n\n` +

    `For RESPONSE questions, list each distinct requirement from the question and whether the ` +
    `student response actually contains evidence for it. Do not infer missing evidence.\n\n` +

    `Return strict JSON only in this form:\n` +
    `{\n` +
    `  "responseEvidence": [\n` +
    `    {"requirement": "short description", "present": true, "evidence": "exact short excerpt from student response"},\n` +
    `    {"requirement": "short description", "present": false, "evidence": ""}\n` +
    `  ],\n` +
    `  "codeScore": number,\n` +
    `  "codeFeedback": string,\n` +
    `  "runScore": number,\n` +
    `  "runFeedback": string,\n` +
    `  "responseScore": number,\n` +
    `  "responseFeedback": string\n` +
    `}\n` +

    `IMPORTANT: If present is true, the evidence field MUST contain a short verbatim excerpt ` +
    `from the student's response or supplied program output proving that requirement is present.\n` +
    `If you cannot quote such evidence, present MUST be false.\n` +

    `- codeScore must be between 0 and ${maxCodePts}.\n` +
    `- runScore must be between 0 and ${maxRunPts}.\n` +
    `- responseScore must be between 0 and ${maxRespPts}.\n` +
    `- Feedback should always be present for bands with points available.\n` +
    `- DO NOT mention grading, points, rubrics, or scores in feedback.\n`
  );

  const user = userLines.join("\n");

  try {
    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { name: "grader", role: "system", content: sys },
        { role: "user", content: user },
      ],
      //temperature: 0.1,
      max_completion_tokens: 1000,
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

    let obj;
    try {
      obj = JSON.parse(raw);
      const literalResponse = stripHtml(responseText || "");
      const literalOutput = stripHtml(outputText || "");
      const evidenceSource = `${literalResponse}\n${literalOutput}`;

      if (Array.isArray(obj.responseEvidence)) {
        for (const item of obj.responseEvidence) {
          if (!item || item.present !== true) continue;

          const evidence = String(item.evidence || "").trim();

          // A "present" claim must quote something that literally exists
          // in the student's response or supplied output.
          if (!evidence || !evidenceSource.includes(evidence)) {
            console.warn("⚠️ Rejecting unsupported response evidence:", item);
            item.present = false;
            item.evidence = "";
          }
        }
      }
    } catch (parseErr) {
      console.error("❌ gradeTestQuestion invalid JSON response:", {
        model: MODEL,
        finishReason: choice?.finish_reason,
        raw,
        usage: chat.usage,
      });
      throw parseErr;
    }

    let codeScore = Number(obj.codeScore ?? 0);
    let runScore = Number(obj.runScore ?? 0);
    let responseScore = Number(obj.responseScore ?? 0);

    // Deterministically cap written-response credit based on
    // evidence that actually survived literal verification.
    if (maxRespPts > 0 && Array.isArray(obj.responseEvidence) && obj.responseEvidence.length > 0) {
      const totalRequirements = obj.responseEvidence.length;
      const presentRequirements = obj.responseEvidence.filter(
        item => item && item.present === true
      ).length;

      const evidenceBasedMax =
        maxRespPts * (presentRequirements / totalRequirements);

      if (responseScore > evidenceBasedMax) {
        console.warn("⚠️ Capping response score based on verified evidence:", {
          originalScore: responseScore,
          evidenceBasedMax,
          presentRequirements,
          totalRequirements,
          responseEvidence: obj.responseEvidence,
        });

        responseScore = evidenceBasedMax;
      }
    }
    console.log("GRADE VERIFIED RESPONSE EVIDENCE:", obj.responseEvidence);
    if (!Number.isFinite(codeScore)) codeScore = 0;
    if (!Number.isFinite(runScore)) runScore = 0;
    if (!Number.isFinite(responseScore)) responseScore = 0;

    codeScore = Math.max(0, Math.min(maxCodePts, codeScore));
    runScore = Math.max(0, Math.min(maxRunPts, runScore));
    responseScore = Math.floor(
      Math.max(0, Math.min(maxRespPts, responseScore))
    );

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
