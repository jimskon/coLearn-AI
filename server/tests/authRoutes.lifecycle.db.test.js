const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const test = require('node:test');

delete process.env.AUTH_DEV_PASSWORDLESS_LOGIN;
delete process.env.AUTH_DEV_AUTO_VERIFY;

const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');

const db = require('../db');

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

const created = {
  users: new Set(),
  pendingUsers: new Set(),
  userEmails: new Set(),
  pendingEmails: new Set(),
};

function remember(kind, id) {
  const numericId = Number(id);
  if (Number.isFinite(numericId)) created[kind].add(numericId);
  return numericId;
}

async function cleanupCreatedRows() {
  const pendingIds = [...created.pendingUsers];
  const userIds = [...created.users];
  const pendingEmails = [...created.pendingEmails];
  const userEmails = [...created.userEmails];

  if (pendingIds.length) await db.query(`DELETE FROM pending_users WHERE id IN (?)`, [pendingIds]);
  if (pendingEmails.length) await db.query(`DELETE FROM pending_users WHERE email IN (?)`, [pendingEmails]);
  if (userIds.length) await db.query(`DELETE FROM users WHERE id IN (?)`, [userIds]);
  if (userEmails.length) await db.query(`DELETE FROM users WHERE email IN (?)`, [userEmails]);
}

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name TEXT NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role ENUM('root','creator','instructor','student','grader') NOT NULL DEFAULT 'student',
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS pending_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name TEXT NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      code VARCHAR(16) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function loadAuthRoutes({ sentMail } = {}) {
  const authRoutesPath = require.resolve('../auth/routes');
  const originalEmailUser = process.env.EMAIL_USER;
  const originalEmailPass = process.env.EMAIL_PASS;

  process.env.EMAIL_USER = 'test@example.com';
  process.env.EMAIL_PASS = 'test-pass';

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'nodemailer') {
      return {
        createTransport: () => ({
          sendMail: async (payload) => {
            if (typeof sentMail === 'function') {
              await sentMail(payload);
            }
            return { accepted: [payload.to] };
          },
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[authRoutesPath];
  const authRoutes = require(authRoutesPath);

  return {
    authRoutes,
    restore() {
      Module._load = originalLoad;
      delete require.cache[authRoutesPath];

      if (originalEmailUser === undefined) delete process.env.EMAIL_USER;
      else process.env.EMAIL_USER = originalEmailUser;

      if (originalEmailPass === undefined) delete process.env.EMAIL_PASS;
      else process.env.EMAIL_PASS = originalEmailPass;
    },
  };
}

function createTestServer({ sentMail } = {}) {
  const { authRoutes, restore } = loadAuthRoutes({ sentMail });
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
  }));
  app.use('/api/auth', authRoutes);

  const server = http.createServer(app);
  server.keepAliveTimeout = 1;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((closeResolve) => {
            server.close(() => {
              restore();
              closeResolve();
            });
            server.closeIdleConnections?.();
          }),
      });
    });
  });
}

async function requestJsonWithServer(baseUrl, path, { method = 'POST', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Connection: 'close',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = await response.json();
  return {
    status: response.status,
    headers: response.headers,
    body: responseBody,
  };
}

async function requestJson(path, { method = 'POST', body, headers = {}, sentMail } = {}) {
  const server = await createTestServer({ sentMail });
  try {
    return await requestJsonWithServer(server.baseUrl, path, { method, body, headers });
  } finally {
    await server.close();
  }
}

async function createVerifiedUser({ name = 'Lifecycle User', email = uniqueEmail('lifecycle'), password = 'StartPassword123' } = {}) {
  created.userEmails.add(email);
  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [name, email, passwordHash]
  );
  return {
    id: remember('users', result.insertId),
    name,
    email,
    password,
  };
}

async function createPendingUser({ name, email, passwordHash, code }) {
  created.pendingEmails.add(email);
  const [result] = await db.query(
    'INSERT INTO pending_users (name, email, password_hash, code) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, code]
  );
  return remember('pendingUsers', result.insertId);
}

