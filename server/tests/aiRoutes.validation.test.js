const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

// A NON-placeholder key on purpose. This file intercepts global.fetch (below)
// so nothing leaves the machine, and it needs the real OpenAI client to be
// constructed so those interceptions are reached. 'test-key' now selects the
// stub client, which would bypass the scripted responses these tests rely on.
// Set unconditionally, not with ||=, so an ambient OPENAI_API_KEY=test-key in
// the CI environment cannot select the stub out from under these tests.
process.env.OPENAI_API_KEY = 'live-test-key';

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

// Requiring ../db creates a mysql2 pool at import time (db.js:11). This file
// needs the module in order to stub db.query, but several tests exercise routes
// that issue a REAL query before the stub is installed. On a machine where MySQL
// is actually reachable those connections succeed and sit idle in the pool,
// whose open socket keeps the event loop alive -- so `node --test` finishes every
// test and then hangs forever instead of exiting.
//
// Every *.db.test.js already closes the pool on teardown; this was the one file
// that did not. That is why the suite appeared to freeze immediately AFTER the
// AI route tests passed rather than during any of them, and why it only froze on
// a machine with a working database.
test.after(async () => {
  try {
    await db.end();
  } catch {
    // The pool may never have connected; nothing to close.
  }
});

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

test('inline AI uses an allowed per-block model and defaults unsupported values safely', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalCreate = __testHooks.openai.responses.create;
  const requests = [];
  process.env.OPENAI_API_KEY = 'live-test-key';
  __testHooks.openai.responses.create = async (request) => {
    requests.push(request);
    return {
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Try tracing the value through the loop.' }],
      }],
    };
  };

  try {
    const commonBody = {
      mode: 'explain',
      title: 'AI Coach',
      assistantPrompt: 'Help with the loop.',
      studentInput: 'Why does total change?',
    };

    const explicit = await postJson('/api/ai/assist', {
      ...commonBody,
      model: 'gpt-4o-mini',
    });
    const fallback = await postJson('/api/ai/assist', {
      ...commonBody,
      model: 'not-a-model',
    });

    assert.equal(explicit.status, 200);
    assert.equal(fallback.status, 200);
    assert.equal(explicit.body.response, 'Try tracing the value through the loop.');
    assert.equal(requests[0].model, 'gpt-4o-mini');
    assert.equal(requests[1].model, 'gpt-5-mini');
    assert.equal(requests[1].max_output_tokens, 1600);
    assert.deepEqual(requests[1].reasoning, { effort: 'minimal' });
  } finally {
    __testHooks.openai.responses.create = originalCreate;
    process.env.OPENAI_API_KEY = originalApiKey;
  }
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
  const originalCreate = __testHooks.openai.chat.completions.create;
  __testHooks.openai.chat.completions.create = async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          accepted: false,
          feedback: 'Please answer the question with one concrete detail.',
        }),
      },
    }],
  });

  try {
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
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
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

test('a revise decision retains feedback when the author uses feedbackprompt none', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  __testHooks.openai.chat.completions.create = async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          decision: 'revise',
          feedback: 'The bottom compartment should list operations or methods.',
          revision_requirement: 'Identify the bottom UML compartment as operations or methods.',
          revision_severity: 'normal',
        }),
      },
    }],
  });

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'What is recorded in the top, middle, and bottom compartments of a UML class box?',
      studentAnswer: 'top: class name; middle: attributes; bottom: love',
      sampleResponse: 'Top: class name. Middle: attributes. Bottom: operations.',
      feedbackPrompt: 'none',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 15,
      retriesRequired: 1,
      submissionString: 'uml-box-wrong-bottom',
      dryRun: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.accepted, false);
    assert.equal(response.body.decision, 'revise');
    assert.equal(response.body.canContinue, false);
    assert.match(response.body.feedback, /bottom compartment/i);
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
});

test('keyboard-mash is rejected for ordinary activities before a permissive model can accept it', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  let modelCalls = 0;
  __testHooks.openai.chat.completions.create = async () => {
    modelCalls += 1;
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            decision: 'accepted',
            feedback: 'This deliberately permissive mock must not be reached.',
          }),
        },
      }],
    };
  };

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'Which information belongs to an object rather than its class?',
      studentAnswer: 'sdsad',
      feedbackPrompt: 'Distinguish the class blueprint from object-specific values.',
      guidance: 'Accept equivalent wording and do not be picky.',
      activityAiMode: 'positive',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 1,
      submissionString: 'sdsad',
      dryRun: true,
    });

    assert.equal(modelCalls, 0);
    assert.equal(response.status, 200);
    assert.equal(response.body.decision, 'revise');
    assert.equal(response.body.accepted, false);
    assert.equal(response.body.canContinue, false);
    assert.match(response.body.feedback, /complete response|relevant idea/i);
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
});

