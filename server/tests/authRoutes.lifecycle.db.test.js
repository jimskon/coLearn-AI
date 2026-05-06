const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

delete process.env.AUTH_DEV_PASSWORDLESS_LOGIN;
delete process.env.AUTH_DEV_AUTO_VERIFY;

const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');

const authRoutes = require('../auth/routes');
const db = require('../db');

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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

function createTestServer() {
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
            server.close(closeResolve);
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

async function requestJson(path, { method = 'POST', body, headers = {} } = {}) {
  const server = await createTestServer();
  try {
    return await requestJsonWithServer(server.baseUrl, path, { method, body, headers });
  } finally {
    await server.close();
  }
}

async function createVerifiedUser({ name = 'Lifecycle User', email = uniqueEmail('lifecycle'), password = 'StartPassword123' } = {}) {
  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [name, email, passwordHash]
  );
  return {
    id: Number(result.insertId),
    name,
    email,
    password,
  };
}

function withCapturedWarns(fn) {
  const originalWarn = console.warn;
  const messages = [];
  console.warn = (...args) => {
    messages.push(args.map((arg) => String(arg)).join(' '));
  };

  return Promise.resolve()
    .then(() => fn(messages))
    .finally(() => {
      console.warn = originalWarn;
    });
}

function extractLastSixDigitCode(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const match = messages[i].match(/\b(\d{6})\b/);
    if (match) return match[1];
  }
  return null;
}

test.after(async () => {
  await db.end();
});

test('verify promotes a pending user into users and removes the pending row', async () => {
  await ensureSchema();

  const email = uniqueEmail('pending');
  const passwordHash = await bcrypt.hash('PendingPassword123', 10);

  await db.query(
    'INSERT INTO pending_users (name, email, password_hash, code) VALUES (?, ?, ?, ?)',
    ['Pending User', email, passwordHash, '123456']
  );

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
  const passwordHash = await bcrypt.hash('PendingPassword123', 10);

  await db.query(
    'INSERT INTO pending_users (name, email, password_hash, code) VALUES (?, ?, ?, ?)',
    ['Wrong Code User', email, passwordHash, '654321']
  );

  const response = await requestJson('/api/auth/verify', {
    body: { email, code: '000000' },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Invalid code or email.' });

  const [users] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  assert.equal(users.length, 0);
});

test('request-reset emits a reset code for an existing user', async () => {
  await ensureSchema();

  const user = await createVerifiedUser({ email: uniqueEmail('request-reset') });

  await withCapturedWarns(async (messages) => {
    const response = await requestJson('/api/auth/request-reset', {
      body: { email: user.email },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'Reset code sent to email.' });

    const code = extractLastSixDigitCode(messages);
    assert.match(code || '', /^\d{6}$/);
  });
});

test('reset-password accepts the emitted code, updates the password, and clears the code', async () => {
  await ensureSchema();

  const user = await createVerifiedUser({
    email: uniqueEmail('reset-success'),
    password: 'OldPassword123',
  });

  const server = await createTestServer();
  try {
    let resetCode = null;

    await withCapturedWarns(async (messages) => {
      const requestReset = await requestJsonWithServer(server.baseUrl, '/api/auth/request-reset', {
        method: 'POST',
        body: { email: user.email },
      });

      assert.equal(requestReset.status, 200);
      resetCode = extractLastSixDigitCode(messages);
    });

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
    assert.equal(login.body.email, user.email);

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

  const server = await createTestServer();
  try {
    await withCapturedWarns(async () => {
      const requestReset = await requestJsonWithServer(server.baseUrl, '/api/auth/request-reset', {
        method: 'POST',
        body: { email: user.email },
      });
      assert.equal(requestReset.status, 200);
    });

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
    assert.equal(login.body.email, user.email);
  } finally {
    await server.close();
  }
});
