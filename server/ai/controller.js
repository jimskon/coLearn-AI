// server/ai/controller.js
const OpenAI = require("openai");
require("dotenv").config();

const { randomUUID } = require('crypto');
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

function normalizeHistoryQid(qidRaw) {
  const qid = String(qidRaw || '').trim();
  if (!qid) return null;

  if (/^attempt:\d+$/i.test(qid)) return null;
  if (/^\d+state$/i.test(qid)) return null;
  if (/^R(?:cnt|max|hash):\d+$/i.test(qid)) return null;
  if (/^test(?:Total|Max|Summary)Score$/i.test(qid)) return null;

  const suffixPatterns = [
    /^(?<base>\d+[A-Za-z]+)F\d+$/i,
    /^(?<base>\d+[A-Za-z]+)FA\d+$/i,
    /^(?<base>\d+[A-Za-z]+)FM$/i,
    /^(?<base>\d+[A-Za-z]+)AF$/i,
    /^(?<base>\d+[A-Za-z]+)S$/i,
    /^(?<base>\d+[A-Za-z]+)CodeFeedback$/i,
    /^(?<base>\d+[A-Za-z]+)RunFeedback$/i,
    /^(?<base>\d+[A-Za-z]+)ResponseFeedback$/i,
    /^(?<base>\d+[A-Za-z]+)CodeScore$/i,
    /^(?<base>\d+[A-Za-z]+)RunScore$/i,
    /^(?<base>\d+[A-Za-z]+)ResponseScore$/i,
    /^(?<base>\d+[A-Za-z]+)CodeAccepted$/i,
    /^(?<base>\d+[A-Za-z]+)CodeCanContinue$/i,
    /^(?<base>\d+[A-Za-z]+)CodeRetryCount$/i,
    /^(?<base>\d+[A-Za-z]+)CodeRetriesRequired$/i,
    /^(?<base>\d+[A-Za-z]+)CodeSubmissionString$/i,
    /^(?<base>\d+[A-Za-z]+)(?:Output|output\d*|code\d+|table\d+cell\d+_\d+)$/i,
  ];

  for (const pattern of suffixPatterns) {
    const match = qid.match(pattern);
    if (match?.groups?.base) return match.groups.base;
  }

  if (/^\d+[A-Za-z]+$/i.test(qid)) return qid;

  return null;
}

function isHiddenHistoryKey(questionIdRaw) {
  const qid = String(questionIdRaw || '').trim();
  if (!qid) return true;

  if (/^R(?:cnt|max|hash):\d+$/i.test(qid)) return true;
  if (/^attempt:\d+$/i.test(qid)) return true;
  if (/^\d+state$/i.test(qid)) return true;
  if (/^\d+[A-Za-z]+AF$/i.test(qid)) return true;
  if (/^\d+[A-Za-z]+FM$/i.test(qid)) return true;
  if (/^\d+[A-Za-z]+S$/i.test(qid)) return true;

  if (/Score$/i.test(qid)) return true;
  if (/Accepted$/i.test(qid)) return true;
  if (/CanContinue$/i.test(qid)) return true;
  if (/RetryCount$/i.test(qid)) return true;
  if (/RetriesRequired$/i.test(qid)) return true;
  if (/SubmissionString$/i.test(qid)) return true;

  return false;
}

function classifyHistoryRow(questionIdRaw) {
  const qid = String(questionIdRaw || '').trim();
  if (!qid || isHiddenHistoryKey(qid)) return null;

  if (/^\d+[A-Za-z]+CodeFeedback$/i.test(qid)) return 'feedback';
  if (/^\d+[A-Za-z]+RunFeedback$/i.test(qid)) return 'feedback';
  if (/^\d+[A-Za-z]+ResponseFeedback$/i.test(qid)) return 'feedback';
  if (/^\d+[A-Za-z]+F\d+$/i.test(qid)) return 'feedback';
  if (/^\d+[A-Za-z]+FA\d+$/i.test(qid)) return 'feedback';
  if (/^\d+[A-Za-z]+FM$/i.test(qid)) return 'feedback';

  if (/^\d+[A-Za-z]+output\d*$/i.test(qid) || /^\d+[A-Za-z]+Output$/i.test(qid)) {
    return 'output';
  }

  if (/^\d+[A-Za-z]+code\d+$/i.test(qid)) return 'code';

  if (/^\d+[A-Za-z]+$/i.test(qid)) return 'answer';

  return null;
}