function extractLastSixDigitCode(text) {
  const match = String(text || '').match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

test.after(async () => {
  await cleanupCreatedRows();
  await db.end();
});

test('verify promotes a pending user into users and removes the pending row', async () => {
  await ensureSchema();

  const email = uniqueEmail('pending');
  created.userEmails.add(email);
  const passwordHash = await bcrypt.hash('PendingPassword123', 10);

  await createPendingUser({
    name: 'Pending User',
    email,
    passwordHash,
    code: '123456',
  });

  const response = await requestJson('/api/auth/verify', {
    body: { email, code: '123456' },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.name, 'Pending User');
  assert.equal(response.body.email, email);
  assert.equal(response.body.role, 'student');

  const [users] = await db.query('SELECT id, email FROM users WHERE email = ?', [email]);
  assert.equal(users.length, 1);

  const [pending] = await db.query('SELECT id FROM pending_users WHERE email = ?', [email]);
  assert.equal(pending.length, 0);
});

test('verify rejects an incorrect code without creating a user', async () => {
  await ensureSchema();

  const email = uniqueEmail('wrong-code');
  created.userEmails.add(email);
  const passwordHash = await bcrypt.hash('PendingPassword123', 10);

  await createPendingUser({
    name: 'Wrong Code User',
    email,
    passwordHash,
    code: '654321',
  });

  const response = await requestJson('/api/auth/verify', {
    body: { email, code: '000000' },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Invalid code or email.' });

  const [users] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  assert.equal(users.length, 0);
});

test('register fails cleanly when email delivery fails and removes the pending user', async () => {
  await ensureSchema();

  const email = uniqueEmail('register-mail-fail');
  created.pendingEmails.add(email);
  let sentPayload = null;

  const response = await requestJson('/api/auth/register', {
    body: {
      name: 'Mail Fail User',
      email,
      password: 'PendingPassword123',
    },
    sentMail: async (payload) => {
      sentPayload = payload;
      throw new Error('smtp down');
    },
  });

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Registration failed' });
  assert.ok(sentPayload);

  const code = extractLastSixDigitCode(sentPayload.text);
  assert.match(code || '', /^\d{6}$/);

  const [pending] = await db.query('SELECT email, code FROM pending_users WHERE email = ?', [email]);
  assert.equal(pending.length, 0);

  const [users] = await db.query('SELECT email FROM users WHERE email = ?', [email]);
  assert.equal(users.length, 0);

  const verify = await requestJson('/api/auth/verify', {
    body: { email, code },
  });

  assert.equal(verify.status, 400);
  assert.deepEqual(verify.body, { error: 'Invalid code or email.' });
});

test('request-reset emits a reset code for an existing user', async () => {
  await ensureSchema();

  const user = await createVerifiedUser({ email: uniqueEmail('request-reset') });
  const sent = [];

  const response = await requestJson('/api/auth/request-reset', {
    body: { email: user.email },
    sentMail: async (payload) => {
      sent.push(payload);
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { message: 'Reset code sent to email.' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, user.email);
  const code = extractLastSixDigitCode(sent[0].text);
  assert.match(code || '', /^\d{6}$/);
});

test('request-reset fails cleanly when email delivery fails and clears the reset code', async () => {
  await ensureSchema();

  const user = await createVerifiedUser({ email: uniqueEmail('request-reset-fail') });
  let sentPayload = null;

  const server = await createTestServer({
    sentMail: async (payload) => {
      sentPayload = payload;
      throw new Error('smtp down');
    },
  });
  try {
    const requestReset = await requestJsonWithServer(server.baseUrl, '/api/auth/request-reset', {
      method: 'POST',
      body: { email: user.email },
    });

    assert.equal(requestReset.status, 500);
    assert.deepEqual(requestReset.body, { error: 'Failed to send reset code' });
    assert.ok(sentPayload);

    const resetCode = extractLastSixDigitCode(sentPayload.text);
    assert.match(resetCode || '', /^\d{6}$/);

    const reset = await requestJsonWithServer(server.baseUrl, '/api/auth/reset-password', {
      method: 'POST',
      body: {
        email: user.email,
        code: resetCode,
        newPassword: 'NewPassword456',
      },
    });

    assert.equal(reset.status, 400);
    assert.deepEqual(reset.body, { error: 'Invalid or expired code.' });
  } finally {
    await server.close();
  }
});

test('reset-password accepts the emitted code, updates the password, and clears the code', async () => {
  await ensureSchema();

  const user = await createVerifiedUser({
    email: uniqueEmail('reset-success'),
    password: 'OldPassword123',
  });

  const sent = [];
  const server = await createTestServer({
    sentMail: async (payload) => {
      sent.push(payload);
    },
  });
  try {
    const requestReset = await requestJsonWithServer(server.baseUrl, '/api/auth/request-reset', {
      method: 'POST',
      body: { email: user.email },
    });

    assert.equal(requestReset.status, 200);
    const resetCode = extractLastSixDigitCode(sent[0]?.text);
    assert.match(resetCode || '', /^\d{6}$/);

    const reset = await requestJsonWithServer(server.baseUrl, '/api/auth/reset-password', {
      method: 'POST',
      body: {
        email: user.email,
        code: resetCode,
        newPassword: 'NewPassword456',
      },
    });

    assert.equal(reset.status, 200);
    assert.deepEqual(reset.body, { message: 'Password reset successful.' });

    const login = await requestJsonWithServer(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: {
        email: user.email,
        password: 'NewPassword456',
      },
    });

    assert.equal(login.status, 200);
    assert.equal(login.body.name, user.name);

    const staleCode = await requestJsonWithServer(server.baseUrl, '/api/auth/reset-password', {
      method: 'POST',
      body: {
        email: user.email,
        code: resetCode,
        newPassword: 'AnotherPassword789',
      },
    });

    assert.equal(staleCode.status, 400);
    assert.deepEqual(staleCode.body, { error: 'Invalid or expired code.' });
  } finally {
    await server.close();
  }
});

test('reset-password rejects an invalid code and leaves the old password working', async () => {
  await ensureSchema();

  const user = await createVerifiedUser({
    email: uniqueEmail('reset-invalid'),
    password: 'OriginalPassword123',
  });

  const server = await createTestServer({
    sentMail: async () => ({ accepted: true }),
  });
  try {
    const requestReset = await requestJsonWithServer(server.baseUrl, '/api/auth/request-reset', {
      method: 'POST',
      body: { email: user.email },
    });
    assert.equal(requestReset.status, 200);

    const badReset = await requestJsonWithServer(server.baseUrl, '/api/auth/reset-password', {
      method: 'POST',
      body: {
        email: user.email,
        code: '000000',
        newPassword: 'ShouldNotWork456',
      },
    });

    assert.equal(badReset.status, 400);
    assert.deepEqual(badReset.body, { error: 'Invalid or expired code.' });

    const login = await requestJsonWithServer(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: {
        email: user.email,
        password: 'OriginalPassword123',
      },
    });

    assert.equal(login.status, 200);
    assert.equal(login.body.name, user.name);
  } finally {
    await server.close();
  }
});