test('lenient activity guidance produces the two-state, non-picky evaluation policy', async () => {
  const prompt = await buildStudentResponsePrompt({
    questionText: 'Which class is the superclass, and which classes are specialized?',
    studentAnswer: 'The hollow arrow points to the superclass.',
    feedbackPrompt: 'Identify the general class and the specialized classes.',
    guidance: "Accept anything that is not completely wrong. Don't be picky; accept equivalent wording.",
    instanceId: 0,
    qid: '1b',
    retriesRequired: 2,
  });

  assert.match(prompt.sys, /LENIENT ACCEPTANCE POLICY/i);
  assert.match(prompt.sys, /accepted or revise/i);
  assert.match(prompt.sys, /DECISION CONSISTENCY RULE/i);
  assert.match(prompt.user, /"decision":"accepted"\|"revise"/i);
  assert.match(prompt.user, /retry policy/i);
});

test('permissive question feedback accepts an on-track core answer without optional elaboration', async () => {
  const prompt = await buildStudentResponsePrompt({
    questionText: 'What difference in object lifetime separates aggregation and composition?',
    studentAnswer: 'In composition, parts normally die with the whole; aggregation parts can remain independently.',
    feedbackPrompt: 'Be permissive. If the answer is mostly on track, give positive feedback, briefly explain anything missing or unclear, and move on.',
    guidance: '',
    instanceId: 0,
    qid: '4a',
    retriesRequired: 3,
  });

  assert.match(prompt.sys, /LENIENT ACCEPTANCE POLICY/i);
  assert.match(prompt.sys, /set decision=accepted and let the group move on/i);
  assert.match(prompt.user, /must be accepted now; do not spend retries on optional elaboration/i);
});

test('lenient guidance does not override a revise result', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  __testHooks.openai.chat.completions.create = async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          decision: 'revise',
          feedback: 'Good start — also name the specialized classes.',
          revision_requirement: 'Name the specialized classes.',
          revision_severity: 'normal',
        }),
      },
    }],
  });

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'Which class is the superclass, and which classes are specialized?',
      studentAnswer: 'The hollow arrow points to the superclass.',
      feedbackPrompt: 'Identify the general class and the specialized classes.',
      guidance: "Accept anything that is not completely wrong. Don't be picky; accept equivalent wording.",
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 0,
      submissionString: 'The hollow arrow points to the superclass.',
      dryRun: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.decision, 'revise');
    assert.equal(response.body.accepted, false);
    assert.equal(response.body.canContinue, true);
    assert.match(response.body.feedback, /specialized classes/i);
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
});

test('aimode lenient does not override a revise result without wording heuristics', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  __testHooks.openai.chat.completions.create = async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          decision: 'revise',
          feedback: 'Good start — add a little more detail.',
          revision_requirement: 'Add the remaining lifetime detail.',
          revision_severity: 'normal',
        }),
      },
    }],
  });

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'Explain aggregation and composition.',
      studentAnswer: 'Aggregation can exist independently; composition is owned.',
      feedbackPrompt: 'Explain the lifetime distinction.',
      guidance: '',
      activityAiMode: 'lenient',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 3,
      submissionString: 'Aggregation can exist independently; composition is owned.',
      dryRun: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.decision, 'revise');
    assert.equal(response.body.accepted, false);
    assert.equal(response.body.canContinue, false);
    assert.match(response.body.feedback, /concrete detail|lifetime/i);
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
});

test('activity-level aimode positive preserves accepted feedback', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  __testHooks.openai.chat.completions.create = async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          decision: 'accepted',
          feedback: 'Excellent reasoning.',
        }),
      },
    }],
  });

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'Explain the lifetime distinction.',
      studentAnswer: 'Aggregation parts can exist independently; composition parts normally cannot.',
      feedbackPrompt: 'positive-feedback',
      guidance: 'positive-feedback',
      activityAiMode: 'positive',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 3,
      submissionString: 'Aggregation parts can exist independently; composition parts normally cannot.',
      dryRun: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.decision, 'accepted');
    assert.equal(response.body.accepted, true);
    assert.equal(response.body.feedback, 'Excellent reasoning.');
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
});

test('activity-level aimode positive supplies a green confirmation when the model omits one', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  __testHooks.openai.chat.completions.create = async () => ({
    choices: [{ message: { content: JSON.stringify({ decision: 'accepted', feedback: null }) } }],
  });

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'Explain the lifetime distinction.',
      studentAnswer: 'Aggregation parts can exist independently; composition parts normally cannot.',
      feedbackPrompt: 'none',
      guidance: 'Accept correct answers.',
      activityAiMode: 'positive',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 3,
      submissionString: 'Aggregation parts can exist independently; composition parts normally cannot.',
      dryRun: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.decision, 'accepted');
    assert.equal(response.body.accepted, true);
    assert.equal(response.body.feedback, 'Good work — your response addresses the question.');
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
});

