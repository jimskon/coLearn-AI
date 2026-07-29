const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OPENAI_API_KEY ||= 'test-key';

const nativeFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || '';

  if (url.includes('api.openai.com')) {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                accepted: false,
                feedback: 'Please answer the question with one concrete detail.',
              }),
            },
            finish_reason: 'stop',
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return nativeFetch(input, init);
};

const express = require('express');
const aiRoutes = require('../ai/routes');
const {
  buildStudentResponsePrompt,
  __testHooks,
} = require('../ai/controller');
const db = require('../db');

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRoutes);

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

async function postJson(path, body) {
  const server = await createTestServer();
  try {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
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

async function getRequestBodyText(input, init) {
  if (init?.body) {
    return String(init.body);
  }

  if (typeof input === 'object' && typeof input?.clone === 'function') {
    try {
      return await input.clone().text();
    } catch {
      try {
        return await input.text();
      } catch {
        return '';
      }
    }
  }

  return '';
}

test.after(() => {
  global.fetch = nativeFetch;
});

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

test('dry-run response evaluation skips persistent retry bookkeeping', async () => {
  const response = await postJson('/api/ai/evaluate-response', {
    questionText: 'What does this program print?',
    studentAnswer: 'not sure',
    sampleResponse: 'It prints hello.',
    feedbackPrompt: 'Require the printed output.',
    guidance: 'Follow-ups: default',
    instanceId: 999999,
    groupNum: 1,
    answeredByUserId: 15,
    retriesRequired: 2,
    submissionString: 'not sure',
    dryRun: true,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.accepted, false);
  assert.equal(response.body.canContinue, false);
  assert.equal(response.body.retryCount, 0);
  assert.equal(response.body.retriesRequired, 2);
  assert.equal(typeof response.body.feedback, 'string');
});

test('response evaluation includes prior attempts in the prompt when history exists', async () => {
  const originalQuery = db.query;

  db.query = async (sql) => {
    if (String(sql).includes('FROM responses')) {
      return [[
        {
          id: 11,
          submit_id: 'submit-1',
          question_id: '1a',
          response_type: 'text',
          response: 'blue',
          answered_by_user_id: 7,
          submitted_at: '2026-06-29 10:00:00',
          updated_at: '2026-06-29 10:00:00',
        },
        {
          id: 12,
          submit_id: 'submit-1',
          question_id: '1aResponseFeedback',
          response_type: 'text',
          response: 'Try mentioning the loop.',
          answered_by_user_id: 7,
          submitted_at: '2026-06-29 10:00:01',
          updated_at: '2026-06-29 10:00:01',
        },
        {
          id: 13,
          submit_id: 'submit-2',
          question_id: '1a',
          response_type: 'text',
          response: 'it repeats',
          answered_by_user_id: 7,
          submitted_at: '2026-06-29 10:01:00',
          updated_at: '2026-06-29 10:01:00',
        },
        {
          id: 14,
          submit_id: 'submit-2',
          question_id: '1aResponseFeedback',
          response_type: 'text',
          response: 'You are close, but explain why.',
          answered_by_user_id: 7,
          submitted_at: '2026-06-29 10:01:01',
          updated_at: '2026-06-29 10:01:01',
        },
        {
          id: 15,
          submit_id: 'submit-2',
          question_id: '1state',
          response_type: 'text',
          response: 'ignored metadata',
          answered_by_user_id: 7,
          submitted_at: '2026-06-29 10:01:02',
          updated_at: '2026-06-29 10:01:02',
        },
        {
          id: 16,
          submit_id: 'submit-3',
          question_id: '1b',
          response_type: 'text',
          response: 'ignored different question',
          answered_by_user_id: 7,
          submitted_at: '2026-06-29 10:02:00',
          updated_at: '2026-06-29 10:02:00',
        },
      ]];
    }

    return [[], []];
  };

  try {
    const prompt = await buildStudentResponsePrompt({
      qid: '1a',
      questionText: 'What does the loop do?',
      studentAnswer: 'it keeps repeating',
      sampleResponse: 'It repeats until the condition changes.',
      feedbackPrompt: 'Focus on the repetition.',
      guidance: 'Follow-ups: default',
      instanceId: 101,
      followupPrompt: '',
      codeContext: '',
      historyLimit: 5,
    });

    const userMessage = prompt.user || '';
    assert.match(userMessage, /Prior group attempts for this question/i);
    assert.match(userMessage, /Group answer: blue/i);
    assert.match(userMessage, /AI feedback already given: Try mentioning the loop/i);
    assert.match(userMessage, /AI feedback already given: You are close, but explain why/i);
    assert.match(userMessage, /Current group attempt number: 3/i);
    assert.match(userMessage, /Treat this as one collaborative group conversation/i);
    assert.match(userMessage, /lower bound is enough/i);
    assert.match(userMessage, /tell them exactly what to add/i);
    assert.doesNotMatch(userMessage, /ignored metadata/i);
    assert.doesNotMatch(userMessage, /ignored different question/i);
  } finally {
    db.query = originalQuery;
  }
});

test('response evaluation answers a clear in-domain question before grading', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  const aiReply = 'A loop stops when its condition becomes false, so check which value changes each time through.';
  let aiCalledForQuestionHelp = false;
  __testHooks.openai.chat.completions.create = async (body) => {
    const userMessage = (body?.messages || []).find((msg) => msg?.role === 'user')?.content || '';
    if (userMessage.includes('Student clarifying question:')) {
      aiCalledForQuestionHelp = true;
      return {
        id: 'chatcmpl-test-help',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: aiReply,
            },
            finish_reason: 'stop',
          },
        ],
      };
    }
    return {
      id: 'chatcmpl-test-default',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify({
              accepted: false,
              feedback: 'Please answer the question with one concrete detail.',
            }),
          },
          finish_reason: 'stop',
        },
      ],
    };
  };

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'What does the loop do?',
      studentAnswer: 'I think it repeats because of the condition. Why does it stop there?',
      sampleResponse: 'It repeats until the condition changes.',
      feedbackPrompt: 'Focus on the repetition.',
      guidance: 'Follow-ups: default',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 0,
      submissionString: 'I think it repeats because of the condition. Why does it stop there?',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.accepted, false);
    assert.equal(aiCalledForQuestionHelp, true);
    assert.equal(response.body.feedback, aiReply);
    assert.notEqual(
      response.body.feedback,
      'This system only works in the context of its learning objectives.'
    );
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
});

