// Round-trip guarantees for the visual editor's question serializer.
//
// The editor rebuilds a question from inspector state. Before Phase 2 it kept
// only the constructs it recognised and dropped everything else, so saving a
// question through the inspector silently deleted \info, \image, \link, tables,
// comments and any tag newer than the inspector. These tests are the contract
// that it now changes only what it was asked to change.

import test from 'node:test';
import assert from 'node:assert/strict';

import { serializeQuestionComponent } from '../src/utils/creatorComponentSerialization.js';

const QUESTION = [
  '\\question{Trace the loop and explain the output.}',      // 1
  '\\info{Remember to check the loop bound.}',               // 2
  '\\image{diagram.png}{60%}',                               // 3
  '\\textresponse{3}',                                       // 4
  '\\python',                                                // 5
  'for i in range(5):',                                      // 6
  '    print(i)',                                            // 7
  '\\endpython',                                             // 8
  '\\sampleresponses{Prints 0 through 4.}',                  // 9
  '\\link{https://docs.python.org}{Python docs}',            // 10
  '\\feedbackprompt{Check they mention the range bound.}',   // 11
  '\\score{5,response}',                                     // 12
  'Award full marks for naming the bound.',                  // 13
  '\\endscore',                                              // 14
  '\\endquestion',                                           // 15
];

const SOURCE = ['\\questiongroup{G}', ...QUESTION, '\\endquestiongroup'].join('\n');

const block = {
  sourceMeta: {
    questionLine: 2,
    endQuestionLine: 16,
    sampleLines: [9],
    feedbackLines: [11],
  },
};

const baseEdits = {
  prompt: 'Trace the loop and explain the output.',
  responseLines: '3',
  sampleResponse: 'Prints 0 through 4.',
  feedbackPrompt: 'Check they mention the range bound.',
  responseScorePoints: '5',
  responseScoreInstructions: 'Award full marks for naming the bound.',
};

const serialize = (edits) => serializeQuestionComponent(SOURCE, block, edits, null, null);

test('an untouched question survives a save unchanged', () => {
  assert.equal(serialize(baseEdits), SOURCE);
});

test('unmanaged tags are preserved when an unrelated field is edited', () => {
  const out = serialize({ ...baseEdits, prompt: 'Trace it and explain.' });
  for (const kept of [
    '\\info{Remember to check the loop bound.}',
    '\\image{diagram.png}{60%}',
    '\\link{https://docs.python.org}{Python docs}',
  ]) {
    assert.ok(out.includes(kept), `${kept} must survive`);
  }
  assert.ok(out.includes('\\question{Trace it and explain.}'), 'prompt should be updated');
});

test('code blocks and their contents survive', () => {
  const out = serialize({ ...baseEdits, feedbackPrompt: 'Different guidance.' });
  assert.ok(out.includes('for i in range(5):'));
  assert.ok(out.includes('    print(i)'));
  assert.equal((out.match(/\\python/g) || []).length, 1, 'code block must not duplicate');
});

test('a rewritten field stays where the author put it', () => {
  const out = serialize({ ...baseEdits, sampleResponse: 'It prints 0,1,2,3,4.' }).split('\n');
  const at = (needle) => out.findIndex((line) => line.includes(needle));
  assert.ok(out.some((l) => l.includes('\\sampleresponses{It prints 0,1,2,3,4.}')), 'updated');
  assert.ok(at('\\endpython') < at('\\sampleresponses'), 'stays after the code block');
  assert.ok(at('\\sampleresponses') < at('\\link{'), 'stays before the link');
});

test('nothing is duplicated on a repeated save', () => {
  const once = serialize(baseEdits);
  const twice = serializeQuestionComponent(once, block, baseEdits, null, null);
  assert.equal(twice, once, 'serializing twice must be stable');
  // Counted with split rather than a RegExp: these tags begin with escape
  // sequences (\s, \t) that a naive RegExp would interpret as character classes.
  const occurrences = (haystack, needle) => haystack.split(needle).length - 1;
  for (const tag of ['\\sampleresponses', '\\feedbackprompt', '\\textresponse', '\\info']) {
    assert.equal(occurrences(twice, tag), 1, `${tag} must appear exactly once`);
  }
});

test('a score block is kept verbatim when the inspector cannot rebuild it', () => {
  // No points supplied: previously this deleted the block and its instructions.
  const out = serialize({ ...baseEdits, responseScorePoints: '' });
  assert.ok(out.includes('\\score{5,response}'), 'original score header kept');
  assert.ok(out.includes('Award full marks for naming the bound.'), 'instructions kept');
});

test('a multi-line field is replaced whole, not partially duplicated', () => {
  const multi = [
    '\\questiongroup{G}',
    '\\question{Explain.}',
    '\\sampleresponses{First line',
    'second line}',
    '\\info{keep me}',
    '\\endquestion',
    '\\endquestiongroup',
  ].join('\n');
  const out = serializeQuestionComponent(
    multi,
    { sourceMeta: { questionLine: 2, endQuestionLine: 6, sampleLines: [3, 4] } },
    { prompt: 'Explain.', sampleResponse: 'Replaced.' },
    null, null,
  );
  assert.ok(out.includes('\\sampleresponses{Replaced.}'));
  assert.ok(!out.includes('second line}'), 'continuation line must not survive as body text');
  assert.ok(out.includes('\\info{keep me}'), 'unrelated tag still preserved');
});

test('a newly added field is introduced after the prompt', () => {
  const out = serialize({ ...baseEdits, followupPrompt: 'Ask about the bound.' }).split('\n');
  assert.ok(out.some((l) => l.includes('\\followupprompt{Ask about the bound.}')), 'added');
  const at = (needle) => out.findIndex((line) => line.includes(needle));
  assert.ok(at('\\followupprompt') < at('\\info{'), 'new field goes near the top');
});
