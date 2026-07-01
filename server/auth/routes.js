// server/auth/routes.js
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const pool = require('../db');
const router = express.Router();
const nodemailer = require('nodemailer');
const { ensureDemoModeSchema } = require('../utils/demoModeSchema');
const { recordAuditEvent } = require('../utils/auditLogger');


// ===== Config =====
// Registration-only: skip email + code verification
const DEV_AUTO_VERIFY = String(process.env.AUTH_DEV_AUTO_VERIFY).toLowerCase() === 'true';

// Login-only: skip password verification
const DEV_PASSWORDLESS_LOGIN =
  String(process.env.AUTH_DEV_PASSWORDLESS_LOGIN).toLowerCase() === 'true';

console.log('[auth] DEV_AUTO_VERIFY =', DEV_AUTO_VERIFY);
console.log('[auth] DEV_PASSWORDLESS_LOGIN =', DEV_PASSWORDLESS_LOGIN, 'raw =', process.env.AUTH_DEV_PASSWORDLESS_LOGIN);

const DEMO_ACTIVE_WINDOW_MINUTES = 2;
const DEMO_GROUP_MAX_SIZE = 2;


function parseBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function buildMailTransporter() {
  const authUser = process.env.SMTP_USER || process.env.EMAIL_USER || '';
  const authPass = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST || '';
  const service = process.env.SMTP_SERVICE || process.env.EMAIL_SERVICE || '';
  const portValue = process.env.SMTP_PORT || process.env.EMAIL_PORT || '';
  const secureValue = process.env.SMTP_SECURE ?? process.env.EMAIL_SECURE;
  const fromAddress = process.env.EMAIL_FROM || process.env.SMTP_FROM || authUser || null;

  if (!host && !service && !authUser && !authPass) {
    return { transporter: null, fromAddress };
  }

  if (host) {
    const port = Number(portValue || (parseBool(secureValue) ? 465 : 587));
    const options = {
      host,
      port: Number.isFinite(port) && port > 0 ? port : 587,
      secure: parseBool(secureValue, Number(port) === 465),
    };
    if (authUser || authPass) {
      options.auth = { user: authUser, pass: authPass };
    }
    return { transporter: nodemailer.createTransport(options), fromAddress };
  }

  if (service) {
    const options = { service };
    if (authUser || authPass) {
      options.auth = { user: authUser, pass: authPass };
    }
    return { transporter: nodemailer.createTransport(options), fromAddress };
  }

  // Backward-compatible fallback for older deploys that only set EMAIL_USER/PASS.
  return {
    transporter: nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: authUser,
        pass: authPass,
      },
    }),
    fromAddress,
  };
}

const { transporter, fromAddress: mailFromAddress } = buildMailTransporter();

if (transporter) {
  console.log('[auth] Mail transport configured', {
    host: process.env.SMTP_HOST || process.env.EMAIL_HOST || null,
    service: process.env.SMTP_SERVICE || process.env.EMAIL_SERVICE || (process.env.SMTP_HOST || process.env.EMAIL_HOST ? null : 'gmail'),
  });
} else {
  console.warn('[auth] No mail transport configured; registration and reset flows will fail until SMTP is set up.');
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendAuthCodeEmail({ to, subject, text }) {
  if (!transporter) {
    throw new Error('Mail transport is not configured');
  }

  await transporter.sendMail({
    from: mailFromAddress || process.env.EMAIL_USER,
    to,
    subject,
    text,
  });
}

async function createUserDirect({ name, email, password }) {
  const hashedPassword = await bcrypt.hash(password, 10);
  const conn = await pool.getConnection();
  try {
    const [exists] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length > 0) {
      // mimic “duplicate” for caller
      return { duplicate: true, user: exists[0] };
    }
    const [result] = await conn.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email, hashedPassword]
    );
    const id = result.insertId;
    const [rows] = await conn.query('SELECT id, name, email, role FROM users WHERE id = ?', [id]);
    return { user: rows[0] };
  } finally {
    conn.release();
  }
}

