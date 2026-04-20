const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.AUTH_DEV_AUTO_VERIFY = 'true';
delete process.env.AUTH_DEV_PASSWORDLESS_LOGIN;

const express = require('express');
const session = require('express-session');

const authRoutes = require('../auth/routes');
const db = require('../db');

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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

async function requestJson(path, { method = 'POST', body, headers = {} } = {}) {
  const server = await createTestServer();
  try {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
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
  } finally {
    await server.close();
  }
}

test.after(async () => {
  await db.end();
});

test('register creates a verified user in dev auto-verify mode', async () => {
  const email = uniqueEmail('register');

  const response = await requestJson('/api/auth/register', {
    body: {
      name: 'Grace Hopper',
      email,
      password: 'TestPassword123',
    },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.name, 'Grace Hopper');
  assert.equal(response.body.email, email);
  assert.equal(response.body.role, 'student');

  const [rows] = await db.query('SELECT id, name, email, role FROM users WHERE email = ?', [email]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, email);
});

test('register rejects duplicate email addresses', async () => {
  const email = uniqueEmail('duplicate');
  const body = {
    name: 'Katherine Johnson',
    email,
    password: 'TestPassword123',
  };

  const first = await requestJson('/api/auth/register', { body });
  const second = await requestJson('/api/auth/register', { body });

  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.deepEqual(second.body, { error: 'Email already registered' });
});

test('login accepts a registered user password and creates a session cookie', async () => {
  const email = uniqueEmail('login');
  const password = 'CorrectHorseBatteryStaple123';

  const register = await requestJson('/api/auth/register', {
    body: {
      name: 'Dorothy Vaughan',
      email,
      password,
    },
  });
  assert.equal(register.status, 201);

  const login = await requestJson('/api/auth/login', {
    body: {
      email,
      password,
    },
  });

  assert.equal(login.status, 200);
  assert.equal(login.body.name, 'Dorothy Vaughan');
  assert.equal(login.body.role, 'student');
  assert.match(login.headers.get('set-cookie') || '', /connect\.sid=/);
});

test('login rejects an incorrect password for an existing user', async () => {
  const email = uniqueEmail('bad-password');

  const register = await requestJson('/api/auth/register', {
    body: {
      name: 'Mary Jackson',
      email,
      password: 'RightPassword123',
    },
  });
  assert.equal(register.status, 201);

  const login = await requestJson('/api/auth/login', {
    body: {
      email,
      password: 'WrongPassword123',
    },
  });

  assert.equal(login.status, 400);
  assert.deepEqual(login.body, { error: 'Invalid email or password' });
});
