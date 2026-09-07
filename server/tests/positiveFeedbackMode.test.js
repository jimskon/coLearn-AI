'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const { buildStudentResponsePrompt } = require('../ai/controller');

/*
 * \aimode{positive} governs praise everywhere, not just on accepted answers.
 *
 * The prompt used to instruct the model, unconditionally, to open a rejection
 * with "Good start. Can you add..." -- so an instructor who had left positive
 * feedback off still got their students told a wrong answer was a good start.
 * In Swedish: "Bra start! Men ni behöver...". That is the one place praise
 * reads as hollow, because the group can see it is not true.
 */

const BASE = {
  questionText: 'Name the tools needed to shape a nail.',
  studentAnswer: 'A file.',
  feedbackPrompt: 'They must name a shaping tool and protective equipment.',
  guidance: '',
  classGuidance: '',
  instanceId: null,
  qid: '1a',
};

async function instructionsFor(overrides) {
  const { sys } = await buildStudentResponsePrompt({ ...BASE, ...overrides });
  return sys;
}

// The sentence that hands the model a praise opener to use. Matching on the
// bare phrases would be wrong: the prohibition quotes them too, deliberately,
// so the model knows exactly what it is being told not to say.
const PRAISE_INSTRUCTION = "use warm, collaborative language. Prefer";
const PRAISE_OPENERS = ['Good start', "You're on the right track"];

test('without \\aimode{positive}, the prompt never asks for a praise opener', async () => {
  const sys = await instructionsFor({ activityAiMode: '', questionAiMode: '' });
  assert.ok(!sys.includes(PRAISE_INSTRUCTION), 'the model is still being handed a praise opener');
  assert.match(sys, /Do NOT open with praise/,
    'it must be told not to, rather than merely not told to');
});

test('the rejection instruction stays courteous, not blunt', async () => {
  // Removing praise must not turn into criticising the group. The complaint
  // was hollow encouragement, not an absence of manners.
  const sys = await instructionsFor({ activityAiMode: '', questionAiMode: '' });
  assert.match(sys, /courteous and matter-of-fact/);
  assert.match(sys, /Do not blame either/);
});

test('with \\aimode{positive}, the warm opener comes back', async () => {
  const sys = await instructionsFor({ activityAiMode: 'positive' });
  assert.ok(sys.includes(PRAISE_INSTRUCTION), 'positive mode should still allow an encouraging opening');
  assert.ok(PRAISE_OPENERS.every((phrase) => sys.includes(phrase)));
  assert.ok(!sys.includes('Do NOT open with praise'), 'the prohibition must not also be present');
});

test('a question-level \\aimode{positive} is enough on its own', async () => {
  const sys = await instructionsFor({ activityAiMode: '', questionAiMode: 'positive' });
  assert.ok(sys.includes(PRAISE_INSTRUCTION));
});

test('accepted answers still get no praise field when positive is off', async () => {
  const { positiveEnabled, sys } = await buildStudentResponsePrompt({
    ...BASE, activityAiMode: '', questionAiMode: '',
  });
  assert.equal(positiveEnabled, false);
  assert.match(sys, /feedback must be null when positive feedback is disabled/);
  assert.match(sys, /do not use the feedback field to praise/);
});

test('positive mode is reported as enabled so the rest of the pipeline agrees', async () => {
  const { positiveEnabled } = await buildStudentResponsePrompt({
    ...BASE, activityAiMode: 'positive',
  });
  assert.equal(positiveEnabled, true);
});
