import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMultipleChoice } from '../src/utils/multipleChoice.js';

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
