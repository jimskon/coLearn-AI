const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

delete process.env.AUTH_DEV_PASSWORDLESS_LOGIN;
delete process.env.AUTH_DEV_AUTO_VERIFY;

const express = require('express');
const session = require('express-session');

const authRoutes = require('../auth/routes');

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

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(closeResolve => server.close(closeResolve)),
      });
    });
  });
}

async function postJson(path, body) {
  const server = await createTestServer();
  try {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const responseBody = await response.json();
    return {
      status: response.status,
      body: responseBody,
    };
  } finally {
    await server.close();
  }
}

test('register rejects requests missing required fields before database access', async () => {
  const response = await postJson('/api/auth/register', {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Missing name/email/password' });
});

test('verify rejects requests missing email or code before database access', async () => {
  const response = await postJson('/api/auth/verify', {
    email: 'ada@example.com',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Missing email/code' });
});

test('login rejects requests missing email before database access', async () => {
  const response = await postJson('/api/auth/login', {
    password: 'secret',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Missing email' });
});

test('login rejects requests missing password before database access', async () => {
  const response = await postJson('/api/auth/login', {
    email: 'ada@example.com',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Missing password' });
});

test('password reset request rejects missing email before database access', async () => {
  const response = await postJson('/api/auth/request-reset', {});

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Missing email' });
});

test('password reset rejects missing required fields before database access', async () => {
  const response = await postJson('/api/auth/reset-password', {
    email: 'ada@example.com',
    code: '123456',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Missing email/code/newPassword' });
});
