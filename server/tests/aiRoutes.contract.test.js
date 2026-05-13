const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OPENAI_API_KEY ||= 'test-key';

const express = require('express');

function loadAiRouter({ controllerStubs = {}, codeStubs = {} } = {}) {
  const controllerPath = require.resolve('../ai/controller');
  const codePath = require.resolve('../ai/code');
  const routesPath = require.resolve('../ai/routes');

  delete require.cache[routesPath];

  const controller = require(controllerPath);
  const code = require(codePath);

  const originalController = {};
  const originalCode = {};

  for (const [key, value] of Object.entries(controllerStubs)) {
    originalController[key] = controller[key];
    controller[key] = value;
  }

  for (const [key, value] of Object.entries(codeStubs)) {
    originalCode[key] = code[key];
    code[key] = value;
  }

  const router = require(routesPath);

  return {
    router,
    restore() {
      for (const [key, value] of Object.entries(originalController)) {
        controller[key] = value;
      }
      for (const [key, value] of Object.entries(originalCode)) {
        code[key] = value;
      }
      delete require.cache[routesPath];
    },
  };
}

function createTestServer(overrides) {
  const { router, restore } = loadAiRouter(overrides);

  const app = express();
  app.use(express.json());
  app.use('/api/ai', router);

  const server = http.createServer(app);
  // Avoid waiting on Node's default 5s keep-alive timeout between tiny test requests.
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

async function requestJson(path, { method = 'POST', body, overrides } = {}) {
  const server = await createTestServer(overrides);
  try {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers:
        body === undefined
          ? { Connection: 'close' }
          : { 'Content-Type': 'application/json', Connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body),
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

test('evaluate-code dispatches cpp requests to the C++ handler', async () => {
  let cppCalls = 0;
  let pythonCalls = 0;

  const response = await requestJson('/api/ai/evaluate-code', {
    body: { lang: 'cpp', questionText: 'Q', studentCode: 'int main(){}' },
    overrides: {
      controllerStubs: {
        evaluateCppCode: (_req, res) => {
          cppCalls += 1;
          return res.json({ route: 'cpp' });
        },
        evaluatePythonCode: (_req, res) => {
          pythonCalls += 1;
          return res.json({ route: 'python' });
        },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { route: 'cpp' });
  assert.equal(cppCalls, 1);
  assert.equal(pythonCalls, 0);
});

test('evaluate-code dispatches non-cpp requests to the Python handler', async () => {
  let cppCalls = 0;
  let pythonCalls = 0;

  const response = await requestJson('/api/ai/evaluate-code', {
    body: { lang: 'python', questionText: 'Q', studentCode: 'print(1)' },
    overrides: {
      controllerStubs: {
        evaluateCppCode: (_req, res) => {
          cppCalls += 1;
          return res.json({ route: 'cpp' });
        },
        evaluatePythonCode: (_req, res) => {
          pythonCalls += 1;
          return res.json({ route: 'python' });
        },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { route: 'python' });
  assert.equal(cppCalls, 0);
  assert.equal(pythonCalls, 1);
});

test('evaluate-python-code returns 400 when questionText or studentCode is missing', async () => {
  const response = await requestJson('/api/ai/evaluate-python-code', {
    body: { questionText: 'Missing code' },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Missing question text or student code' });
});

test('evaluate-python-code route returns the stubbed handler payload', async () => {
  const response = await requestJson('/api/ai/evaluate-python-code', {
    body: { questionText: 'Q', studentCode: 'print(1)' },
    overrides: {
      controllerStubs: {
        evaluatePythonCode: (_req, res) =>
          res.json({
            accepted: true,
            feedback: null,
            canContinue: true,
            retryCount: 0,
            retriesRequired: 0,
          }),
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    accepted: true,
    feedback: null,
    canContinue: true,
    retryCount: 0,
    retriesRequired: 0,
  });
});

test('evaluate-cpp-code route returns the stubbed handler payload', async () => {
  const response = await requestJson('/api/ai/evaluate-cpp-code', {
    body: { questionText: 'Q', studentCode: 'int main(){}' },
    overrides: {
      controllerStubs: {
        evaluateCppCode: (_req, res) =>
          res.json({
            accepted: false,
            feedback: 'Add the missing output statement.',
            canContinue: false,
            retryCount: 1,
            retriesRequired: 2,
          }),
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    accepted: false,
    feedback: 'Add the missing output statement.',
    canContinue: false,
    retryCount: 1,
    retriesRequired: 2,
  });
});

test('grade-test-question returns 400 when questionText or scores is missing', async () => {
  const response = await requestJson('/api/ai/grade-test-question', {
    body: { questionText: 'Q only' },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Missing questionText or scores' });
});

test('grade-test-question route returns the stubbed grading payload', async () => {
  const response = await requestJson('/api/ai/grade-test-question', {
    body: { questionText: 'Q', scores: { response: { points: 2 } } },
    overrides: {
      controllerStubs: {
        gradeTestQuestionHttp: (_req, res) =>
          res.json({
            codeScore: 1,
            codeFeedback: null,
            runScore: 0,
            runFeedback: 'Program did not run.',
            responseScore: 2,
            responseFeedback: null,
          }),
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    codeScore: 1,
    codeFeedback: null,
    runScore: 0,
    runFeedback: 'Program did not run.',
    responseScore: 2,
    responseFeedback: null,
  });
});

test('code/repair-markup route returns the stubbed payload', async () => {
  const response = await requestJson('/api/ai/code/repair-markup', {
    body: { docText: '\\question{hi' },
    overrides: {
      codeStubs: {
        repairMarkup: (_req, res) =>
          res.json({
            proposedDocText: '\\question{hi}',
            summary: ['Closed one missing brace.'],
            warnings: [],
          }),
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    proposedDocText: '\\question{hi}',
    summary: ['Closed one missing brace.'],
    warnings: [],
  });
});