function normalizeDemoGuestName(rawName) {
  const cleaned = String(rawName || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return cleaned || null;
}

function normalizeDemoCode(rawCode) {
  return String(rawCode || '').trim().toLowerCase();
}

async function createGuestDemoUser(conn, demoCode, requestedName = '', role = 'student') {
  const [result] = await conn.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [
      'Demo Guest',
      `demo-${String(demoCode || 'guest').toLowerCase()}-${Date.now()}-${crypto.randomUUID()}@colearn-ai.demo`,
      await bcrypt.hash(crypto.randomUUID(), 10),
      role,
    ]
  );

  const guestId = Number(result.insertId);
  const guestName =
    normalizeDemoGuestName(requestedName) ||
    `Guest ${guestId}`;

  await conn.query('UPDATE users SET name = ? WHERE id = ?', [guestName, guestId]);

  return {
    id: guestId,
    name: guestName,
    role,
  };
}

async function findDemoCourseForCode(conn, demoCode) {
  const normalizedDemoCode = normalizeDemoCode(demoCode);
  const [courses] = await conn.query(
    `SELECT c.id, c.name, c.code, pc.id AS class_id, pc.name AS class_name
       FROM courses c
       JOIN pogil_classes pc ON pc.id = c.class_id
      WHERE LOWER(TRIM(c.code)) = ?
        AND pc.demo_mode = 1
      ORDER BY c.year DESC, c.created_at DESC, c.id DESC
      LIMIT 1`,
    [normalizedDemoCode]
  );

  return courses[0] || null;
}

async function findJoinableDemoSession(conn, courseId) {
  const [rows] = await conn.query(
    `
    SELECT
      ai.id AS instance_id,
      ai.activity_id,
      ai.group_number,
      c.id AS course_id,
      c.name AS course_name,
      a.title AS activity_title,
      COUNT(gm.id) AS group_size,
      SUM(
        CASE
          WHEN gm.last_heartbeat IS NOT NULL
           AND gm.last_heartbeat >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
          THEN 1 ELSE 0
        END
      ) AS active_members,
      MAX(gm.last_heartbeat) AS last_heartbeat
    FROM activity_instances ai
    JOIN group_members gm ON gm.activity_instance_id = ai.id
    JOIN courses c ON c.id = ai.course_id
    LEFT JOIN pogil_activities a ON a.id = ai.activity_id
    WHERE ai.course_id = ?
      AND ai.status = 'in_progress'
    GROUP BY ai.id, ai.activity_id, ai.group_number, c.id, c.name, a.title
    HAVING active_members > 0
       AND active_members < ?
    ORDER BY active_members ASC, ai.group_number ASC, last_heartbeat DESC, ai.id ASC
    LIMIT 1
    `,
    [DEMO_ACTIVE_WINDOW_MINUTES, courseId, DEMO_GROUP_MAX_SIZE]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    instanceId: Number(row.instance_id),
    activityId: Number(row.activity_id),
    activityTitle: row.activity_title || '',
    courseId: Number(row.course_id),
    courseName: row.course_name || '',
    groupNumber: Number(row.group_number) || null,
    groupSize: Number(row.group_size) || 0,
    activeMembers: Number(row.active_members) || 0,
    lastHeartbeat: row.last_heartbeat || null,
  };
}

