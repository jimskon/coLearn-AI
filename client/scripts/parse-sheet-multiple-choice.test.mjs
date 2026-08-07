import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSurveyMultipleChoice,
  parseMultipleChoiceSelections,
  serializeMultipleChoiceSelections,
  validateMultipleChoice,
} from '../src/utils/multipleChoice.js';
import {
  getMultipleChoiceTestModeIssueMessage,
  getUnsupportedScoreTypeMessage,
  parseScoreCommand,
} from '../src/utils/scoreValidation.js';

test('accepts canonical actual answer values', () => {
  const result = validateMultipleChoice(' Ottawa ', ['Toronto', 'Ottawa', 'Montreal']);
  assert.equal(result.correctAnswer, 'Ottawa');
  assert.deepEqual(result.errors, []);
});

test('rejects multiple-choice blocks with fewer than two choices', () => {
  const result = validateMultipleChoice('Only choice', ['Only choice']);
  assert.match(result.errors.join('\n'), /at least two/i);
});

test('rejects duplicate choices and a declared answer that is not a choice', () => {
  const result = validateMultipleChoice('Correct', ['Repeated', 'Repeated']);
  const messages = result.errors.join('\n');
  assert.match(messages, /duplicate/i);
  assert.match(messages, /must exactly match/i);
});

test('accepts a blank answer for survey multiple-choice questions', () => {
  const result = validateMultipleChoice('', ['Often', 'Sometimes', 'Never']);
  assert.equal(result.correctAnswer, '');
  assert.deepEqual(result.errors, []);
});

test('accepts self-scoring choices, including partial credit', () => {
  const result = validateMultipleChoice('', [
    { value: 'Incorrect', points: 0 },
    { value: 'Partly correct', points: 1 },
    { value: 'Correct', points: 2 },
  ]);
  assert.equal(result.hasChoiceScores, true);
  assert.equal(result.maxChoicePoints, 2);
  assert.deepEqual(result.errors, []);
});

test('requires every choice to have points when multiple choice is self-scoring', () => {
  const result = validateMultipleChoice('', [
    { value: 'Incorrect', points: 0 },
    { value: 'Correct', points: null },
  ]);
  assert.match(result.errors.join('\n'), /every.*choice/i);
});

test('rejects a blank choice', () => {
  const result = validateMultipleChoice('', ['Correct', '']);
  const messages = result.errors.join('\n');
  assert.match(messages, /non-empty/i);
});

test('identifies a blank-answer choice block as a survey', () => {
  assert.equal(isSurveyMultipleChoice({
    multipleChoice: { correctAnswer: '', choices: [{ value: 'Often' }, { value: 'Never' }] },
  }), true);
  assert.equal(isSurveyMultipleChoice({
    multipleChoice: { correctAnswer: 'Often', choices: [{ value: 'Often' }, { value: 'Never' }] },
  }), false);
  assert.equal(isSurveyMultipleChoice({
    multipleChoice: {
      correctAnswer: '',
      hasChoiceScores: true,
      choices: [{ value: 'Often', points: 1 }, { value: 'Never', points: 0 }],
    },
  }), false);
});

test('round-trips multi-select survey choices without treating malformed values as selections', () => {
  const stored = serializeMultipleChoiceSelections(['Code tracing', 'Discussion', 'Code tracing']);
  assert.equal(stored, '["Code tracing","Discussion"]');
  assert.deepEqual(parseMultipleChoiceSelections(stored), ['Code tracing', 'Discussion']);
  assert.deepEqual(parseMultipleChoiceSelections('Code tracing'), []);
});

test('parses only supported score types and preserves unsupported ones for validation', () => {
  assert.deepEqual(parseScoreCommand('\\score{2,response}'), {
    points: 2,
    type: 'response',
    supported: true,
  });

  assert.deepEqual(parseScoreCommand('\\score{2,choice}'), {
    points: 2,
    type: 'choice',
    supported: false,
  });

  assert.equal(
    getUnsupportedScoreTypeMessage('choice'),
    'Unsupported \\score type "choice". Multiple-choice questions should use \\score{points,response}.',
  );
});

test('allows surveys and self-scoring choices in test mode', () => {
  assert.equal(
    getMultipleChoiceTestModeIssueMessage({
      isTest: true,
      hasMultipleChoice: true,
      correctAnswer: '',
      hasResponseScore: false,
      hasChoiceScores: false,
    }),
    null,
  );

  assert.equal(
    getMultipleChoiceTestModeIssueMessage({
      isTest: true,
      hasMultipleChoice: true,
      correctAnswer: '',
      hasResponseScore: false,
      hasChoiceScores: true,
    }),
    null,
  );
});

test('requires a response rubric only for the legacy answer-key form', () => {
  assert.equal(
    getMultipleChoiceTestModeIssueMessage({
      isTest: true,
      hasMultipleChoice: true,
      correctAnswer: '18 <= age <= 65',
      hasResponseScore: false,
      hasChoiceScores: false,
    }),
    'Multiple-choice questions in test mode must include an explicit \\score{points,response} rubric block.',
  );

  assert.equal(
    getMultipleChoiceTestModeIssueMessage({
      isTest: true,
      hasMultipleChoice: true,
      correctAnswer: '18 <= age <= 65',
      hasResponseScore: true,
      hasChoiceScores: false,
    }),
    null,
  );

  assert.equal(
    getMultipleChoiceTestModeIssueMessage({
      isTest: false,
      hasMultipleChoice: true,
      correctAnswer: '',
      hasResponseScore: false,
      hasChoiceScores: false,
    }),
    null,
  );

  assert.equal(
    getMultipleChoiceTestModeIssueMessage({
      isTest: true,
      hasMultipleChoice: true,
      correctAnswer: '',
      hasResponseScore: true,
      hasChoiceScores: true,
    }),
    'Multiple-choice questions with per-choice points cannot also use \\score{points,response}. Remove the response score block.',
  );
});
