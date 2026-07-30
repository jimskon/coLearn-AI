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

test('rejects a blank choice or blank answer', () => {
  const result = validateMultipleChoice('', ['Correct', '']);
  const messages = result.errors.join('\n');
  assert.match(messages, /correct answer value/i);
  assert.match(messages, /non-empty/i);
});