router.get('/demo/student/context/:demoCode', async (req, res) => {
  const demoCode = normalizeDemoCode(req.params.demoCode);
  if (!demoCode) {
    return res.status(400).json({ error: 'Missing demoCode' });
  }

  try {
    await ensureDemoModeSchema();
    const conn = await pool.getConnection();
    try {
      const course = await findDemoCourseForCode(conn, demoCode);
      if (!course) {
        return res.status(404).json({ error: 'Demo not found for that code' });
      }

      const joinableSession = await findJoinableDemoSession(conn, course.id);

      return res.json({
        demoCode,
        course: {
          id: Number(course.id),
          name: course.name,
          code: course.code,
        },
        joinableSession,
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Demo student context error:', err);
    return res.status(500).json({ error: 'Failed to inspect demo session' });
  }
});

// ===================== REGISTER =====================
// POST /auth/register
// Dev mode: create directly; Prod: pending + email
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing name/email/password' });
  }

  try {
    const conn = await pool.getConnection();
    try {
      // Reject if already in real users
      const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
      if (existing.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      if (DEV_AUTO_VERIFY) {
        // Dev bypass: insert directly
        const { duplicate, user } = await createUserDirect({ name, email, password });
        if (duplicate) {
          return res.status(409).json({ error: 'Email already registered' });
        }
        void recordAuditEvent('account_created', {
          req,
          userId: user.id,
          role: user.role,
          details: { auth_mode: 'dev_auto_verify', email },
        });
        // Return the created user (what your seeder expects)
        return res.status(201).json(user);
      }

      // ---- Normal path (pending + email) ----
      const hashedPassword = await bcrypt.hash(password, 10);
      const code = generateCode();

      // Remove old pending entry if exists
      await conn.query('DELETE FROM pending_users WHERE email = ?', [email]);

      // Insert into pending_users
      await conn.query(
        'INSERT INTO pending_users (name, email, password_hash, code) VALUES (?, ?, ?, ?)',
        [name, email, hashedPassword, code]
      );

      try {
        await sendAuthCodeEmail({
          to: email,
          subject: 'Your coLearn-AI Verification Code',
          text: `Your confirmation code is: ${code}`,
        });
      } catch (mailErr) {
        await conn.query('DELETE FROM pending_users WHERE email = ?', [email]).catch(() => {});
        throw mailErr;
      }

      return res.status(200).json({ message: 'Confirmation code sent to your email.' });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// ===================== VERIFY =====================
// POST /auth/verify
router.post('/verify', async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Missing email/code' });

  try {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query(
        'SELECT * FROM pending_users WHERE email = ? AND code = ?',
        [email, code]
      );

      if (rows.length === 0) {
        return res.status(400).json({ error: 'Invalid code or email.' });
      }

      const pending = rows[0];
      const [result] = await conn.query(
        'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
        [pending.name, pending.email, pending.password_hash]
      );
      await conn.query('DELETE FROM pending_users WHERE email = ?', [email]);

      // Return the created user for consistency
      const [created] = await conn.query('SELECT id, name, email, role FROM users WHERE id = ?', [result.insertId]);
      void recordAuditEvent('account_created', {
        req,
        userId: created[0].id,
        role: created[0].role,
        details: { auth_mode: 'pending_verify', email: created[0].email },
      });
      return res.status(201).json(created[0]);
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Verification error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// ===================== LOGIN =====================
// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  
  if (!email) return res.status(400).json({ error: 'Missing email' });

  // Only require password if passwordless mode is OFF
  if (!DEV_PASSWORDLESS_LOGIN && !password) {
    return res.status(400).json({ error: 'Missing password' });
  }

  try {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query('SELECT * FROM users WHERE email = ?', [email]);
      if (rows.length === 0) return res.status(400).json({ error: 'Invalid email or password' });

      const user = rows[0];

      if (DEV_PASSWORDLESS_LOGIN) {
        console.warn(`⚠️ [auth] PASSWORDLESS LOGIN enabled; bypassing password for ${email}`);
      } else {
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(400).json({ error: 'Invalid email or password' });
      }

      req.session.userId = user.id;
      void recordAuditEvent('user_login', {
        req,
        userId: user.id,
        role: user.role,
        details: { auth_mode: DEV_PASSWORDLESS_LOGIN ? 'passwordless' : 'password', email: user.email },
      });
      return res.status(200).json({ id: user.id, name: user.name, role: user.role });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/demo/student', async (req, res) => {
  const demoCode = normalizeDemoCode(req.body?.demoCode);
  const guestName = String(req.body?.guestName || '');
  if (!demoCode) {
    return res.status(400).json({ error: 'Missing demoCode' });
  }

  try {
    await ensureDemoModeSchema();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const course = await findDemoCourseForCode(conn, demoCode);

      if (!course) {
        await conn.rollback();
        return res.status(404).json({ error: 'Demo not found for that code' });
      }

      const guest = await createGuestDemoUser(conn, demoCode, guestName, 'student');

      const joinableSession = await findJoinableDemoSession(conn, course.id);

      await conn.query(
        `INSERT INTO course_enrollments (student_id, course_id) VALUES (?, ?)`,
        [guest.id, course.id]
      );

      await conn.commit();

      req.session.userId = guest.id;
      req.session.demoMode = 'creator';
      void recordAuditEvent('account_created', {
        req,
        userId: guest.id,
        role: guest.role,
        details: { auth_mode: 'demo_student', demo_code: demoCode },
      });
      return res.status(201).json({
        user: guest,
        course: {
          id: Number(course.id),
          name: course.name,
          code: course.code,
        },
        joinableSession,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Demo student login error:', err);
    return res.status(500).json({ error: 'Failed to start demo student session' });
  }
});

router.post('/demo/creator', async (req, res) => {
  const demoCode = normalizeDemoCode(req.body?.demoCode);
  const guestName = String(req.body?.guestName || '');
  if (!demoCode) {
    return res.status(400).json({ error: 'Missing demoCode' });
  }

  try {
    await ensureDemoModeSchema();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const course = await findDemoCourseForCode(conn, demoCode);

      if (!course) {
        await conn.rollback();
        return res.status(404).json({ error: 'Demo not found for that code' });
      }

      const guest = await createGuestDemoUser(conn, demoCode, guestName, 'creator');

      await conn.commit();

      req.session.userId = guest.id;
      req.session.demoMode = 'creator';
      void recordAuditEvent('account_created', {
        req,
        userId: guest.id,
        role: guest.role,
        details: { auth_mode: 'demo_creator', demo_code: demoCode },
      });
      return res.status(201).json({
        user: guest,
        class: {
          id: Number(course.class_id),
          name: course.class_name,
        },
        course: {
          id: Number(course.id),
          name: course.name,
          code: course.code,
        },
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Demo creator login error:', err);
    return res.status(500).json({ error: 'Failed to start creator demo session' });
  }
});

router.post('/demo/instructor', async (req, res) => {
  const demoCode = normalizeDemoCode(req.body?.demoCode);
  const guestName = String(req.body?.guestName || '');
  if (!demoCode) {
    return res.status(400).json({ error: 'Missing demoCode' });
  }

  try {
    await ensureDemoModeSchema();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const course = await findDemoCourseForCode(conn, demoCode);
      if (!course) {
        await conn.rollback();
        return res.status(404).json({ error: 'Demo not found for that code' });
      }

      const guest = await createGuestDemoUser(conn, demoCode, guestName, 'instructor');

      await conn.query(
        `INSERT INTO course_enrollments (student_id, course_id) VALUES (?, ?)`,
        [guest.id, course.id]
      );

      await conn.commit();

      req.session.userId = guest.id;
      req.session.demoMode = 'instructor';
      void recordAuditEvent('account_created', {
        req,
        userId: guest.id,
        role: guest.role,
        details: { auth_mode: 'demo_instructor', demo_code: demoCode },
      });

      return res.status(201).json({
        user: { ...guest, demo_mode: 'instructor' },
        class: {
          id: Number(course.class_id),
          name: course.class_name,
        },
        course: {
          id: Number(course.id),
          name: course.name,
          code: course.code,
        },
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Demo instructor login error:', err);
    return res.status(500).json({ error: 'Failed to start instructor demo session' });
  }
});


// ===================== PASSWORD RESET (unchanged) =====================
const passwordResetCodes = new Map(); // key = email, value = code

router.post('/request-reset', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const code = generateCode();

  try {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
      if (rows.length === 0) return res.status(400).json({ error: 'No user found with that email.' });

      passwordResetCodes.set(email, code);

      try {
        await sendAuthCodeEmail({
          to: email,
          subject: 'coLearn-AI Password Reset Code',
          text: `Your reset code is: ${code}`,
        });
      } catch (mailErr) {
        passwordResetCodes.delete(email);
        throw mailErr;
      }

      return res.status(200).json({ message: 'Reset code sent to email.' });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Error sending reset code:', err);
    return res.status(500).json({ error: 'Failed to send reset code' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Missing email/code/newPassword' });
  }

  const expectedCode = passwordResetCodes.get(email);
  if (!expectedCode || code !== expectedCode) {
    return res.status(400).json({ error: 'Invalid or expired code.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const conn = await pool.getConnection();
    try {
      await conn.query('UPDATE users SET password_hash = ? WHERE email = ?', [hashedPassword, email]);
    } finally {
      conn.release();
    }
    passwordResetCodes.delete(email);
    return res.status(200).json({ message: 'Password reset successful.' });
  } catch (err) {
    console.error('Reset error:', err);
    return res.status(500).json({ error: 'Password reset failed' });
  }
});

// ===================== SESSION HELPERS =====================
router.get('/whoami', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in' });

  try {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query('SELECT id, name, email, role FROM users WHERE id = ?', [userId]);
      if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
      return res.json({ ...rows[0], demo_mode: req.session.demoMode || null });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('whoami error:', err);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    return res.json({ message: 'Logged out' });
  });
});

module.exports = router;
