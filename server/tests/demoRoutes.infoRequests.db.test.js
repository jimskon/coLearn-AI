const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const db = require('../db');
const demoRoutes = require('../demo/routes');

const created = {
  requestIds: new Set(),
};

async function cleanupCreatedRows() {
  const requestIds = [...created.requestIds];
  if (requestIds.length) {
    await db.query(`DELETE FROM demo_info_requests WHERE id IN (?)`, [requestIds]);
  }
}

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS demo_info_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      demo_code VARCHAR(64) NOT NULL DEFAULT 'aied2026',
      name VARCHAR(191) DEFAULT NULL,
      email VARCHAR(255) NOT NULL,
      institution VARCHAR(255) DEFAULT NULL,
      role VARCHAR(255) DEFAULT NULL,
      interest_beta TINYINT(1) NOT NULL DEFAULT 0,
      interest_pilot TINYINT(1) NOT NULL DEFAULT 0,
      interest_research TINYINT(1) NOT NULL DEFAULT 0,
      interest_instructor_demo TINYINT(1) NOT NULL DEFAULT 0,
      interest_technical TINYINT(1) NOT NULL DEFAULT 0,
      interest_materials TINYINT(1) NOT NULL DEFAULT 0,
      interest_other TINYINT(1) NOT NULL DEFAULT 0,
      message TEXT DEFAULT NULL,
      source_path TEXT DEFAULT NULL,
      guest_token VARCHAR(191) DEFAULT NULL,
      user_agent TEXT DEFAULT NULL,
      ip_address VARCHAR(64) DEFAULT NULL,
      status ENUM('new','contacted','follow_up','closed') NOT NULL DEFAULT 'new',
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'];
    if (role) {
      req.user = { id: 1, role, name: 'Test Admin' };
    }
    next();
  });
  app.use('/api/demo', demoRoutes);

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
            server.close(() => closeResolve());
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

  const responseBody = await response.json().catch(() => ({}));
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

test.after(async () => {
  await cleanupCreatedRows();
  await db.end();
});

test('demo info request rejects invalid email', async () => {
  await ensureSchema();

  const response = await requestJson('/api/demo/aied2026/info-request', {
    method: 'POST',
    body: { email: 'not-an-email' },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Valid email is required');
});

test('demo info request saves a request and admin can list and update it', async () => {
  await ensureSchema();

  const first = await requestJson('/api/demo/aied2026/info-request', {
    method: 'POST',
    body: {
      name: 'Ada Lovelace',
      email: `ada-${Date.now()}@example.com`,
      institution: 'Example University',
      role: 'Instructor',
      interests: {
        beta: true,
        research: true,
        materials: true,
      },
      message: 'Please send pilot details.',
    },
  });

  assert.equal(first.status, 201);
  assert.equal(first.body.ok, true);
  assert.ok(Number.isFinite(Number(first.body.id)));
  created.requestIds.add(Number(first.body.id));

  const second = await requestJson('/api/demo/aied2026/info-request', {
    method: 'POST',
    body: {
      email: `later-${Date.now()}@example.com`,
    },
  });

  assert.equal(second.status, 201);
  created.requestIds.add(Number(second.body.id));

  const listed = await requestJson('/api/demo/aied2026/admin/info-requests', {
    method: 'GET',
    headers: { 'x-test-role': 'creator' },
  });

  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.body));
  assert.equal(listed.body[0].id, second.body.id);
  assert.equal(listed.body[1].id, first.body.id);

  const updated = await requestJson(`/api/demo/aied2026/admin/info-requests/${first.body.id}`, {
    method: 'PATCH',
    headers: { 'x-test-role': 'creator' },
    body: {
      status: 'contacted',
      notes: 'Followed up after demo.',
    },
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.ok, true);
  assert.equal(updated.body.request.status, 'contacted');
  assert.equal(updated.body.request.notes, 'Followed up after demo.');
});
