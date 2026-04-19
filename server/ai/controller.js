// server/ai/controller.js
const OpenAI = require("openai");
require("dotenv").config();

const db = require("../db");
const crypto = require("crypto");

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
}

const { gradeTestQuestionHttp, gradeTestQuestion } = require("./grading");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

console.log("[AI_FINGERPRINT] controller.js loaded at", new Date().toISOString(), "AI_DEBUG=", process.env.AI_DEBUG);


// ---------- DEBUG HELPERS ----------
const AI_DEBUG = process.env.AI_DEBUG === "1";

function clip(s, n = 240) {
  const t = String(s ?? "");
  return t.length <= n ? t : t.slice(0, n) + `...(+${t.length - n} chars)`;
}

function lensObj(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = v.length;
    else if (Array.isArray(v)) out[k] = `array(${v.length})`;
    else if (v && typeof v === "object") out[k] = "object";
    else out[k] = v;
  }
  return out;
}

function extractFollowupFromFeedbackPrompt(text = "") {
  const raw = stripHtml(text || "");
  const m = raw.match(/^\s*FOLLOWUP\s*:\s*(.+)\s*$/im);
  return m ? m[1].trim() : null;
}

function logReq(tag, req) {
  if (!AI_DEBUG) return;
  const b = req.body || {};
  console.log(`[AI_DEBUG] ${tag} keys=`, Object.keys(b));
  console.log(`[AI_DEBUG] ${tag} lens=`, lensObj(b));
  // A few safe previews (edit/remove if you prefer)
  if (b.qid || b.questionId) console.log(`[AI_DEBUG] ${tag} qid=`, b.qid || b.questionId);
  if (b.questionText) console.log(`[AI_DEBUG] ${tag} questionText=`, clip(stripHtml(b.questionText), 180));
  if (b.feedbackPrompt) console.log(`[AI_DEBUG] ${tag} feedbackPrompt=`, clip(stripHtml(b.feedbackPrompt), 180));
  if (b.sampleResponse) console.log(`[AI_DEBUG] ${tag} sampleResponse=`, clip(stripHtml(b.sampleResponse), 180));
  if (b.followupPrompt) console.log(`[AI_DEBUG] ${tag} followupPrompt=`, clip(stripHtml(b.followupPrompt), 180));
  if (b.studentCode) console.log(`[AI_DEBUG] ${tag} studentCode=`, clip(b.studentCode, 220));
  if (b.studentAnswer) console.log(`[AI_DEBUG] ${tag} studentAnswer=`, clip(stripHtml(b.studentAnswer), 220));
}

function logPrompt(tag, prompt) {
  if (!AI_DEBUG) return;
  console.log(`[AI_DEBUG] ${tag} PROMPT len=${String(prompt || "").length}`);
  console.log(`[AI_DEBUG] ${tag} PROMPT preview=\n${clip(prompt, 1200)}\n---`);
}

function logModelRaw(tag, raw) {
  if (!AI_DEBUG) return;
  console.log(`[AI_DEBUG] ${tag} MODEL_RAW len=${String(raw || "").length}`);
  console.log(`[AI_DEBUG] ${tag} MODEL_RAW preview=\n${clip(raw, 800)}\n---`);
}

// ---------- Shared helpers ----------
function stripHtml(s = "") {
  return String(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[A-Za-z!][^>]*>/g, "");
}

function normalizeAIResult(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};

  const feedbackStr =
    (typeof o.feedback === 'string' && o.feedback.trim()) ? o.feedback.trim()
      : (typeof o.comment === 'string' && o.comment.trim()) ? o.comment.trim()
        : (typeof o.followupQuestion === 'string' && o.followupQuestion.trim()) ? o.followupQuestion.trim()
          : (typeof o.followup === 'string' && o.followup.trim()) ? o.followup.trim()
            : '';

  const feedback = feedbackStr ? feedbackStr : null;

  let accepted;
  if (typeof o.accepted === 'boolean') {
    accepted = o.accepted;
  } else if (typeof o.needsRevision === 'boolean') {
    accepted = !o.needsRevision;
  } else {
    // Conservative: if AI said anything but gave no flag, do NOT auto-pass
    accepted = feedback ? false : true;
  }

  return { accepted, feedback };
}

