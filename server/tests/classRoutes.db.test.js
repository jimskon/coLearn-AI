const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const classRoutes = require('../classes/routes');
const db = require('../db');

function uniqueName(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/classes', classRoutes);

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

async function requestJson(path, { method = 'GET', body } = {}) {
  const server = await createTestServer();
  try {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody = response.status === 204 ? null : await response.json();
    return {
      status: response.status,
      body: responseBody,
    };
  } finally {
    await server.close();
  }
}

test.after(async () => {
  await db.end();
});

test('class routes create, list, update, fetch, and delete a class', async () => {
  const name = uniqueName('Intro CS');
  const description = 'Collaborative intro course';

  const create = await requestJson('/api/classes', {
    method: 'POST',
    body: {
      name,
      description,
      createdBy: null,
    },
  });

  assert.equal(create.status, 201);
  assert.equal(create.body.name, name);
  assert.equal(create.body.description, description);
  assert.equal(create.body.created_by, null);
  assert.equal(typeof create.body.id, 'number');

  const list = await requestJson('/api/classes');
  assert.equal(list.status, 200);
  assert.ok(list.body.some(row => row.id === create.body.id && row.name === name));

  const updatedName = `${name} Updated`;
  const updatedDescription = 'Updated collaborative intro course';
  const update = await requestJson(`/api/classes/${create.body.id}`, {
    method: 'PUT',
    body: {
      name: updatedName,
      description: updatedDescription,
    },
  });

  assert.equal(update.status, 200);
  assert.deepEqual(update.body, {
    id: String(create.body.id),
    name: updatedName,
    description: updatedDescription,
  });

  const fetchOne = await requestJson(`/api/classes/${create.body.id}`);
  assert.equal(fetchOne.status, 200);
  assert.equal(fetchOne.body.id, create.body.id);
  assert.equal(fetchOne.body.name, updatedName);
  assert.equal(fetchOne.body.description, updatedDescription);

  const remove = await requestJson(`/api/classes/${create.body.id}`, {
    method: 'DELETE',
  });
  assert.equal(remove.status, 204);

  const fetchDeleted = await requestJson(`/api/classes/${create.body.id}`);
  assert.equal(fetchDeleted.status, 404);
  assert.deepEqual(fetchDeleted.body, { error: 'Class not found' });
});
