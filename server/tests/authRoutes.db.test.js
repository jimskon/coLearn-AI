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

const created = {
  emails: new Set(),
  users: new Set(),
  classes: new Set(),
  courses: new Set(),
};

function rememberEmail(email) {
  if (email) created.emails.add(String(email));
  return email;
}

async function cleanupCreatedRows() {
  const emails = [...created.emails];
  const userIds = [...created.users];
  const courseIds = [...created.courses];
  const classIds = [...created.classes];

  if (courseIds.length) {
    await db.query(`DELETE FROM course_enrollments WHERE course_id IN (?)`, [courseIds]).catch(() => {});
    await db.query(`DELETE FROM courses WHERE id IN (?)`, [courseIds]).catch(() => {});
  }
  if (classIds.length) {
    await db.query(`DELETE FROM pogil_classes WHERE id IN (?)`, [classIds]).catch(() => {});
  }
  if (userIds.length) {
    await db.query(`DELETE FROM users WHERE id IN (?)`, [userIds]).catch(() => {});
  }
  if (!emails.length) return;

  await db.query(`DELETE FROM pending_users WHERE email IN (?)`, [emails]).catch(() => {});
  await db.query(`DELETE FROM users WHERE email IN (?)`, [emails]);
}

function rememberId(kind, id) {
  const numericId = Number(id);
  if (Number.isFinite(numericId)) created[kind].add(numericId);
  return numericId;
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

async function requestJson(path, { method = 'POST', body, headers = {} } = {}) {
  const server = await createTestServer();
  try {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
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
  } finally {
    await server.close();
  }
}

function createCookieJar() {
  let cookie = '';

  return {
    headers() {
      return cookie ? { Cookie: cookie } : {};
    },
    store(response) {
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        cookie = setCookie.split(';')[0];
      }
    },
  };
}

async function requestJsonWithServer(baseUrl, path, { method = 'GET', body, headers = {} } = {}) {
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

test.after(async () => {
  await cleanupCreatedRows();
  await db.end();
});

test('register creates a verified user in dev auto-verify mode', async () => {
  const email = rememberEmail(uniqueEmail('register'));

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
  const email = rememberEmail(uniqueEmail('duplicate'));
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
  const email = rememberEmail(uniqueEmail('login'));
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
  const email = rememberEmail(uniqueEmail('bad-password'));

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

test('whoami rejects requests without a session', async () => {
  const response = await requestJson('/api/auth/whoami', {
    method: 'GET',
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Not logged in' });
});

test('demo student login creates a guest session and enrolls the guest in a demo class course', async () => {
  await db.query(`
    ALTER TABLE pogil_classes
      ADD COLUMN IF NOT EXISTS demo_mode TINYINT(1) NOT NULL DEFAULT 0
  `);

  const className = `Demo Class ${Date.now()}`;
  const [classResult] = await db.query(
    `INSERT INTO pogil_classes (name, description, demo_mode, created_by)
     VALUES (?, ?, 1, NULL)`,
    [className, 'Demo-only class']
  );
  const classId = rememberId('classes', classResult.insertId);

  const demoCode = `AIED${String(Date.now()).slice(-4)}`;
  const [courseResult] = await db.query(
    `INSERT INTO courses (name, code, section, semester, year, instructor_id, class_id)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ['AIED Demo Instance', demoCode, 'DEMO', 'summer', 2026, classId]
  );
  const courseId = rememberId('courses', courseResult.insertId);

  const response = await requestJson('/api/auth/demo/student', {
    body: { demoCode },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, 'student');
  assert.match(response.body.user.name, /^AIED Guest \d+$/);
  assert.equal(response.body.course.id, courseId);
  assert.equal(response.body.course.code, demoCode);
  assert.match(response.headers.get('set-cookie') || '', /connect\.sid=/);
  rememberId('users', response.body.user.id);

  const [enrollments] = await db.query(
    `SELECT 1 AS ok FROM course_enrollments WHERE student_id = ? AND course_id = ?`,
    [response.body.user.id, courseId]
  );
  assert.equal(enrollments.length, 1);
});

test('login session can be read by whoami and cleared by logout', async () => {
  const server = await createTestServer();
  const jar = createCookieJar();
  const email = rememberEmail(uniqueEmail('session'));
  const password = 'SessionPassword123';

  try {
    const register = await requestJsonWithServer(server.baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Annie Easley',
        email,
        password,
      },
    });
    assert.equal(register.status, 201);

    const loggedOutWhoami = await requestJsonWithServer(server.baseUrl, '/api/auth/whoami');
    assert.equal(loggedOutWhoami.status, 401);
    assert.deepEqual(loggedOutWhoami.body, { error: 'Not logged in' });

    const login = await requestJsonWithServer(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: {
        email,
        password,
      },
    });
    jar.store(login);

    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie') || '', /connect\.sid=/);

    const loggedInWhoami = await requestJsonWithServer(server.baseUrl, '/api/auth/whoami', {
      headers: jar.headers(),
    });

    assert.equal(loggedInWhoami.status, 200);
    assert.equal(loggedInWhoami.body.name, 'Annie Easley');
    assert.equal(loggedInWhoami.body.email, email);
    assert.equal(loggedInWhoami.body.role, 'student');

    const logout = await requestJsonWithServer(server.baseUrl, '/api/auth/logout', {
      method: 'POST',
      headers: jar.headers(),
    });
    jar.store(logout);

    assert.equal(logout.status, 200);
    assert.deepEqual(logout.body, { message: 'Logged out' });

    const afterLogoutWhoami = await requestJsonWithServer(server.baseUrl, '/api/auth/whoami', {
      headers: jar.headers(),
    });
    assert.equal(afterLogoutWhoami.status, 401);
    assert.deepEqual(afterLogoutWhoami.body, { error: 'Not logged in' });
  } finally {
    await server.close();
  }
});