test('response evaluation returns the exact fallback for an obvious off-topic question', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('api.openai.com')) {
      throw new Error('OpenAI should not be called for an obvious off-topic question');
    }
    return originalFetch(input, init);
  };

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'What does the loop do?',
      studentAnswer: 'I am confused. What is the weather today?',
      sampleResponse: 'It repeats until the condition changes.',
      feedbackPrompt: 'Focus on the repetition.',
      guidance: 'Follow-ups: default',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 0,
      submissionString: 'I am confused. What is the weather today?',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.accepted, false);
    assert.equal(
      response.body.feedback,
      'This system only works in the context of its learning objectives.'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('response evaluation accepts a well-formed question list without an extra ai call', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('api.openai.com')) {
      throw new Error('OpenAI should not be called for question-list prompts');
    }
    return originalFetch(input, init);
  };

  try {
    const answerLines = [
      'How long has Kim had this fever?',
      'What date did Kim’s fever start?',
      'What other symptoms has Kim had, and when did they start?',
      'Where did Kim travel?',
      'Does Kim have difficulty breathing?',
    ];

    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'What additional questions would your group ask Kim to better understand Kim’s situation? List at least five clear questions (one short question per line).',
      studentAnswer: answerLines.join('\n'),
      sampleResponse: '',
      feedbackPrompt: 'Focus on asking clear, relevant questions.',
      guidance: 'Follow-ups: default',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 0,
      submissionString: answerLines.join('\n'),
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.accepted, true);
    assert.equal(response.body.feedback, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('response evaluation short-circuits when the question is already accepted', async () => {
  const originalQuery = db.query;
  const originalFetch = global.fetch;

  db.query = async (sql) => {
    if (String(sql).includes('FROM responses')) {
      return [[
        {
          id: 11,
          question_id: '1a',
          response_type: 'text',
          response: 'already accepted answer',
          answered_by_user_id: 7,
        },
        {
          id: 12,
          question_id: '1aFM',
          response_type: 'text',
          response: 'accepted',
          answered_by_user_id: 7,
        },
      ]];
    }

    return originalQuery(sql);
  };

  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('api.openai.com')) {
      throw new Error('OpenAI should not be called for an accepted question');
    }
    return originalFetch(input, init);
  };

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      qid: '1a',
      questionText: 'What does the loop do?',
      studentAnswer: 'I changed my answer, but this question was already accepted.',
      sampleResponse: 'It repeats until the condition changes.',
      feedbackPrompt: 'Focus on the repetition.',
      guidance: 'Follow-ups: default',
      instanceId: 123,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 0,
      submissionString: 'I changed my answer, but this question was already accepted.',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.accepted, true);
    assert.equal(response.body.feedback, null);
  } finally {
    db.query = originalQuery;
    global.fetch = originalFetch;
  }
});
