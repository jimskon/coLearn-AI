'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

// ai/controller builds an OpenAI client at import time; never use a real key here.
process.env.OPENAI_API_KEY = 'test-key';

const { isValidQuestionId, isFileResponseKey } = require('../utils/questionId');
const { formatSupportingFiles } = require('../ai/controller');

test('file response keys are valid question ids', () => {
  assert.equal(isFileResponseKey('file:LinkedList.h'), true);
  assert.equal(isFileResponseKey('file:my_data-2.csv'), true);
  assert.equal(isValidQuestionId('file:LinkedList.h'), true);
});

test('file keys reject paths, spaces, and empty names', () => {
  for (const key of ['file:', 'file:dir/List.h', 'file:../secret', 'file:my file.txt', 'files:List.h']) {
    assert.equal(isFileResponseKey(key), false, key);
    assert.equal(isValidQuestionId(key), false, key);
  }
});

test('existing question ids are unaffected', () => {
  assert.equal(isValidQuestionId('1a'), true);
  assert.equal(isValidQuestionId('1acode1'), true);
  assert.equal(isValidQuestionId('attempt:2'), true);
  assert.equal(isValidQuestionId('not a key'), false);
});

test('supporting files are formatted for the AI prompt and empty files skipped', () => {
  assert.equal(formatSupportingFiles([]), '');
  assert.equal(formatSupportingFiles(undefined), '');

  const text = formatSupportingFiles([
    { name: 'List.h', content: 'struct Node { int v; };' },
    { name: 'empty.txt', content: '   ' },
  ]);
  assert.match(text, /File: List\.h\n```\nstruct Node \{ int v; \};\n```/);
  assert.doesNotMatch(text, /empty\.txt/);
});

test('large supporting files are truncated', () => {
  const text = formatSupportingFiles([{ name: 'big.txt', content: 'x'.repeat(10000) }]);
  assert.match(text, /\(truncated\)/);
  assert.ok(text.length < 7000);
});
