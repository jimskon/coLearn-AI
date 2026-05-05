const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const test = require('node:test');

const express = require('express');

function loadActivityRouter({ sheetsGet, docsGet, authorizeImpl } = {}) {
  const googleAuthPath = require.resolve('../utils/googleAuth');
  const routesPath = require.resolve('../activities/routes');

  const fakeGoogleApis = {
    google: {
      sheets: () => ({
        spreadsheets: {
          values: {
            get: sheetsGet || (async () => ({ data: { values: [] } })),
          },
        },
      }),
      docs: () => ({
        documents: {
          get: docsGet || (async () => ({ data: { body: { content: [] } } })),
        },
      }),
    },
  };
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'googleapis') {
      return fakeGoogleApis;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[googleAuthPath];
  delete require.cache[routesPath];

  const googleAuth = require(googleAuthPath);
  const originalAuthorize = googleAuth.authorize;
  googleAuth.authorize = authorizeImpl || (() => ({ fake: true }));

  let router;
  try {
    router = require(routesPath);
  } finally {
    Module._load = originalLoad;
  }

  return {
    router,
    restore() {
      googleAuth.authorize = originalAuthorize;
      delete require.cache[googleAuthPath];
      delete require.cache[routesPath];
    },
  };
}

function createTestServer(overrides = {}) {
  const { router, restore } = loadActivityRouter(overrides);

  const app = express();
  app.use(express.json());
  app.use('/api/activities', router);

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

async function request(path, { overrides } = {}) {
  const server = await createTestServer(overrides);
  try {
    const response = await fetch(`${server.baseUrl}${path}`, {
      headers: { Connection: 'close' },
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
    };
  } finally {
    await server.close();
  }
}

test('sheet preview returns values from the stubbed Google Sheets client', async () => {
  const response = await request(
    '/api/activities/preview?sheetUrl=https://docs.google.com/spreadsheets/d/1234567890123456789012345/edit',
    {
      overrides: {
        sheetsGet: async ({ spreadsheetId, range }) => ({
          data: { values: [[spreadsheetId, range], ['A1', 'B1']] },
        }),
      },
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    data: [['1234567890123456789012345', 'Sheet1'], ['A1', 'B1']],
  });
});

test('sheet preview returns 500 when the Google Sheets client throws', async () => {
  const response = await request(
    '/api/activities/preview?sheetUrl=https://docs.google.com/spreadsheets/d/1234567890123456789012345/edit',
    {
      overrides: {
        sheetsGet: async () => {
          throw new Error('sheets unavailable');
        },
      },
    }
  );

  assert.equal(response.status, 500);
  assert.equal(response.body, null);
});

test('doc preview returns flattened paragraph lines from the stubbed Google Docs client', async () => {
  const response = await request(
    '/api/activities/preview-doc?docUrl=https://docs.google.com/document/d/1234567890123456789012345/edit',
    {
      overrides: {
        docsGet: async ({ documentId }) => ({
          data: {
            body: {
              content: [
                {
                  paragraph: {
                    elements: [
                      { textRun: { content: `Line 1 from ${documentId}\n` } },
                    ],
                  },
                },
                {
                  paragraph: {
                    elements: [
                      { textRun: { content: 'Line 2' } },
                      { textRun: { content: '\n' } },
                    ],
                  },
                },
              ],
            },
          },
        }),
      },
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    lines: ['Line 1 from 1234567890123456789012345', 'Line 2'],
  });
});

test('doc preview returns 500 with details when the Google Docs client throws', async () => {
  const response = await request(
    '/api/activities/preview-doc?docUrl=https://docs.google.com/document/d/1234567890123456789012345/edit',
    {
      overrides: {
        docsGet: async () => {
          throw new Error('docs unavailable');
        },
      },
    }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    error: 'Failed to read Google Doc',
    details: 'docs unavailable',
  });
});

test('access check returns true when the stubbed docs lookup succeeds', async () => {
  const response = await request(
    '/api/activities/check-access?url=https://docs.google.com/document/d/1234567890123456789012345/edit',
    {
      overrides: {
        docsGet: async () => ({ data: { title: 'ok' } }),
      },
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { access: true });
});

test('access check returns false when the stubbed docs lookup throws', async () => {
  const response = await request(
    '/api/activities/check-access?url=https://docs.google.com/document/d/1234567890123456789012345/edit',
    {
      overrides: {
        docsGet: async () => {
          throw new Error('forbidden');
        },
      },
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { access: false });
});