function clipHistoryText(value, limit = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function clipHistoryCode(value, limit = 180) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

async function buildAttemptHistoryContext({
  instanceId,
  qid,
  limit = 5,
}) {
  const baseQid = normalizeHistoryQid(qid);
  const numericInstanceId = Number(instanceId);

  if (!Number.isFinite(numericInstanceId) || numericInstanceId <= 0 || !baseQid) {
    return '';
  }

  try {
    const [rows] = await db.query(
      `SELECT
         id,
         submit_id,
         question_id,
         response_type,
         response,
         answered_by_user_id,
         submitted_at,
         updated_at
       FROM responses
       WHERE activity_instance_id = ?
       ORDER BY id ASC`,
      [numericInstanceId]
    );

    const groups = new Map();
    const order = [];

    for (const row of rows || []) {
      const rowBase = normalizeHistoryQid(row.question_id);
      if (rowBase !== baseQid) continue;

      const kind = classifyHistoryRow(row.question_id);
      if (!kind) continue;

      const rawValue = String(row.response ?? '').trim();
      if (!rawValue) continue;

      const submitId = row.submit_id || `row-${row.id}`;
      if (!groups.has(submitId)) {
        groups.set(submitId, {
          submitId,
          firstRowId: Number(row.id) || 0,
          rows: [],
        });
        order.push(submitId);
      }

      groups.get(submitId).rows.push({
        ...row,
        kind,
        value: rawValue,
      });
    }

    const attempts = [];
    let lastSignature = '';
    let attemptNumber = 0;

    for (const submitId of order) {
      const group = groups.get(submitId);
      if (!group?.rows?.length) continue;

      const sortedRows = [...group.rows].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
      const answerParts = [];
      const codeParts = [];
      const outputParts = [];
      const feedbackParts = [];

      for (const row of sortedRows) {
        if (row.kind === 'answer') {
          answerParts.push(clipHistoryText(row.value, 220));
          continue;
        }

        if (row.kind === 'code') {
          codeParts.push(clipHistoryCode(row.value, 220));
          continue;
        }

        if (row.kind === 'output') {
          outputParts.push(clipHistoryText(row.value, 220));
          continue;
        }

        if (row.kind === 'feedback') {
          feedbackParts.push(clipHistoryText(row.value, 220));
        }
      }

      const signature = [
        answerParts.join(' / '),
        codeParts.join(' / '),
        outputParts.join(' / '),
        feedbackParts.join(' / '),
      ].join(' || ').trim().toLowerCase();
      if (!signature) continue;
      if (signature === lastSignature) continue;
      lastSignature = signature;

      attemptNumber += 1;
      attempts.push({
        attemptNumber,
        answerParts,
        codeParts,
        outputParts,
        feedbackParts,
      });
    }

    if (!attempts.length) return '';

    const visibleAttempts = attempts.slice(-Math.max(1, limit));
    const lines = [
      'Prior group attempts for this question (oldest first; same collaborative group instance):',
    ];

    for (const attempt of visibleAttempts) {
      lines.push(`Attempt ${attempt.attemptNumber}:`);
      if (attempt.answerParts.length) {
        lines.push(`Group answer: ${attempt.answerParts.join(' / ')}`);
      }
      if (attempt.codeParts.length) {
        lines.push(`Group code: ${attempt.codeParts.map((value, idx) => `[${idx + 1}] ${value}`).join(' | ')}`);
      }
      if (attempt.outputParts.length) {
        lines.push(`Program output: ${attempt.outputParts.join(' / ')}`);
      }
      if (attempt.feedbackParts.length) {
        lines.push(`AI feedback already given: ${attempt.feedbackParts.join(' / ')}`);
      }
    }

    lines.push(`Current group attempt number: ${attempts.length + 1}`);
    lines.push('Group scaffolding guidance:');
    lines.push('- Treat this as one collaborative group conversation; the active typer may change.');
    lines.push('- Compare the current group submission with prior group attempts.');
    lines.push('- If the group improved, acknowledge the progress briefly before the next nudge.');
    lines.push('- Do not repeat prior AI feedback wording.');
    lines.push('- Do not raise the bar beyond the question, sample, or instructor guidance.');
    lines.push('- If the question gives a range such as 2-4 items, the lower bound satisfies the quantity requirement.');
    lines.push('- Attempt 1: give a gentle conceptual hint.');
    lines.push('- Attempt 2: point to the missing idea or relevant evidence.');
    lines.push('- Attempt 3: give a more directed hint or sentence starter that names exactly what is missing.');
    lines.push('- Attempt 4 or later: if the current answer is close enough, accept it; otherwise give a direct sentence-level path forward.');

    return lines.join('\n');
  } catch (err) {
    if (AI_DEBUG) {
      console.warn('[AI_DEBUG] buildAttemptHistoryContext failed:', err?.message || err);
    }
    return '';
  }
}

async function buildStudentResponsePrompt({
  questionText,
  studentAnswer,
  codeContext = "",
  sampleResponse = "",
  feedbackPrompt = "",
  followupPrompt = "",
  guidance = "",
  instanceId,
  qid,
  historyLimit = 5,
}) {
  const activityGuide = stripHtml(guidance || "");
  const questionGuide = stripHtml(feedbackPrompt || "");
  const historyContext = await buildAttemptHistoryContext({
    instanceId,
    qid: qid || "",
    limit: historyLimit,
  });

  const followupQ =
    extractFollowupFromFeedbackPrompt(feedbackPrompt) ||
    "Please answer using one concrete detail from the code or output.";

  const positiveEnabled = isPositiveFeedbackEnabled(guidance, followupPrompt);
  const fuParsed = parsePositiveFeedbackFromText(followupPrompt);
  const followupRaw = fuParsed.cleaned;
  const followupIsNone = /^(none|no\s*follow-?ups?)$/i.test(followupRaw);

  const sys = [
    "You are a concise, supportive learning facilitator for an ungraded collaborative activity.",
    "The submission represents a collaborative group's shared answer, even though one person may be typing.",
    "Decide whether the group's current submission is sufficient to proceed.",
    "Return ONLY JSON matching the schema exactly.",
    "If the submission is on-topic and sufficient, set accepted=true.",
    "If the submission is off-topic, incoherent, or too thin/vague, set accepted=false.",
    "If accepted=false, feedback MUST be a short actionable hint (1–2 sentences).",
    "If accepted=true, feedback must be null unless positive feedback is enabled.",
    "Do not require more examples, items, evidence, or precision than the question actually asks for.",
    "If a question asks for a range, the minimum of that range is enough for quantity; judge whether those items are plausible and explained.",
    "If the group has the core answer plus reasonable reasoning, accept it rather than asking for more detail.",
    "As attempts increase, weaken the requirements: prefer a good-enough answer that shows understanding over a perfectly complete one.",
    "For repeated attempts, avoid generic advice like 'be more specific' unless you name the exact missing idea.",
    "On later attempts, prefer accepting a mostly sufficient answer over keeping the group stuck on minor improvements.",
    "Write feedback in the same language as the activity/question text.",
    "Do not mirror the student's answer language if it differs from the activity language.",
    "If prior group attempts are provided, use them to understand the group's learning thread, avoid repeating earlier feedback, and choose the right scaffolding level.",
    "Address the group naturally as 'you'; do not single out the active typer or mention which person typed.",
    "If instructor guidance is requirements-only, reject answers that are grammatically coherent but unrelated to the actual code, output, or requested behavior.",
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
    historyContext,
    `Current group submission:\n${stripHtml(studentAnswer)}`,
    "Feedback language rule: use the activity/question language for the feedback, not the student's answer language if they differ.",
    "Scaffolding rule: compare the current group submission to the prior group attempts if provided; acknowledge progress only briefly, then focus on the next missing idea.",
    "Acceptance rule: do not ask for the maximum number of examples/items when the question gives a range; the lower bound is enough if the answer quality is reasonable.",
    "Acceptance rule: if the group has the core answer plus reasonable reasoning, accept it instead of asking for more detail.",
    "Acceptance rule: as attempts increase, weaken the requirements and let a good-enough answer move on.",
    "Acceptance rule: when the answer is mostly correct and shows reasoning, loosen requirements and let the group move on instead of demanding extra detail.",
    "Stuck-prevention rule: if this is a later attempt and the group is close, accept; if not close, tell them exactly what to add in language they can act on immediately.",
    "",
    schema,
    "If reasonable, prefer {\"accepted\":true}",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    sys,
    user,
    historyContext,
    followupRaw,
    followupIsNone,
    positiveEnabled,
    questionGuide,
    activityGuide,
    followupQ,
  };
}

function extractStudentQuestion(answerText = "") {
  const text = stripHtml(answerText)
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  const sentences = text
    .split(/(?<=[?.!])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const interrogativeStart = /^(what|why|how|when|where|which|who|whom|whose|can|could|would|should|do|does|did|is|are|am|will|may|might)\b/i;

  for (const sentence of sentences) {
    if (interrogativeStart.test(sentence) && sentence.includes("?")) {
      return sentence.replace(/[?.!]+$/g, "").trim();
    }
  }

  for (const sentence of sentences) {
    if (sentence.includes("?") || interrogativeStart.test(sentence)) {
      return sentence.replace(/[?.!]+$/g, "").trim();
    }
  }

  return null;
}

async function buildStudentQuestionHelpPrompt({
  questionText,
  studentAnswer,
  codeContext = "",
  sampleResponse = "",
  feedbackPrompt = "",
  guidance = "",
  questionAsked = "",
}) {
  const activityGuide = stripHtml(guidance || "");
  const questionGuide = stripHtml(feedbackPrompt || "");

  const sys = [
    "You are a concise learning helper for a collaborative activity.",
    "The student's submission may include both an attempted answer and a clarifying question.",
    "Use the activity question, any shown code, the sample response, and the student's current answer as context.",
    "Answer only the clarifying question; do not solve the whole program or give a full worked solution.",
    "If the question is outside the activity's learning objectives, set inDomain=false and use exactly this feedback text: This system only works in the context of its learning objectives.",
    "If the question is on-topic, set inDomain=true and give a short supportive answer or hint in 1-3 sentences.",
    "Keep the reply helpful and bounded to the activity.",
    "Do not mention grading, points, rubrics, or scoring.",
  ].join("\n");

  const user = [
    `Activity question:\n${stripHtml(questionText)}`,
    codeContext ? `Shown code/context:\n${stripHtml(codeContext)}` : "",
    sampleResponse
      ? `Sample / acceptance envelope (do not quote):\n${stripHtml(sampleResponse)}`
      : "",
    questionGuide
      ? `Instructor feedbackprompt (meta; do not quote):\n${questionGuide}`
      : "",
    activityGuide
      ? `Activity guidance (meta; do not quote):\n${activityGuide}`
      : "",
    `Student current answer:\n${stripHtml(studentAnswer)}`,
    `Student clarifying question:\n${stripHtml(questionAsked)}`,
    "Return JSON only with keys: inDomain, feedback",
    "If the question is on-topic, feedback should answer the question briefly without giving away the entire solution.",
    "If the question is off-topic for the activity, feedback must be exactly: This system only works in the context of its learning objectives.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    sys,
    user,
    activityGuide,
    questionGuide,
  };
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
  const s = String(value ?? "");

  const [[existing]] = await conn.query(
    `SELECT id
     FROM responses
     WHERE activity_instance_id = ? AND question_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [instanceId, qid]
  );

  if (existing?.id) {
    await conn.query(
      `UPDATE responses
       SET response = ?,
           response_type = 'text',
           answered_by_user_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [s, answeredByUserId, existing.id]
    );
  } else {
    await conn.query(
      `INSERT INTO responses
         (activity_instance_id, question_id, submit_id, response_type, response, answered_by_user_id)
       VALUES (?, ?, ?, 'text', ?, ?)`,
      [instanceId, qid, randomUUID(), s, answeredByUserId]
    );
  }
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

function isDryRunAIRequest(req) {
  const body = req?.body || {};
  return (
    body.dryRun === true ||
    body.persistRetryGate === false ||
    body.persist === false
  );
}

function dryRunRetryGate({ accepted, retriesRequired }) {
  const max = Number(retriesRequired) || 0;

  if (max <= 0) {
    return { canContinue: true, retryCount: 0, retriesRequired: 0 };
  }

  return {
    canContinue: accepted === true,
    retryCount: 0,
    retriesRequired: max,
  };
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
    qid = "",
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
      dryRun: isDryRunAIRequest(req),
    });

    const gate = isDryRunAIRequest(req)
      ? dryRunRetryGate({ accepted, retriesRequired: Number(retriesRequired) })
      : await applyGroupRetryGate({
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
  const questionAsked = extractStudentQuestion(answerRaw);

  if (questionAsked) {
    try {
      const helpPrompt = await buildStudentQuestionHelpPrompt({
        questionText,
        studentAnswer,
        codeContext,
        sampleResponse,
        feedbackPrompt,
        guidance,
        questionAsked,
      });

      const helpChat = await callLLMJsonStrict({
        messages: [
          { role: "system", content: helpPrompt.sys },
          { role: "user", content: helpPrompt.user },
        ],
        allowedKeys: ["inDomain", "feedback"],
        temperature: 0.2,
        max_tokens: 200,
      });

      accepted = false;
      const rawFeedback = String(helpChat.feedback ?? "").trim();
      const inDomain = helpChat.inDomain !== false;
      feedback = inDomain
        ? rawFeedback || "Let's focus on the activity question and the part that's still unclear."
        : "This system only works in the context of its learning objectives.";

      return await applyGateAndSend();
    } catch (err) {
      console.error("❌ OpenAI question-help branch failed:", err);
      accepted = false;
      feedback = "This system only works in the context of its learning objectives.";
      return await applyGateAndSend();
    }
  }

  const promptParts = await buildStudentResponsePrompt({
    questionText,
    studentAnswer,
    codeContext,
    sampleResponse,
    feedbackPrompt,
    followupPrompt,
    guidance,
    instanceId,
    qid: qid || req.body?.questionId || req.body?.codeVersion || "",
    historyLimit: 5,
  });
  const {
    sys,
    user,
    followupRaw,
    followupIsNone,
    positiveEnabled,
    followupQ,
  } = promptParts;

  const historyContext = promptParts.historyContext;

  if (policy.requirementsOnly) {
    if (!answerRaw || looksGibberish(answerRaw)) {
      accepted = false;
      feedback = followupQ;
      return await applyGateAndSend();
    }

    console.log("[REQ_ONLY]", {
      qidHint,
      answerRaw,
      requirementsOnly: true,
      looksGibberish: looksGibberish(answerRaw),
      mode: "use-ai",
    });

    // For requirements-only questions, still let AI judge the meaning.
    // We only short-circuit obvious blank/gibberish answers locally.
  }

  const obviouslyBad = !answerRaw || looksGibberish(answerRaw);

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
    instanceId = null,
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
    instanceId,
    qid: codeVersion,
    guidance,
    isCodeOnly,
    feedbackPrompt,
    sampleResponse,
    followupPrompt,
    lang: "python",
    outputText,
  });

  // ✅ ADD THIS (Step 2 already, but keep it)
  console.log("[EVAL_CODE RESULT]", result);

  // ---- EXISTING LINE ----
  const { groupNum, answeredByUserId, retriesRequired } = req.body || {};

  // ✅ ADD THIS → Step 3 INPUT LOG (RIGHT HERE)
  console.log("[RETRY_GATE INPUT]", {
    instanceId,
    groupNum,
    answeredByUserId,
    retriesRequired,
    acceptedFromEvaluator: result.accepted === true,
    submissionString: String(req.body?.submissionString ?? "").slice(0, 200),
    dryRun: isDryRunAIRequest(req),
  });

  // ---- EXISTING CALL ----
  const gate = isDryRunAIRequest(req)
    ? dryRunRetryGate({
        accepted: result.accepted === true,
        retriesRequired: Number(retriesRequired),
      })
    : await applyGroupRetryGate({
        instanceId: Number(instanceId),
        groupNum: Number(groupNum),
        answeredByUserId: Number(answeredByUserId),
        retriesRequired: Number(retriesRequired),
        accepted: result.accepted === true,
        submissionString: req.body?.submissionString ?? "",
      });

  // ✅ ADD THIS → Step 3 OUTPUT LOG (RIGHT AFTER CALL)
  console.log("[RETRY_GATE RESULT]", gate);

  // ---- FINAL RETURN ----
  const finalPayload = { ...result, ...gate };

  // (optional but VERY useful)
  console.log("[FINAL PAYLOAD]", finalPayload);

  return sendAI(res, finalPayload);
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
  instanceId = null,
  qid = "",
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
  const historyContext = await buildAttemptHistoryContext({
    instanceId,
    qid: qid || codeVersion || "",
    limit: 5,
  });

  const rules = [
    policy.requirementsOnly && "- Judge ONLY whether it meets the stated task; no extras.",
    policy.ignoreSpacing && "- Ignore whitespace/formatting; never mention spacing.",
    policy.forbidFStrings && "- Do NOT suggest or use f-strings (environment may not support them).",
    policy.noExtras && "- Do NOT ask for additional features beyond the prompt.",
    policy.failOpen && "- If minor issues but functionally OK, treat as acceptable.",
    "- Write feedback in the same language as the activity/question language. Do not switch to the student's answer language if it differs.",
    "- If prior group attempts are provided, use them only to calibrate feedback specificity and avoid repeating earlier wording.",
    "- Judge correctness from the current code and current observed output.",
    "- Treat this as one collaborative group conversation; do not single out the active typer.",
    "feedbackprompt is meta guidance; do NOT quote it.",
    "Before suggesting to add a line, verify it is not already present (or equivalent) in the code.",
  ].filter(Boolean).join("\n");

  const fence =
    effLang === "cpp" || effLang === "c++" ? "cpp" :
      effLang === "python" ? "python" : "";

  const prompt = `
You are a ${langLabel} tutor facilitating an UNGRADED collaborative learning activity.

Decide whether the collaborative group's current code correctly satisfies the task.
The active typer may change, but prior attempts belong to the same group conversation.

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

${historyContext ? `${historyContext}\n` : ""}

Current group code (v${codeVersion}):
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
- Use prior group attempts to avoid repeating feedback and to choose the right scaffolding level, but decide accepted=true/false from the current code and output.
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
    instanceId = null,
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

  console.log("[EVAL_CODE INPUT]", {
    questionText: String(questionText || "").slice(0, 300),
    studentCode: String(studentCode || "").slice(0, 300),
    codeVersion,
    guidance: String(guidance || "").slice(0, 200),
    isCodeOnly,
    feedbackPrompt: String(feedbackPrompt || "").slice(0, 200),
    sampleResponse: String(sampleResponse || "").slice(0, 200),
    followupPrompt: String(followupPrompt || "").slice(0, 200),
    outputText: String(outputText || "").slice(0, 200),
  });

  const result = await evaluateCode({
    questionText,
    studentCode,
    codeVersion,
    instanceId,
    qid: codeVersion,
    guidance,
    isCodeOnly,
    feedbackPrompt,
    sampleResponse,
    followupPrompt,
    lang: "cpp",
    outputText,
  });


  const { groupNum, answeredByUserId, retriesRequired } = req.body || {};
  const groupSubmissionString =
    req.body?.groupSubmissionString ?? req.body?.submissionString ?? null;
  const gate = isDryRunAIRequest(req)
    ? dryRunRetryGate({
        accepted: result.accepted === true,
        retriesRequired: Number(retriesRequired),
      })
    : await applyGroupRetryGate({
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
  buildAttemptHistoryContext,
  buildStudentResponsePrompt,
  buildStudentQuestionHelpPrompt,
  extractStudentQuestion,
};
