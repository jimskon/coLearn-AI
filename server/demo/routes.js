const express = require('express');
const db = require('../db');
const { ensureDemoInfoRequestSchema } = require('../utils/demoInfoRequestSchema');

const router = express.Router();

const ALLOWED_STATUSES = new Set(['new', 'contacted', 'follow_up', 'closed']);
const ADMIN_ROLES = new Set(['root', 'creator', 'instructor']);

function normalizeDemoCode(rawValue) {
  const demoCode = String(rawValue || 'aied2026').trim().toLowerCase();
  return demoCode || 'aied2026';
}

function cleanText(value, maxLength = 255) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanMessage(value) {
  const cleaned = String(value || '').trim();
  return cleaned ? cleaned.slice(0, 5000) : null;
}

function parseFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function normalizeInterests(interests = {}) {
  return {
    beta: parseFlag(interests.beta),
    pilot: parseFlag(interests.pilot),
    research: parseFlag(interests.research),
    instructor_demo: parseFlag(interests.instructor_demo),
    technical: parseFlag(interests.technical),
    materials: parseFlag(interests.materials),
    other: parseFlag(interests.other),
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function requireDemoAdmin(req, res) {
  if (!req.user || !ADMIN_ROLES.has(req.user.role)) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

function getIpAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = forwarded || String(req.ip || '').trim();
  return raw ? raw.slice(0, 64) : null;
}

router.post('/:demoCode/info-request', async (req, res) => {
  const demoCode = normalizeDemoCode(req.params.demoCode);
  const body = req.body || {};
  const email = cleanText(body.email, 255);

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    await ensureDemoInfoRequestSchema();
    const interests = normalizeInterests(body.interests);
    const name = cleanText(body.name, 191);
    const institution = cleanText(body.institution, 255);
    const role = cleanText(body.role, 255);
    const message = cleanMessage(body.message);
    const sourcePath = cleanText(body.sourcePath || req.get('referer') || '', 255);
    const guestToken = cleanText(body.guestToken, 191);
    const userAgent = cleanText(req.get('user-agent'), 1000);
    const ipAddress = getIpAddress(req);

    const [result] = await db.query(
      `INSERT INTO demo_info_requests (
        demo_code,
        name,
        email,
        institution,
        role,
        interest_beta,
        interest_pilot,
        interest_research,
        interest_instructor_demo,
        interest_technical,
        interest_materials,
        interest_other,
        message,
        source_path,
        guest_token,
        user_agent,
        ip_address,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        demoCode,
        name,
        email,
        institution,
        role,
        interests.beta ? 1 : 0,
        interests.pilot ? 1 : 0,
        interests.research ? 1 : 0,
        interests.instructor_demo ? 1 : 0,
        interests.technical ? 1 : 0,
        interests.materials ? 1 : 0,
        interests.other ? 1 : 0,
        message,
        sourcePath,
        guestToken,
        userAgent,
        ipAddress,
        'new',
      ]
    );

    return res.status(201).json({ ok: true, id: Number(result.insertId) });
  } catch (err) {
    console.error('❌ Failed to save demo info request:', err);
    return res.status(500).json({ error: 'Unable to save request' });
  }
});

router.get('/:demoCode/admin/info-requests', async (req, res) => {
  if (!requireDemoAdmin(req, res)) return;

  try {
    await ensureDemoInfoRequestSchema();
    const demoCode = normalizeDemoCode(req.params.demoCode);
    const [rows] = await db.query(
      `SELECT *
         FROM demo_info_requests
        WHERE demo_code = ?
        ORDER BY created_at DESC, id DESC`,
      [demoCode]
    );

    return res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error('❌ Failed to fetch demo info requests:', err);
    return res.status(500).json({ error: 'Unable to fetch requests' });
  }
});

router.patch('/:demoCode/admin/info-requests/:id', async (req, res) => {
  if (!requireDemoAdmin(req, res)) return;

  const demoCode = normalizeDemoCode(req.params.demoCode);
  const requestId = Number(req.params.id);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Invalid request id' });
  }

  const status = cleanText(req.body?.status, 32);
  const notes = cleanMessage(req.body?.notes);
  const hasNotes = Object.prototype.hasOwnProperty.call(req.body || {}, 'notes');
  if (status && !ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (!status && !hasNotes) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  try {
    await ensureDemoInfoRequestSchema();
    const fields = [];
    const params = [];
    if (status) {
      fields.push('status = ?');
      params.push(status);
    }
    if (hasNotes) {
      fields.push('notes = ?');
      params.push(notes);
    }
    params.push(requestId, demoCode);

    const [result] = await db.query(
      `UPDATE demo_info_requests
          SET ${fields.join(', ')}
        WHERE id = ? AND demo_code = ?`,
      params
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const [[row]] = await db.query(
      `SELECT *
         FROM demo_info_requests
        WHERE id = ? AND demo_code = ?`,
      [requestId, demoCode]
    );

    return res.json({ ok: true, request: row || null });
  } catch (err) {
    console.error('❌ Failed to update demo info request:', err);
    return res.status(500).json({ error: 'Unable to update request' });
  }
});

module.exports = router;