function sendAI(res, payload, status = 200) {
  const accepted = payload?.accepted === true;
  const feedback =
    payload?.feedback == null ? null : String(payload.feedback).trim() || null;

  const canContinue = payload?.canContinue === true;

  const retryCount =
    Number.isFinite(Number(payload?.retryCount)) ? Number(payload.retryCount) : null;
  const retriesRequired =
    Number.isFinite(Number(payload?.retriesRequired)) ? Number(payload.retriesRequired) : null;

  return res.status(status).json({ accepted, feedback, canContinue, retryCount, retriesRequired });
}


function retryKeys(groupNum) {
  const g = Number(groupNum);
  return {
    maxKey: `Rmax:${g}`,
    cntKey: `Rcnt:${g}`,
    hashKey: `Rhash:${g}`,
  };
}

async function upsertResp(conn, instanceId, qid, value, answeredByUserId) {
  await conn.query(
    `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, 'text', ?, ?)
     ON DUPLICATE KEY UPDATE response = VALUES(response), updated_at = CURRENT_TIMESTAMP`,
    [instanceId, qid, String(value ?? ""), answeredByUserId]
  );
}

/**
 * Group-level retry gate.
 * - initializes max+count+hash on first rejected submit
 * - increments count ONLY if submission hash changed
 * - returns { canContinue: boolean, retryCount, retriesRequired }
 */
