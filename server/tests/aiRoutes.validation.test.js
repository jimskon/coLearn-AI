const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OPENAI_API_KEY ||= 'test-key';

const express = require('express');
const aiRoutes = require('../ai/routes');

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRoutes);

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

test('requirements-only response evaluation rejects keyboard-mash gibberish', async () => {
  const response = await postJson('/api/ai/evaluate-response', {
    questionText: 'What is the output for grade = 95, and what happens for grade = 90?',
    studentAnswer: 'qweqwewqeqwe',
    sampleResponse: 'It prints "Excellent!" for 95 and prints nothing for 90.',
    feedbackPrompt: 'Require both outputs. Reject unrelated output.',
    guidance: 'Follow-ups: gibberish-only\nThis activity uses a requirements-only check.',
    instanceId: 0,
    groupNum: 1,
    answeredByUserId: 13,
    retriesRequired: 0,
    submissionString: 'qweqwewqeqwe',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.accepted, false);
  assert.equal(response.body.canContinue, true);
  assert.equal(typeof response.body.feedback, 'string');
  assert.match(response.body.feedback, /answer|detail|question|response/i);
});

test('requirements-only response evaluation rejects plainly off-prompt text before fail-open', async () => {
  const response = await postJson('/api/ai/evaluate-response', {
    questionText: 'What is the output of the program below? What would the program print if the value of grade was 90?',
    studentAnswer: 'hello dolly',
    sampleResponse: 'It prints "Excellent!" when the grade is 95. It prints nothing when the grade is 90 because the condition is false.',
    feedbackPrompt: 'Require an answer that explicitly states both outputs: that the program prints "Excellent!" for grade = 95, and that it prints nothing for grade = 90. Reject answers that do not mention both cases or that mention unrelated output.',
    guidance: 'Follow-ups: gibberish-only\nThis activity uses a requirements-only check.\nChecker errors should not block progress (fail-open on errors).',
    codeContext: 'grade = 95\nif grade >= 94:\n   print("Excellent!")',
    instanceId: 0,
    groupNum: 1,
    answeredByUserId: 15,
    retriesRequired: 0,
    submissionString: 'hello dolly',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.accepted, false);
  assert.equal(response.body.canContinue, true);
  assert.equal(typeof response.body.feedback, 'string');
  assert.match(response.body.feedback, /answer|detail|question|response/i);
});