test('a revise result stays yellow even when retries allow the explicit Continue choice', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  __testHooks.openai.chat.completions.create = async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          decision: 'revise',
          revision_requirement: 'State what happens for grade = 90.',
          revision_severity: 'normal',
          feedback: 'Good start. Also state what happens when grade is 90.',
        }),
      },
    }],
  });

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'What happens for grade = 95 and grade = 90?',
      studentAnswer: 'It prints Excellent! for 95.',
      feedbackPrompt: 'Require both cases.',
      guidance: '',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 0,
      submissionString: 'It prints Excellent! for 95.',
      dryRun: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.decision, 'revise');
    assert.equal(response.body.accepted, false);
    assert.equal(response.body.canContinue, true);
    assert.equal(response.body.feedback, 'Good start. Also state what happens when grade is 90.');
    assert.equal(Object.hasOwn(response.body, 'autoAdvanced'), false);
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
});

test('a table heading ending in a question mark is evaluated, not treated as a student help question', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  let modelCalls = 0;
  __testHooks.openai.chat.completions.create = async () => {
    modelCalls += 1;
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            decision: 'revise',
            feedback: 'Optional elaboration.',
            revision_requirement: 'Add the optional lifetime detail.',
            revision_severity: 'normal',
          }),
        },
      }],
    };
  };

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'Choose aggregation or composition and justify each choice.',
      studentAnswer: [
        '### Aggregation or Composition',
        '| Example | Aggregation or Composition? | Why? |',
        '| Team and Player | Aggregation | Players can exist independently. |',
        '| House and Room | Composition | A room depends on the house. |',
      ].join('\n'),
      feedbackPrompt: 'Accept reasonable lifetime reasoning.',
      guidance: '',
      activityAiMode: 'no-positive,lenient',
      hasTableResponse: true,
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 3,
      submissionString: 'table answer',
      dryRun: true,
    });

    assert.equal(modelCalls, 1);
    assert.equal(response.status, 200);
    assert.equal(response.body.decision, 'revise');
    assert.equal(response.body.accepted, false);
    assert.equal(response.body.canContinue, false);
    assert.equal(response.body.feedback, 'Optional elaboration.');
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
});

test('an unstructured legacy rejection stays revise even in lenient mode', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  __testHooks.openai.chat.completions.create = async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          decision: 'blocked',
          feedback: 'Your reasoning is mostly clear; consider mentioning ownership.',
        }),
      },
    }],
  });

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'Explain the object-lifetime distinction.',
      studentAnswer: 'Aggregation parts can remain independently; composition parts depend on the whole.',
      feedbackPrompt: 'Accept reasonable lifetime reasoning.',
      guidance: '',
      activityAiMode: 'lenient,no-positive',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 3,
      submissionString: 'a relevant explanation',
      dryRun: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.decision, 'revise');
    assert.equal(response.body.accepted, false);
    assert.match(response.body.feedback, /ownership/i);
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
});

test('a structured serious revise result remains a revise result in lenient mode', async () => {
  const originalCreate = __testHooks.openai.chat.completions.create;
  __testHooks.openai.chat.completions.create = async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          decision: 'revise',
          revision_requirement: 'Correct the reversed lifetime relationship.',
          revision_severity: 'serious',
          feedback: 'This reverses the lifetime relationship between aggregation and composition.',
        }),
      },
    }],
  });

  try {
    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'Explain the object-lifetime distinction.',
      studentAnswer: 'Aggregation deletes all parts while composition always preserves them.',
      feedbackPrompt: 'Accept reasonable lifetime reasoning.',
      guidance: '',
      activityAiMode: 'lenient,no-positive',
      instanceId: 0,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 3,
      submissionString: 'reversed explanation',
      dryRun: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.decision, 'revise');
    assert.equal(response.body.accepted, false);
  } finally {
    __testHooks.openai.chat.completions.create = originalCreate;
  }
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


test('explicit responsemode questions routes to the question-list scorer', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('api.openai.com')) {
      throw new Error('OpenAI should not be called when responseMode is questions');
    }
    return originalFetch(input, init);
  };

  try {
    const answerLines = [
      'What symptoms should we ask about?',
      'How long has this been going on?',
      'What makes it better or worse?',
      'Have you taken any medicine?',
      'Have you had this before?',
    ];

    const response = await postJson('/api/ai/evaluate-response', {
      questionText: 'Interview prep task',
      responseMode: 'questions',
      studentAnswer: answerLines.join('\n'),
      sampleResponse: '',
      feedbackPrompt: 'Ask clear and relevant questions.',
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

test('accepted-history short-circuit honors activity-level positive feedback', async () => {
  const originalQuery = db.query;
  const originalFetch = global.fetch;

  db.query = async () => [[
    { question_id: '1aAF', response: 'resolved' },
    { question_id: '1aFM', response: 'accepted' },
    { question_id: '1aS', response: 'complete' },
  ]];

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
      activityAiMode: 'positive',
      instanceId: 123,
      groupNum: 1,
      answeredByUserId: 13,
      retriesRequired: 0,
      submissionString: 'I changed my answer, but this question was already accepted.',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.accepted, true);
    assert.equal(response.body.decision, 'accepted');
    assert.equal(response.body.feedback, 'Good work - your response addresses the question.');
  } finally {
    db.query = originalQuery;
    global.fetch = originalFetch;
  }
});
