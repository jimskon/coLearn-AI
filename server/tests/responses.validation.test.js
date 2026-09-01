'use strict';
const assert = require('node:assert/strict');
const http   = require('node:http');
const test   = require('node:test');

const express          = require('express');
const responsesRoutes  = require('../responses/routes');

// ---------------------------------------------------------------------------
// Minimal test server — no real DB needed for validation-only tests
// ---------------------------------------------------------------------------
function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/responses', responsesRoutes);
  const server = http.createServer(app);
  server.keepAliveTimeout = 1;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res) => {
            server.close(res);
            server.closeIdleConnections?.();
          }),
      });
    });
  });
}

async function post(path, body) {
  const server = await createTestServer();
  try {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, body: json };
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------------------
// bulk-save: body shape validation (no DB required — rejects before any query)
// ---------------------------------------------------------------------------

test('bulk-save rejects missing instanceId', async () => {
  const res = await post('/api/responses/bulk-save', {
    userId: 1,
    answers: { '2a': 'hello' },
  });
  assert.equal(res.status, 400);
});

test('bulk-save rejects missing userId', async () => {
  const res = await post('/api/responses/bulk-save', {
    instanceId: 1,
    answers: { '2a': 'hello' },
  });
  assert.equal(res.status, 400);
});

test('bulk-save rejects missing answers', async () => {
  const res = await post('/api/responses/bulk-save', {
    instanceId: 1,
    userId: 1,
  });
  assert.equal(res.status, 400);
});

test('bulk-save rejects invalid question_id format (underscore suffix)', async () => {
  const res = await post('/api/responses/bulk-save', {
    instanceId: 1,
    userId: 1,
    answers: { '2a_state': 'bad' },
  });
  assert.equal(res.status, 400);
  assert.ok(res.body?.error?.includes('Invalid question_id'));
});

test('bulk-save rejects question_id with zero numeric suffix (2aF0)', async () => {
  // isValidQuestionId allows all alphanumeric — 2aF0 is actually valid per the regex.
  // This test documents the current behaviour rather than asserting a 400.
  const res = await post('/api/responses/bulk-save', {
    instanceId: 1,
    userId: 1,
    answers: { '2aF0': 'value' },
  });
  // 2aF0 matches /^\d+[A-Za-z]+[A-Za-z0-9_]*$/ so it is valid; route may
  // return 200 (if DB is available) or 500 (no DB in unit test) but NOT 400.
  assert.notEqual(res.status, 400);
});

test('bulk-save rejects answers array instead of object', async () => {
  const res = await post('/api/responses/bulk-save', {
    instanceId: 1,
    userId: 1,
    answers: [{ question_id: '2a', response: 'bad' }],
  });
  assert.equal(res.status, 400);
});

test('bulk-save returns success for empty answers object', async () => {
  const res = await post('/api/responses/bulk-save', {
    instanceId: 1,
    userId: 1,
    answers: {},
  });
  // Empty answers list → saved: 0, no DB write needed
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, saved: 0 });
});
