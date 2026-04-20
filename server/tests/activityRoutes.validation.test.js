const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const activityRoutes = require('../activities/routes');

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/activities', activityRoutes);

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

async function request(path) {
  const server = await createTestServer();
  try {
    const response = await fetch(`${server.baseUrl}${path}`);
    const body = await response.json();
    return {
      status: response.status,
      body,
    };
  } finally {
    await server.close();
  }
}

test('sheet preview rejects invalid Google Sheets URLs before Google auth', async () => {
  const response = await request('/api/activities/preview?sheetUrl=not-a-url');

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Invalid sheetUrl format' });
});

test('doc preview rejects invalid Google Docs URLs before Google auth', async () => {
  const response = await request('/api/activities/preview-doc?docUrl=not-a-url');

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Invalid docUrl format' });
});

test('access check reports false for invalid Google URLs before Google auth', async () => {
  const response = await request('/api/activities/check-access?url=not-a-url');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { access: false });
});
