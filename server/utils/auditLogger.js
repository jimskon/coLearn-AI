const db = require('../db');

function cleanText(value, maxLen = 191) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLen) : null;
}

function safeJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (err) {
    return JSON.stringify({ note: 'unserializable audit details' });
  }
}

function getClientIp(req) {
  const forwarded = cleanText(req?.headers?.['x-forwarded-for'], 512);
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first.slice(0, 64);
  }
  return cleanText(req?.ip || req?.connection?.remoteAddress || req?.socket?.remoteAddress, 64);
}

function getAuditContext(req = {}) {
  return {
    userId: req.user?.id ?? req.session?.userId ?? null,
    role: cleanText(req.user?.role, 32),
    guestToken: cleanText(req.session?.guestToken, 191),
    requestPath: cleanText(req.originalUrl || req.path, 255),
    ipAddress: getClientIp(req),
    userAgent: cleanText(req.headers?.['user-agent'], 1000),
  };
}

async function recordAuditEvent(eventType, options = {}) {
  const {
    req,
    userId = null,
    guestToken = null,
    role = null,
    classId = null,
    courseId = null,
    activityId = null,
    activityInstanceId = null,
    requestPath = null,
    ipAddress = null,
    userAgent = null,
    details = null,
  } = options;

  const ctx = req ? getAuditContext(req) : {};
  const row = {
    eventType: cleanText(eventType, 191),
    userId: userId ?? ctx.userId ?? null,
    guestToken: guestToken ?? ctx.guestToken ?? null,
    role: role ?? ctx.role ?? null,
    classId: classId ?? null,
    courseId: courseId ?? null,
    activityId: activityId ?? null,
    activityInstanceId: activityInstanceId ?? null,
    requestPath: requestPath ?? ctx.requestPath ?? null,
    ipAddress: ipAddress ?? ctx.ipAddress ?? null,
    userAgent: userAgent ?? ctx.userAgent ?? null,
    details: safeJson(details),
  };

  if (!row.eventType) {
    return;
  }

  try {
    await db.query(
      `INSERT INTO audit_log
         (event_type, user_id, guest_token, role, class_id, course_id, activity_id,
          activity_instance_id, request_path, ip_address,
          user_agent, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.eventType,
        row.userId,
        row.guestToken,
        row.role,
        row.classId,
        row.courseId,
        row.activityId,
        row.activityInstanceId,
        row.requestPath,
        row.ipAddress,
        row.userAgent,
        row.details,
      ]
    );
  } catch (err) {
    console.error('[audit] failed to record event', row.eventType, err?.message || err);
  }
}

// An AI call stopped because it reached its output-token limit (a setting in
// server/.env). Logged so instructors can see it (View Groups → Summary) and
// raise the setting. Never throws.
class AiTokenLimitError extends Error {
  constructor(setting, limit) {
    super(`The AI ran out of output tokens (${setting} = ${limit}). Raise ${setting} in server/.env and restart the server.`);
    this.code = 'AI_TOKEN_LIMIT';
    this.setting = setting;
    this.limit = limit;
  }
}

function recordAiTokenLimit({ setting, limit, model = null, where = '', req = null, activityInstanceId = null }) {
  console.warn('[ai-token-limit]', { setting, limit, model, where, activityInstanceId });
  const id = Number(activityInstanceId);
  void recordAuditEvent('ai_token_limit', {
    req,
    activityInstanceId: Number.isInteger(id) && id > 0 ? id : null,
    details: { setting, limit, model, where },
  });
}

// Chat Completions and Responses API results that were cut off by the limit.
const chatHitLimit = (chat) => chat?.choices?.[0]?.finish_reason === 'length';
const responseHitLimit = (response) =>
  response?.status === 'incomplete' && response?.incomplete_details?.reason === 'max_output_tokens';

module.exports = {
  AiTokenLimitError,
  recordAiTokenLimit,
  chatHitLimit,
  responseHitLimit,
  recordAuditEvent,
  getAuditContext,
};