async function applyGroupRetryGate({
  instanceId,
  groupNum,
  answeredByUserId,
  retriesRequired,
  accepted,
  submissionString,
}) {
  console.log("[RETRIES]", retriesRequired, accepted, "hash:", sha256Hex(String(submissionString ?? "")));
  const max = Number(retriesRequired) || 0;

  // If no retry policy, never block progression
  if (max <= 0) {
    return { canContinue: true, retryCount: 0, retriesRequired: 0 };
  }

  // If accepted, always allow progression
  if (accepted === true) {
    return { canContinue: true, retryCount: 0, retriesRequired: max };
  }

  const s = String(submissionString ?? "").trim();

  const { maxKey, cntKey, hashKey } = retryKeys(groupNum);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT question_id, response
       FROM responses
       WHERE activity_instance_id = ?
         AND question_id IN (?, ?, ?)`,
      [instanceId, maxKey, cntKey, hashKey]
    );

    const map = new Map(rows.map(r => [String(r.question_id), r.response]));

    const storedMax = Number(map.get(maxKey));
    let retryCount = Number(map.get(cntKey));
    let storedHash = String(map.get(hashKey) ?? "");

    // initialize max/count if missing
    if (!Number.isFinite(storedMax)) {
      await upsertResp(conn, instanceId, maxKey, max, answeredByUserId);
    }
    if (!Number.isFinite(retryCount)) {
      retryCount = 0;
      await upsertResp(conn, instanceId, cntKey, retryCount, answeredByUserId);
    }

    // ✅ “valid try” gate #1: blank doesn't count (but we still return real retryCount)
    if (!s) {
      await conn.commit();
      return {
        canContinue: retryCount >= max,
        retryCount,
        retriesRequired: max,
      };
    }

    const newHash = sha256Hex(s);

    // ✅ baseline hash on first counted failure (no increment)
    if (!storedHash) {
      storedHash = newHash;
      retryCount += 1;
      await upsertResp(conn, instanceId, cntKey, retryCount, answeredByUserId);
      await upsertResp(conn, instanceId, hashKey, storedHash, answeredByUserId);
      await conn.commit();
      return { canContinue: retryCount >= max, retryCount, retriesRequired: max };
    }

    // ✅ “valid try” gate #2: only count if changed since last counted try
    if (newHash !== storedHash) {
      retryCount += 1;
      storedHash = newHash;
      await upsertResp(conn, instanceId, cntKey, retryCount, answeredByUserId);
      await upsertResp(conn, instanceId, hashKey, storedHash, answeredByUserId);
    }

    await conn.commit();

    return {
      canContinue: retryCount >= max,
      retryCount,
      retriesRequired: max,
    };
  } catch (e) {
    try { await conn.rollback(); } catch { }
    return { canContinue: false, retryCount: 0, retriesRequired: max };
  } finally {
    conn.release();
  }
}
// ---------- Positive feedback toggles ----------
// Activity-level default: Positive feedback ON.
// Per-question override: put "No-Positive-feedback" anywhere in \followupprompt{...}
// Case-insensitive everywhere.

const POSITIVE_ON_TOKEN = "positive-feedback";
const POSITIVE_OFF_TOKEN = "no-positive-feedback";

function parsePositiveFeedbackFromText(text = "") {
  const raw = stripHtml(text || "");
  const lower = raw.toLowerCase();

  const hasOff = lower.includes(POSITIVE_OFF_TOKEN);
  const hasOn = lower.includes(POSITIVE_ON_TOKEN);

  // Remove tokens wherever they appear (case-insensitive)
  const cleaned = raw
    .replace(new RegExp(POSITIVE_OFF_TOKEN, "ig"), "")
    .replace(new RegExp(POSITIVE_ON_TOKEN, "ig"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { hasOff, hasOn, cleaned };
}

function isPositiveFeedbackEnabled(activityGuidance = "", followupPrompt = "") {
  const a = parsePositiveFeedbackFromText(activityGuidance);
  const q = parsePositiveFeedbackFromText(followupPrompt);

  // Question-level overrides always win
  if (q.hasOff) return false;
  if (q.hasOn) return true;

  // Activity-level applies if question didn't override
  if (a.hasOff) return false;
  if (a.hasOn) return true;

  // Default = ON
  return true;
}


const isNone = (s) => /^\s*none\s*$/i.test(String(s || "").trim());

const FATAL_PATTERNS = [
  /Traceback/i,
  /SyntaxError/i,
  /NameError/i,
  /TypeError/i,
  /ZeroDivisionError/i,
  /\bruntimeerror\b/i,
  /\binfinite loop\b/i,
  /\bwon'?t run\b/i,
  /\bdoes not run\b/i,
];

function isFatal(text) {
  const t = String(text || "").trim();
  return !!t && FATAL_PATTERNS.some((r) => r.test(t));
}

// IMPORTANT: keep “learning encouragement” phrases OUT of this filter.
// Only strip actual nitpicks: style, naming, spacing, refactor, optimize, extras.
const SOFT_PATTERNS = [
  /\bstyle\b/i,
  /\bnaming\b/i,
  /\bformat(ting)?\b/i,
  /\bspacing\b/i,
  /uppercase.*lowercase/i,
  /\brefactor\b/i,
  /\boptimi[sz]e\b/i,
  /\bextra feature\b/i,
];

function isSoftNitpick(text) {
  const t = String(text || "").trim();
  return !t || SOFT_PATTERNS.some((r) => r.test(t));
}

const GIBBERISH_PATTERNS = [
  /^\s*$/,
  /^(idk|i don'?t know|dunno|n\/a)\s*$/i,
  /^[^a-zA-Z0-9]{3,}$/,
  /^[a-z]{1,2}\s*$/i,
];

function looksGibberish(ans) {
  const a = String(ans || "").trim();
  if (GIBBERISH_PATTERNS.some((r) => r.test(a))) return true;
  if (/^(true|false)$/i.test(a)) return false;
  if (/^[\d\s.+\-*/%()=<>!]+$/.test(a)) return false;
  return a.length < 2;
}

function detectLangFromCode(src = "") {
  const s = String(src).trim();
  if (!s) return null;
  if (
    /\b#include\s*<[^>]+>/.test(s) ||
    /\bint\s+main\s*\(/.test(s) ||
    /std::(cout|cin|string)/.test(s)
  )
    return "cpp";
  if (/\bdef\s+\w+\s*\(/.test(s) || /\bprint\s*\(/.test(s) || /^\s*#/.test(s))
    return "python";
  return null;
}

// ---------- Guidance → policy ----------
function derivePolicyFromGuidance(guidanceText = "") {
  const g = stripHtml(guidanceText).toLowerCase().trim();

  if (/^(none|no\s*follow-?ups?|no\s*follow\s*ups?)$/.test(g)) {
    return {
      followupGate: "none",
      requirementsOnly: false,
      ignoreSpacing: false,
      forbidFStrings: false,
      failOpen: false,
      noExtras: false,
    };
  }

  const explicitFU =
    (g.match(/follow[-\s]*ups?\s*:\s*(none|gibberish-only|default)/i) || [])[1] ||
    null;

  const noFollowupFlag = /do not ask a follow up/.test(g);
  const requirementsOnly = /requirements-only/.test(g);
  const ignoreSpacing = /ignore spacing/.test(g);
  const forbidFStrings = /f-strings.*(unavailable|do not|don't)/.test(g);
  const failOpen =
    /fail[- ]open/.test(g) || /doesn'?t have to be perfect/.test(g);
  const noExtras = /do not require extra features|do not require extras/.test(g);

  const followupGate = explicitFU
    ? explicitFU.toLowerCase()
    : noFollowupFlag
      ? "none"
      : "default";

  return {
    followupGate,
    requirementsOnly,
    ignoreSpacing,
    forbidFStrings,
    failOpen,
    noExtras,
  };
}

function getEffectivePolicy(activityGuide, questionGuide) {
  const a = derivePolicyFromGuidance(activityGuide);
  const q = derivePolicyFromGuidance(questionGuide);

  // If question guide is literally "none", interpret as "no followups"
  const qBareNone = /^\s*(none|no\s*follow-?ups?|no\s*follow\s*ups?)\s*$/i.test(
    stripHtml(questionGuide || "")
  );

  const qFU =
    (String(questionGuide || "").match(
      /follow[-\s]*ups?\s*:\s*(none|gibberish-only|default)/i
    ) || [])[1] || null;

  const aFU =
    (String(activityGuide || "").match(
      /follow[-\s]*ups?\s*:\s*(none|gibberish-only|default)/i
    ) || [])[1] || null;

  const followupGate = qBareNone
    ? "none"
    : (qFU || aFU || q.followupGate || a.followupGate || "default").toLowerCase();

  const pick = (flag, regex) => {
    const qMentions = new RegExp(regex, "i").test(String(questionGuide || ""));
    return qMentions ? q[flag] : a[flag];
  };

  return {
    followupGate,
    requirementsOnly: pick("requirementsOnly", "requirements-only"),
    ignoreSpacing: pick("ignoreSpacing", "ignore spacing"),
    forbidFStrings: pick("forbidFStrings", "f-strings"),
    failOpen: pick("failOpen", "fail[- ]open|doesn'?t have to be perfect"),
    noExtras: pick(
      "noExtras",
      "do not require extra features|do not require extras"
    ),
  };
}

// ---------- STUDENT RESPONSE (TEXT, LEARNING MODE) ----------
async function evaluateStudentResponse(req, res) {
  const t0 = Date.now();
  const qidHint =
    req.body?.qid ||
    req.body?.questionId ||
    (req.body?.questionText
      ? stripHtml(req.body.questionText).slice(0, 30)
      : "(no qid)");

  console.log("AI eval START", { qidHint });

  res.on("finish", () => {
    console.log("AI eval FINISH", {
      qidHint,
      status: res.statusCode,
      ms: Date.now() - t0,
    });
  });

  const {
    questionText,
    studentAnswer,
    sampleResponse = "",
    feedbackPrompt = "",
    followupPrompt = "",
    forceFollowup = false,
    guidance = "",
    codeContext = "",
    instanceId,
    groupNum,
    answeredByUserId,
    retriesRequired,
    submissionString = "",
  } = req.body || {};

  let accepted = false;
  let feedback =
    "I couldn't interpret that response—please add one concrete sentence answering the question.";

  const applyGateAndSend = async () => {
    console.log("[RETRY_IN]", {
      instanceId,
      groupNum,
      answeredByUserId,
      retriesRequired,
      accepted,
      submissionHash: sha256Hex(String(submissionString ?? "")),
    });

    const gate = await applyGroupRetryGate({
      instanceId: Number(instanceId),
      groupNum: Number(groupNum),
      answeredByUserId: Number(answeredByUserId),
      retriesRequired: Number(retriesRequired),
      accepted,
      submissionString: String(submissionString ?? ""),
    });

    return sendAI(res, { accepted, feedback, ...gate });
  };

  if (!questionText || studentAnswer == null) {
    return await applyGateAndSend();
  }

  const activityGuide = stripHtml(guidance || "");
  const questionGuide = stripHtml(feedbackPrompt || "");
  const policy = getEffectivePolicy(activityGuide, questionGuide);

  const answerRaw = String(studentAnswer || "").trim();

  const followupQ =
    extractFollowupFromFeedbackPrompt(feedbackPrompt) ||
    "Please answer using one concrete detail from the code or output.";

  const positiveEnabled = isPositiveFeedbackEnabled(guidance, followupPrompt);
  const fuParsed = parsePositiveFeedbackFromText(followupPrompt);
  const followupRaw = fuParsed.cleaned;
  const followupIsNone = /^(none|no\s*follow-?ups?)$/i.test(followupRaw);

  if (policy.requirementsOnly) {
    if (!answerRaw || looksGibberish(answerRaw)) {
      accepted = false;
      feedback = followupQ;
      return await applyGateAndSend();
    }

    const q = stripHtml(questionText || "").toLowerCase();
    const s = stripHtml(answerRaw).toLowerCase();
    const sample = stripHtml(sampleResponse || "").toLowerCase();

    const words = (t) => t.split(/\W+/).filter((w) => w.length >= 5);
    const qWords = words(q);
    const sampleWords = words(sample);
    const overlaps = (arr) => arr.some((w) => s.includes(w));

    // Only reject truly bad answers
    if (!answerRaw || looksGibberish(answerRaw)) {
      accepted = false;
      feedback = followupQ;
      return await applyGateAndSend();
    }

    // Otherwise accept — do NOT enforce keyword overlap
    accepted = true;
    feedback = null;
    return await applyGateAndSend();

    accepted = true;
    feedback = null;
    return await applyGateAndSend();
  }

  const obviouslyBad = !answerRaw || looksGibberish(answerRaw);

  const sys = [
    "You are a concise, supportive learning facilitator for an ungraded collaborative activity.",
    "Decide whether the submission is sufficient to proceed.",
    "Return ONLY JSON matching the schema exactly.",
    "If the submission is on-topic and sufficient, set accepted=true.",
    "If the submission is off-topic, incoherent, or too thin/vague, set accepted=false.",
    "If accepted=false, feedback MUST be a short actionable hint (1–2 sentences).",
    "If accepted=true, feedback must be null unless positive feedback is enabled.",
    "Do NOT mention grading, points, rubrics, or scoring.",
  ].join("\n");

  const schema = `Return JSON only:
{"accepted":true|false,
 "feedback": null|string}`;

  const user = [
    `Question:\n${stripHtml(questionText)}`,
    codeContext ? `Shown code/context:\n${stripHtml(codeContext)}` : "",
    sampleResponse
      ? `Sample / acceptance envelope (do not quote):\n${stripHtml(sampleResponse)}`
      : "",
    questionGuide
      ? `Instructor feedbackprompt (meta; do not quote):\n${questionGuide}`
      : "",
    followupRaw && !followupIsNone
      ? `Instructor followupprompt (optional; prefer this wording if you choose to ask a follow-up):\n${followupRaw}`
      : "",
    `Student submission:\n${stripHtml(studentAnswer)}`,
    "",
    schema,
    forceFollowup || obviouslyBad
      ? 'If uncertain, prefer {"accepted":false}'
      : 'If reasonable, prefer {"accepted":true}',
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 220,
    });

    const raw = (chat.choices?.[0]?.message?.content ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);

    let obj;
    try {
      obj = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    } catch {
      accepted = false;
      feedback =
        "I couldn't interpret that response. Please answer the question with one concrete detail tied to the code or output.";
      return await applyGateAndSend();
    }

    const norm = normalizeAIResult(obj);
    accepted = norm.accepted;
    feedback = norm.feedback;

    if (isSoftNitpick(feedback) && !isFatal(feedback)) {
      feedback = null;
    }

    if (!accepted && !feedback) {
      feedback =
        "Add one more concrete detail that directly answers the prompt.";
    }

    if (accepted && !positiveEnabled) {
      feedback = null;
    }

    if (accepted && positiveEnabled && !feedback && followupRaw && !followupIsNone) {
      feedback = followupRaw;
    }

    if (isNone(feedbackPrompt)) {
      feedback = null;
    }

    return await applyGateAndSend();
  } catch (err) {
    console.error("❌ OpenAI evaluateStudentResponse failed:", err);

    accepted = false;
    feedback =
      "I couldn't interpret that response. Please answer the question with one concrete detail tied to the code or output.";
    return await applyGateAndSend();
  }
}// <-- closes evaluateStudentResponse

// ---------- PYTHON CODE (LEARNING MODE) ----------
async function evaluatePythonCode(req, res) {
  console.log("[AI_FINGERPRINT] evaluatePythonCode HIT", {
    t: Date.now(),
    AI_DEBUG: process.env.AI_DEBUG,
    bodyKeys: Object.keys(req.body || {}),
  });
  const {
    questionText,
    studentCode,
    codeVersion,
    guidance = "",
    isCodeOnly = false,
    feedbackPrompt = "",
    sampleResponse = "",
    followupPrompt = "",
    outputText = "",
  } = req.body || {};

  if (!questionText || !studentCode) {
    return res.status(400).json({ error: "Missing question text or student code" });
  }
  if (process.env.AI_DEBUG === "1") {
    console.log("[AI_DEBUG] evaluate-code body keys:", Object.keys(req.body || {}));
    console.log("[AI_DEBUG] isCodeOnly:", req.body?.isCodeOnly, "codeVersion:", req.body?.codeVersion);
    console.log("[AI_DEBUG] questionText (first 120):", String(req.body?.questionText || "").slice(0, 120));
    console.log("[AI_DEBUG] sampleResponse len:", String(req.body?.sampleResponse || "").length);
    console.log("[AI_DEBUG] feedbackPrompt (first 120):", String(req.body?.feedbackPrompt || "").slice(0, 120));
    console.log("[AI_DEBUG] followupPrompt (first 120):", String(req.body?.followupPrompt || "").slice(0, 120));
    console.log("[AI_DEBUG] studentCode (first 200):\n" + String(req.body?.studentCode || "").slice(0, 200));
  }
  const result = await evaluateCode({
    questionText,
    studentCode,
    codeVersion,
    guidance,
    isCodeOnly,
    feedbackPrompt,
    sampleResponse,
    followupPrompt,
    lang: "python",
    outputText,
  });

  const { instanceId, groupNum, answeredByUserId, retriesRequired } = req.body || {};
  const gate = await applyGroupRetryGate({
    instanceId: Number(instanceId),
    groupNum: Number(groupNum),
    answeredByUserId: Number(answeredByUserId),
    retriesRequired: Number(retriesRequired),
    accepted: result.accepted === true,
    submissionString: req.body?.submissionString ?? "",
  });

  return sendAI(res, { ...result, ...gate });
}


function extractFirstJsonObject(text = "") {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }

    if (ch === '"') {
      inStr = true;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }

  return null; // no balanced object found
}

function safeJsonObject(raw = "") {
  const candidate = extractFirstJsonObject(raw);
  if (!candidate) return null;
  try {
    const obj = JSON.parse(candidate);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

// ---------- JSON-only LLM helper (STRICT) ----------
function enforceOnlyKeys(obj, allowedKeys) {
  if (!obj || typeof obj !== "object") throw new Error("LLM returned non-object JSON");
  const keys = Object.keys(obj);
  const extra = keys.filter((k) => !allowedKeys.includes(k));
  if (extra.length) throw new Error(`LLM returned extra keys: ${extra.join(", ")}`);
  for (const k of allowedKeys) {
    if (!(k in obj)) throw new Error(`LLM missing required key: ${k}`);
  }
  return obj;
}

/**
 * Call OpenAI and parse JSON STRICTLY.
 * - messages: [{role, content}, ...]
 * - allowedKeys: enforce exact key set (no extras, no missing)
 * Throws on any contract violation.
 */
async function callLLMJsonStrict({
  messages,
  allowedKeys,
  temperature = 0.2,
  max_tokens = 800,
}) {
  async function doCall(extraMsg) {
    const msgs = extraMsg ? [...messages, extraMsg] : messages;

    return await openai.chat.completions.create({
      model: MODEL,
      messages: msgs,
      temperature,
      max_tokens,
      response_format: { type: "json_object" }, // ✅ force JSON output
    });
  }

  // Try #1
  let chat = await doCall(null);
  let raw = (chat.choices?.[0]?.message?.content ?? "").trim();

  if (AI_DEBUG) logModelRaw("[callLLMJsonStrict#1]", raw);

  let obj = safeJsonObject(raw);

  // Retry once if parse fails anyway
  if (!obj) {
    chat = await doCall({
      role: "user",
      content:
        'Your previous reply was not valid JSON. Reply again with ONLY a JSON object. No markdown, no commentary.',
    });

    raw = (chat.choices?.[0]?.message?.content ?? "").trim();
    if (AI_DEBUG) logModelRaw("[callLLMJsonStrict#2]", raw);

    obj = safeJsonObject(raw);
  }

  if (!obj) throw new Error("LLM returned non-JSON (or JSON parse failed).");

  if (Array.isArray(allowedKeys) && allowedKeys.length) {
    enforceOnlyKeys(obj, allowedKeys);
  }

  return obj;
}

async function evaluateCode({
  questionText,
  studentCode,
  codeVersion,
  guidance = "",
  isCodeOnly = false,
  feedbackPrompt = "",
  sampleResponse = "",
  followupPrompt = "",
  lang,
  outputText = "",
}) {
  // Default: fail-open (don’t block if AI fails)
  const base = { accepted: true, feedback: null };

  if (!questionText || !studentCode) return base;

  const suppressFeedback = isNone(feedbackPrompt);

  const combined = stripHtml(guidance || "");
  const parts = combined.split(/\n-{3,}\n/);
  const qGuide = stripHtml(feedbackPrompt || "");
  const aGuide = parts[1] || parts[0] || combined;
  const policy = getEffectivePolicy(aGuide, qGuide);

  const inferred = detectLangFromCode(studentCode);
  const effLang = String(lang || inferred || "").toLowerCase();
  if (process.env.AI_DEBUG === "1") {
    console.log("[AI_DEBUG] effLang:", effLang, "inferred:", inferred, "lang arg:", lang);
  }
  let langLabel = "the correct language for this code";
  if (effLang === "cpp" || effLang === "c++") langLabel = "C++";
  else if (effLang === "python") langLabel = "Python";

  const positiveEnabled = isPositiveFeedbackEnabled(guidance, followupPrompt);
  const fuParsed = parsePositiveFeedbackFromText(followupPrompt);
  const followupRaw = fuParsed.cleaned;
  const followupIsNone = /^(none|no\s*follow-?ups?)$/i.test(followupRaw);

  const rules = [
    policy.requirementsOnly && "- Judge ONLY whether it meets the stated task; no extras.",
    policy.ignoreSpacing && "- Ignore whitespace/formatting; never mention spacing.",
    policy.forbidFStrings && "- Do NOT suggest or use f-strings (environment may not support them).",
    policy.noExtras && "- Do NOT ask for additional features beyond the prompt.",
    policy.failOpen && "- If minor issues but functionally OK, treat as acceptable.",
    "feedbackprompt is meta guidance; do NOT quote it.",
    "Before suggesting to add a line, verify it is not already present (or equivalent) in the code.",
  ].filter(Boolean).join("\n");

  const fence =
    effLang === "cpp" || effLang === "c++" ? "cpp" :
      effLang === "python" ? "python" : "";

  const prompt = `
You are a ${langLabel} tutor facilitating an UNGRADED collaborative learning activity.

Decide whether the student's code correctly satisfies the task.

The sample response is ONLY an example.
Do NOT require the student to match the sample's exact method, syntax, indices, structure, variable names, or style.
If multiple correct implementations exist, accept ANY correct one.
Do NOT invent extra requirements that are not explicitly stated in the task or instructor guidance.

Most important rule:
If the observed output or behavior is consistent with the task, strongly prefer accepted=true unless the code clearly violates an explicit requirement.

Task:
${stripHtml(questionText)}

Instructor acceptance guidance (highest priority, do not quote verbatim):
${qGuide || "(none)"}

Sample response (example only, not required):
${stripHtml(sampleResponse || "(none)")}

${outputText ? `Observed program output:
${stripHtml(outputText)}` : "Observed program output:\n(none provided)"}

Student's code (v${codeVersion}):
\`\`\`${fence}
${studentCode}
\`\`\`

Return STRICT JSON with exactly these keys:
{"accepted":true|false,"feedback":string|null}

Rules:
- accepted=true if the code correctly satisfies the task, even if it uses a different approach than the sample.
- accepted=false only if the code is incorrect, incomplete, off-task, or clearly fails an explicit requirement.
- Do NOT reject a correct solution just because it uses positive indices instead of negative indices, or vice versa, unless the task explicitly requires one style.
- When output is provided and it matches the requested result, strongly prefer accepted=true.
- feedback must be null or brief encouragement when accepted.
- if rejected, feedback must be ONE short actionable hint.
- No style/naming/formatting nits. No extra features beyond the prompt.
${rules ? "\n" + rules : ""}
`.trim();

  if (process.env.AI_DEBUG === "1") {
    console.log("[AI_DEBUG] PROMPT (first 800):\n" + prompt.slice(0, 800));
    console.log("[AI_DEBUG] PROMPT len:", prompt.length);
  }

  let chat;
  try {
    chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a careful code-evaluation assistant. Accept any correct solution that satisfies the task. Do not overfit to the sample response.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 220,
    });
  } catch (err) {
    console.error("❌ OpenAI evaluateCode failed:", err);
    return base;
  }

  // ✅ define raw BEFORE any logging that references it
  const raw = (chat.choices?.[0]?.message?.content ?? "").trim();

  if (process.env.AI_DEBUG === "1") {
    console.log("[AI_DEBUG] OpenAI raw (first 400):", raw.slice(0, 400));
  }

  const obj = safeJsonObject(raw);
  if (!obj) return base;


  // modelAccepted is the model’s real gate
  const norm = normalizeAIResult(obj);
  let { accepted } = norm;
  let feedback = norm.feedback;

  // strip soft nitpicks, etc (keep your existing filters)
  if (isSoftNitpick(feedback) && !isFatal(feedback)) feedback = null;

  // If NOT accepted, we require a feedback (a real actionable hint)
  if (!accepted && !feedback) {
    feedback = "Make one small change that directly moves the code toward the stated task.";
  }

  // If accepted and positive feedback disabled, feedback must be null
  if (accepted && !positiveEnabled) feedback = null;

  // If suppressFeedback, always null (but still allowed to reject!)
  if (suppressFeedback) feedback = null;

  return { accepted, feedback };
}



