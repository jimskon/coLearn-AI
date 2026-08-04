import assert from 'node:assert/strict';
import test from 'node:test';
import { isSurveyMultipleChoice, validateMultipleChoice } from '../src/utils/multipleChoice.js';
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

test('requires a correct answer and response rubric for multiple-choice questions in test mode', () => {
  assert.equal(
    getMultipleChoiceTestModeIssueMessage({
      isTest: true,
      hasMultipleChoice: true,
      correctAnswer: '',
      hasResponseScore: true,
    }),
    'Multiple-choice questions in test mode must include the correct answer inside \\multiplechoice{...}. Leave \\multiplechoice{} only for survey questions.',
  );

  assert.equal(
    getMultipleChoiceTestModeIssueMessage({
      isTest: true,
      hasMultipleChoice: true,
      correctAnswer: '18 <= age <= 65',
      hasResponseScore: false,
    }),
    'Multiple-choice questions in test mode must include an explicit \\score{points,response} rubric block.',
  );

  assert.equal(
    getMultipleChoiceTestModeIssueMessage({
      isTest: true,
      hasMultipleChoice: true,
      correctAnswer: '18 <= age <= 65',
      hasResponseScore: true,
    }),
    null,
  );

  assert.equal(
    getMultipleChoiceTestModeIssueMessage({
      isTest: false,
      hasMultipleChoice: true,
      correctAnswer: '',
      hasResponseScore: false,
    }),
    null,
  );
});
