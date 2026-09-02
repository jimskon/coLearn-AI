'use strict';
const assert = require('node:assert/strict');
const http   = require('node:http');
const test   = require('node:test');

const express          = require('express');
// Force the AI placeholder BEFORE requiring the routes: responses/controller
// pulls in ai/controller, which builds an OpenAI client at import time. Set
// unconditionally rather than with ||= so a real key in a developer's .env
// cannot turn these validation tests into live, billable API calls.
process.env.OPENAI_API_KEY = 'test-key';

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

// A question_id must be digits followed by letters, optionally then more
// alphanumerics. '2a_state' is VALID (the trailing _state matches the
// [A-Za-z0-9_]* tail), so these use ids that genuinely cannot parse: one with
// no leading digits, and one with no letters after the digits.
test('bulk-save rejects question_id with no leading digits', async () => {
  const res = await post('/api/responses/bulk-save', {
    instanceId: 1,
    userId: 1,
    answers: { 'notaqid': 'bad' },
  });
  assert.equal(res.status, 400);
  assert.ok(res.body?.error?.includes('Invalid question_id'));
});

test('bulk-save rejects question_id with no letter section', async () => {
  const res = await post('/api/responses/bulk-save', {
    instanceId: 1,
    userId: 1,
    answers: { '42': 'bad' },
  });
  assert.equal(res.status, 400);
  assert.ok(res.body?.error?.includes('Invalid question_id'));
});

// Asserted against the validator directly rather than through the route: a
// question_id that PASSES validation falls through to a DB write, and these
// unit tests run without a database.
test('isValidQuestionId accepts AI turn ids and rejects malformed ones', () => {
  const { isValidQuestionId } = require('../utils/questionId');

  // AI conversation turns are stored under <baseQid>AI<n>.
  assert.equal(isValidQuestionId('2aAI1'), true);
  assert.equal(isValidQuestionId('10cAI27'), true);

  assert.equal(isValidQuestionId('notaqid'), false);
  assert.equal(isValidQuestionId('42'), false);
  assert.equal(isValidQuestionId(''), false);
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