async function evaluateCppCode(req, res) {
  const {
    questionText,
    studentCode,
    codeVersion,
    guidance = "",
    isCodeOnly = false,
    feedbackPrompt = "",
    sampleResponse = "",
    followupPrompt = "",
    outputText = "",
  } = req.body || {};

  if (!questionText || !studentCode) {
    return res.status(400).json({ error: "Missing question text or student code" });
  }

  const result = await evaluateCode({
    questionText,
    studentCode,
    codeVersion,
    guidance,
    isCodeOnly,
    feedbackPrompt,
    sampleResponse,
    followupPrompt,
    lang: "cpp",
    outputText,
  });

  const { instanceId, groupNum, answeredByUserId, retriesRequired } = req.body || {};
  const groupSubmissionString = req.body?.groupSubmissionString ?? null;
  const gate = await applyGroupRetryGate({
    instanceId: Number(instanceId),
    groupNum: Number(groupNum),
    answeredByUserId: Number(answeredByUserId),
    retriesRequired: Number(retriesRequired),
    accepted: result.accepted === true,
    submissionString: groupSubmissionString ?? studentCode,
  });

  return sendAI(res, { ...result, ...gate });
}


// NOTE: plug your existing gradeTestQuestion + gradeTestQuestionHttp here unchanged
// (omitted in this snippet to keep it readable)

module.exports = {
  evaluateStudentResponse,
  evaluatePythonCode,
  evaluateCode,
  evaluateCppCode,
  gradeTestQuestion,
  gradeTestQuestionHttp,
  callLLMJsonStrict,
};
