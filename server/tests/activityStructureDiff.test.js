'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inventoryActivity,
  diffActivityStructure,
  describeRemovals,
} = require('../../shared/activityStructureDiff.cjs');

const ACTIVITY = [
  '\\title{Loops}',
  '\\name{loops}',
  '\\section{Exploring}{20}',
  '\\questiongroup{Printing}',
  '\\question{What does this print?}',
  '\\python',
  'print("hi")',
  '\\endpython',
  '\\textresponse{2}',
  '\\sampleresponses{It prints hi.}',
  '\\feedbackprompt{Check they name the output.}',
  '\\score{5,response}',
  'Full marks for the exact output.',
  '\\endscore',
  '\\endquestion',
  '\\question{Why are quotes needed?}',
  '\\textresponse{3}',
  '\\sampleresponses{They make it a string.}',
  '\\followupprompt{Ask what happens without them.}',
  '\\endquestion',
  '\\endquestiongroup',
  '\\questiongroup{Choosing}',
  '\\question{Pick the output.}',
  '\\multiplechoice{hi}',
  '\\choice{hi}',
  '\\choice{error}',
  '\\endmultiplechoice',
  '\\endquestion',
  '\\endquestiongroup',
].join('\n');

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

test('question ids match the numbering instructors see', () => {
  const { questions } = inventoryActivity(ACTIVITY);
  assert.deepEqual([...questions.keys()], ['1a', '1b', '2a']);
});

test('inventory records the fields, rubrics and blocks a question carries', () => {
  const q = inventoryActivity(ACTIVITY).questions.get('1a');
  assert.equal(q.fields.sampleresponses, true);
  assert.equal(q.fields.feedbackprompt, true);
  assert.equal(q.fields.textresponse, true);
  assert.equal(q.scores.response, 5);
  assert.equal(q.codeBlocks, 1);
});

test('markup inside a code block is content, not structure', () => {
  const tricky = [
    '\\questiongroup{G}',
    '\\question{Print a tag}',
    '\\python',
    'print("\\\\sampleresponses{not a real tag}")',
    '\\endpython',
    '\\endquestion',
    '\\endquestiongroup',
  ].join('\n');
  const q = inventoryActivity(tricky).questions.get('1a');
  assert.equal(q.fields.sampleresponses, undefined, 'must not count a tag inside code');
  assert.equal(q.codeBlocks, 1);
});

test('choices are counted', () => {
  assert.equal(inventoryActivity(ACTIVITY).questions.get('2a').choices, 2);
});

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

test('an unchanged activity reports no removals', () => {
  const diff = diffActivityStructure(ACTIVITY, ACTIVITY);
  assert.equal(diff.hasRemovals, false);
  assert.deepEqual(diff.removals, []);
});

test('reordering and rewording prose is not a loss', () => {
  const reworded = ACTIVITY
    .replace('What does this print?', 'What output does this produce?')
    .replace('It prints hi.', 'The program prints hi.');
  const diff = diffActivityStructure(ACTIVITY, reworded);
  assert.equal(diff.hasRemovals, false, 'edits are not removals');
});

test('a dropped sample answer is reported against its question', () => {
  const stripped = ACTIVITY.replace('\\sampleresponses{It prints hi.}\n', '');
  const diff = diffActivityStructure(ACTIVITY, stripped);
  assert.equal(diff.hasRemovals, true);
  assert.deepEqual(diff.removals, [
    { kind: 'field', qid: '1a', field: 'sampleresponses', label: 'sample answer' },
  ]);
});

test('a dropped rubric reports its point value', () => {
  const stripped = ACTIVITY
    .replace('\\score{5,response}\nFull marks for the exact output.\n\\endscore\n', '');
  const [removal] = diffActivityStructure(ACTIVITY, stripped).removals;
  assert.equal(removal.kind, 'score');
  assert.equal(removal.qid, '1a');
  assert.equal(removal.detail, '5 pts');
});

test('a whole question disappearing is reported once, not field by field', () => {
  const truncated = ACTIVITY.split('\n').slice(0, 21).concat('\\endquestiongroup').join('\n');
  const diff = diffActivityStructure(ACTIVITY, truncated);
  const kinds = diff.removals.map((removal) => removal.kind);
  assert.ok(kinds.includes('question'), 'the question itself is reported');
  assert.equal(
    diff.removals.filter((r) => r.qid === '2a' && r.kind === 'field').length, 0,
    'its fields are not reported separately',
  );
});

test('truncation partway through is caught as lost questions and groups', () => {
  // The failure mode that made whole-draft AI revision dangerous: a response
  // cut off mid-document still starts with \title, so shape checks passed.
  const truncated = ACTIVITY.split('\n').slice(0, 15).join('\n');
  const diff = diffActivityStructure(ACTIVITY, truncated);
  assert.equal(diff.hasRemovals, true);
  assert.equal(diff.counts.before.questions, 3);
  assert.equal(diff.counts.after.questions, 1);
  assert.ok(diff.removals.some((r) => r.kind === 'group'), 'the lost group is reported');
});

test('added questions are additions, not removals', () => {
  const extended = ACTIVITY.replace(
    '\\endquestiongroup\n\\questiongroup{Choosing}',
    '\\question{New one}\n\\textresponse{2}\n\\endquestion\n\\endquestiongroup\n\\questiongroup{Choosing}',
  );
  const diff = diffActivityStructure(ACTIVITY, extended);
  assert.equal(diff.hasRemovals, false, 'adding must never require consent');
  assert.ok(diff.additions.length > 0);
});

test('losing answer choices is reported', () => {
  const fewer = ACTIVITY.replace('\\choice{error}\n', '');
  const [removal] = diffActivityStructure(ACTIVITY, fewer).removals;
  assert.equal(removal.kind, 'choice');
  assert.equal(removal.qid, '2a');
});

// ---------------------------------------------------------------------------
// The confirmation prompt
// ---------------------------------------------------------------------------

test('removals of the same kind collapse into one line naming the questions', () => {
  const stripped = ACTIVITY
    .replace('\\sampleresponses{It prints hi.}\n', '')
    .replace('\\sampleresponses{They make it a string.}\n', '');
  const lines = describeRemovals(diffActivityStructure(ACTIVITY, stripped));
  assert.deepEqual(lines, ['2 sample answers  (1a, 1b)']);
});

test('a single removal reads in the singular', () => {
  const stripped = ACTIVITY.replace('\\feedbackprompt{Check they name the output.}\n', '');
  assert.deepEqual(
    describeRemovals(diffActivityStructure(ACTIVITY, stripped)),
    ['1 feedback prompt  (1a)'],
  );
});

test('an empty proposal is reported as losing everything, not as no change', () => {
  const diff = diffActivityStructure(ACTIVITY, '');
  assert.equal(diff.hasRemovals, true);
  assert.equal(diff.counts.after.questions, 0);
  assert.equal(diff.removals.filter((r) => r.kind === 'question').length, 3);
});
