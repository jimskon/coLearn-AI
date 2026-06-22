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

function getGeoContext(req = {}) {
  const headers = req?.headers || {};
  const country = cleanText(
    headers['x-vercel-ip-country']
      || headers['cf-ipcountry']
      || headers['x-country-code']
      || headers['x-country'],
    64
  );
  const region = cleanText(
    headers['x-vercel-ip-country-region']
      || headers['cf-region-code']
      || headers['cf-region']
      || headers['x-region']
      || headers['x-state'],
    191
  );
  const city = cleanText(
    headers['x-vercel-ip-city']
      || headers['cf-ipcity']
      || headers['x-city'],
    191
  );

  return {
    ipCountry: country,
    ipRegion: region,
    ipCity: city,
  };
}

function getAuditContext(req = {}) {
  const geo = getGeoContext(req);
  return {
    userId: req.user?.id ?? req.session?.userId ?? null,
    role: cleanText(req.user?.role, 32),
    guestToken: cleanText(req.session?.guestToken, 191),
    requestPath: cleanText(req.originalUrl || req.path, 255),
    ipAddress: getClientIp(req),
    userAgent: cleanText(req.headers?.['user-agent'], 1000),
    ...geo,
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
    ipCountry = null,
    ipRegion = null,
    ipCity = null,
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
    ipCountry: ipCountry ?? null,
    ipRegion: ipRegion ?? null,
    ipCity: ipCity ?? null,
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
          activity_instance_id, request_path, ip_address, ip_country, ip_region, ip_city,
          user_agent, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.ipCountry,
        row.ipRegion,
        row.ipCity,
        row.userAgent,
        row.details,
      ]
    );
  } catch (err) {
    console.error('[audit] failed to record event', row.eventType, err?.message || err);
  }
}

module.exports = {
  recordAuditEvent,
  getAuditContext,
};
