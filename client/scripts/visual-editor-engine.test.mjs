/**
 * visual-editor-engine.test.mjs
 *
 * Tests for visualEditorEngine.js — EER primitives, raw parsers, preamble range.
 * parseSheet.jsx is stubbed by jsx-stub-loader.mjs.
 *
 * Run: node --import ./scripts/jsx-stub-loader.mjs --test scripts/visual-editor-engine.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLACEHOLDER_PREFIX,
  extractElement,
  replaceElement,
  deleteElement,
  insertBeforeLine,
  findPendingPlaceholder,
  findPreambleRange,
  parseRawQuestion,
  parseRawPreamble,
} from '../src/utils/visualEditorEngine.js';

import { generateQuestion } from '../src/utils/markupTemplates.js';

const L = (...args) => args.join('\n');

// ─── PLACEHOLDER_PREFIX ────────────────────────────────────────────────────

test('PLACEHOLDER_PREFIX starts with % [VISUAL-EDITOR', () => {
  assert.ok(PLACEHOLDER_PREFIX.startsWith('% [VISUAL-EDITOR'));
});

// ─── extractElement ────────────────────────────────────────────────────────

test('extractElement single-line replaces with one placeholder', () => {
  const src = L('\\title{T}', '\\name{N}', '\\mode{group}');
  const { updatedSource, placeholder, backup } = extractElement(src, { startLine: 2, endLine: 2 }, 'preamble');
  const u = updatedSource.split('\n');
  assert.ok(u[1].startsWith(PLACEHOLDER_PREFIX));
  assert.equal(backup, src);
  assert.ok(placeholder.includes('preamble') && placeholder.includes('2-2'));
});

test('extractElement multi-line range becomes one placeholder', () => {
  const src = L('\\question{A}', '\\textresponse{3}', '\\endquestion', '\\question{B}', '\\textresponse{2}', '\\endquestion');
  const { updatedSource } = extractElement(src, { startLine: 1, endLine: 3 }, 'q');
  const u = updatedSource.split('\n');
  assert.equal(u.length, 4);
  assert.ok(u[0].startsWith(PLACEHOLDER_PREFIX));
  assert.equal(u[1], '\\question{B}');
});

test('extractElement throws on invalid ranges', () => {
  const src = L('a', 'b', 'c');
  assert.throws(() => extractElement(src, { startLine: 0, endLine: 2 }, 'x'), /invalid range/i);
  assert.throws(() => extractElement(src, { startLine: 3, endLine: 1 }, 'x'), /invalid range/i);
  assert.throws(() => extractElement(src, { startLine: 1, endLine: 10 }, 'x'), /invalid range/i);
});

test('extractElement preserves lines outside the range', () => {
  const src = L('A', 'B', 'C', 'D', 'E');
  const { updatedSource } = extractElement(src, { startLine: 2, endLine: 4 }, 'mid');
  const u = updatedSource.split('\n');
  assert.equal(u[0], 'A');
  assert.ok(u[1].startsWith(PLACEHOLDER_PREFIX));
  assert.equal(u[2], 'E');
  assert.equal(u.length, 3);
});

// ─── replaceElement ────────────────────────────────────────────────────────

test('replaceElement swaps placeholder with new markup', () => {
  const ph = `${PLACEHOLDER_PREFIX} question lines 3-5]`;
  const src = L('A', 'B', ph, 'D');
  const result = replaceElement(src, ph, '\\question{New}\n\\endquestion');
  const out = result.split('\n');
  assert.deepEqual(out, ['A', 'B', '\\question{New}', '\\endquestion', 'D']);
});

test('replaceElement throws when placeholder not found', () => {
  assert.throws(() => replaceElement('A\nB\nC', `${PLACEHOLDER_PREFIX} gone]`, 'X'), /placeholder not found/i);
});

test('extract + replace round-trip restores original', () => {
  const src = L('\\question{Q.}', '\\textresponse{4}', '\\endquestion');
  const { updatedSource, placeholder } = extractElement(src, { startLine: 1, endLine: 3 }, 'q');
  assert.equal(replaceElement(updatedSource, placeholder, src), src);
});

// ─── deleteElement ─────────────────────────────────────────────────────────

test('deleteElement removes specified lines', () => {
  assert.equal(deleteElement(L('A','B','C','D','E'), { startLine: 2, endLine: 4 }), L('A','E'));
});

test('deleteElement single line', () => {
  assert.equal(deleteElement(L('X','Y','Z'), { startLine: 2, endLine: 2 }), L('X','Z'));
});

test('deleteElement first line', () => {
  assert.equal(deleteElement(L('A','B','C'), { startLine: 1, endLine: 1 }), L('B','C'));
});

test('deleteElement last line', () => {
  assert.equal(deleteElement(L('A','B','C'), { startLine: 3, endLine: 3 }), L('A','B'));
});

// ─── insertBeforeLine ──────────────────────────────────────────────────────

test('insertBeforeLine at position 1', () => {
  assert.equal(insertBeforeLine(L('B','C'), 1, 'A'), L('A','B','C'));
});

test('insertBeforeLine in the middle', () => {
  assert.equal(insertBeforeLine(L('A','C','D'), 2, 'B'), L('A','B','C','D'));
});

test('insertBeforeLine multi-line block', () => {
  assert.equal(insertBeforeLine(L('A','D'), 2, L('B','C')), L('A','B','C','D'));
});

// ─── findPendingPlaceholder ────────────────────────────────────────────────

test('findPendingPlaceholder returns null when none present', () => {
  assert.equal(findPendingPlaceholder(L('\\title{T}','\\mode{group}')), null);
});

test('findPendingPlaceholder finds placeholder string', () => {
  const ph = `${PLACEHOLDER_PREFIX} question lines 5-8]`;
  assert.equal(findPendingPlaceholder(L('A', ph, 'B')), ph);
});

test('findPendingPlaceholder returns first when multiple present', () => {
  const ph1 = `${PLACEHOLDER_PREFIX} q lines 2-4]`;
  const ph2 = `${PLACEHOLDER_PREFIX} g lines 7-12]`;
  assert.equal(findPendingPlaceholder(L('A', ph1, 'B', ph2, 'C')), ph1);
});

// ─── findPreambleRange ─────────────────────────────────────────────────────

test('findPreambleRange spans whole doc with no section/group', () => {
  const { startLine, endLine } = findPreambleRange(['\\title{T}', '\\mode{group}']);
  assert.equal(startLine, 1);
  assert.equal(endLine, 2);
});

test('findPreambleRange stops before \\section', () => {
  const { startLine, endLine } = findPreambleRange(['\\title{T}','\\mode{group}','\\section{S}','\\questiongroup{G}']);
  assert.equal(startLine, 1);
  assert.equal(endLine, 2);
});

test('findPreambleRange stops before \\questiongroup when no section', () => {
  const { endLine } = findPreambleRange(['\\title{T}','\\questiongroup{G}','\\endquestiongroup']);
  assert.equal(endLine, 1);
});

// ─── parseRawPreamble ──────────────────────────────────────────────────────

test('parseRawPreamble extracts title, name, mode', () => {
  const r = parseRawPreamble(['\\title{For Loops}','\\name{Skon}','\\mode{test}']);
  assert.equal(r.title, 'For Loops');
  assert.equal(r.name, 'Skon');
  assert.equal(r.mode, 'test');
});

test('parseRawPreamble defaults mode to group', () => {
  assert.equal(parseRawPreamble(['\\title{T}']).mode, 'group');
});

test('parseRawPreamble recognises demo and assignment', () => {
  assert.equal(parseRawPreamble(['\\mode{demo}']).mode, 'demo');
  assert.equal(parseRawPreamble(['\\mode{assignment}']).mode, 'assignment');
});

test('parseRawPreamble extracts studentLevel, activityContext, aiCodeGuidance', () => {
  const r = parseRawPreamble(['\\studentlevel{CS1}','\\activitycontext{Intro}','\\aicodeguidance{No code}']);
  assert.equal(r.studentLevel, 'CS1');
  assert.equal(r.activityContext, 'Intro');
  assert.equal(r.aiCodeGuidance, 'No code');
});

test('parseRawPreamble extracts aiMode, defaults to no-positive', () => {
  assert.equal(parseRawPreamble(['\\aimode{passive}']).aiMode, 'passive');
  assert.equal(parseRawPreamble(['\\title{T}']).aiMode, 'no-positive');
});

test('parseRawPreamble extracts retries and language', () => {
  const r = parseRawPreamble(['\\retries{2}','\\language{python}']);
  assert.equal(r.retries, '2');
  assert.equal(r.language, 'python');
});

// ─── parseRawQuestion ──────────────────────────────────────────────────────

test('parseRawQuestion extracts prompt', () => {
  assert.equal(parseRawQuestion(['\\question{Explain loops.}','\\endquestion']).prompt, 'Explain loops.');
});

test('parseRawQuestion parses text response', () => {
  const r = parseRawQuestion(['\\question{Q}','\\textresponse{5}','\\endquestion']);
  assert.equal(r.responseType, 'text');
  assert.equal(r.responseValues.lines, 5);
});

test('parseRawQuestion parses python block with code and timeout', () => {
  const r = parseRawQuestion(['\\question{Q}','\\python{30}','x=1','\\endpython','\\endquestion']);
  assert.equal(r.responseType, 'python');
  assert.equal(r.responseValues.timeout, '30');
  assert.ok(r.responseValues.code.includes('x=1'));
});

test('parseRawQuestion parses cpp block', () => {
  const r = parseRawQuestion(['\\question{Q}','\\cpp','int main(){}','\\endcpp','\\endquestion']);
  assert.equal(r.responseType, 'cpp');
  assert.ok(r.responseValues.code.includes('int main(){}'));
});

test('parseRawQuestion parses mc_graded', () => {
  const r = parseRawQuestion(['\\question{Q}','\\multiplechoice{Ottawa}','\\choice{Toronto}','\\choice{Ottawa}','\\endmultiplechoice','\\endquestion']);
  assert.equal(r.responseType, 'mc_graded');
  assert.equal(r.responseValues.correctAnswer, 'Ottawa');
  assert.deepEqual(r.responseValues.choices, ['Toronto','Ottawa']);
});

test('parseRawQuestion parses mc_survey', () => {
  const r = parseRawQuestion(['\\question{Q}','\\multiplechoice{multiple}','\\choice{A}','\\choice{B}','\\endmultiplechoice','\\endquestion']);
  assert.equal(r.responseType, 'mc_survey');
  assert.deepEqual(r.responseValues.choices, ['A','B']);
});

test('parseRawQuestion extracts feedbackPrompt, sampleResponses, followupPrompt', () => {
  const r = parseRawQuestion([
    '\\question{Q}','\\textresponse{3}',
    '\\feedbackprompt{Check it.}','\\sampleresponses{Good answer.}',
    '\\followupprompt{Now apply.}','\\endquestion',
  ]);
  assert.equal(r.feedbackPrompt, 'Check it.');
  assert.equal(r.sampleResponses, 'Good answer.');
  assert.equal(r.followupPrompt, 'Now apply.');
});

test('parseRawQuestion extracts score block', () => {
  const r = parseRawQuestion(['\\question{Q}','\\textresponse{3}','\\score{10,response}','Full marks.','\\endscore','\\endquestion']);
  assert.ok(r.scoreBlock);
  assert.equal(r.scoreBlock.points, 10);
  assert.equal(r.scoreBlock.type, 'response');
  assert.ok(r.scoreBlock.rubric.includes('Full marks.'));
});

test('parseRawQuestion returns none for informational question', () => {
  const r = parseRawQuestion(['\\question{Read this.}','\\endquestion']);
  assert.equal(r.responseType, 'none');
  assert.equal(r.scoreBlock, null);
});

test('parseRawQuestion handles null and empty array', () => {
  assert.doesNotThrow(() => parseRawQuestion(null));
  assert.doesNotThrow(() => parseRawQuestion([]));
  assert.equal(parseRawQuestion([]).responseType, 'none');
});

// ─── Template ↔ Parser round-trips ────────────────────────────────────────

test('round-trip: text response', () => {
  const v = { prompt: 'Explain loops.', responseType: 'text', responseValues: { lines: 6 },
              feedbackPrompt: 'Did they mention base case?', sampleResponses: 'A loop repeats.' };
  const p = parseRawQuestion(generateQuestion(v).split('\n'));
  assert.equal(p.prompt, v.prompt);
  assert.equal(p.responseType, 'text');
  assert.equal(p.responseValues.lines, 6);
  assert.equal(p.feedbackPrompt, v.feedbackPrompt);
  assert.equal(p.sampleResponses, v.sampleResponses);
});

test('round-trip: python with timeout', () => {
  const v = { prompt: 'Q', responseType: 'python', responseValues: { code: 'def f(): pass', timeout: '20' } };
  const p = parseRawQuestion(generateQuestion(v).split('\n'));
  assert.equal(p.responseType, 'python');
  assert.ok(p.responseValues.code.includes('def f(): pass'));
  assert.equal(p.responseValues.timeout, '20');
});

test('round-trip: mc_graded', () => {
  const v = { prompt: 'Q', responseType: 'mc_graded',
              responseValues: { correctAnswer: 'break', choices: ['continue','break','return'] } };
  const p = parseRawQuestion(generateQuestion(v).split('\n'));
  assert.equal(p.responseValues.correctAnswer, 'break');
  assert.deepEqual(p.responseValues.choices, ['continue','break','return']);
});

test('round-trip: mc_survey', () => {
  const v = { prompt: 'Q', responseType: 'mc_survey', responseValues: { choices: ['A','B','C'] } };
  const p = parseRawQuestion(generateQuestion(v).split('\n'));
  assert.equal(p.responseType, 'mc_survey');
  assert.deepEqual(p.responseValues.choices, ['A','B','C']);
});

test('round-trip: score block', () => {
  const v = { prompt: 'Q', responseType: 'text', responseValues: { lines: 3 },
              scoreBlock: { points: 5, type: 'response', rubric: 'Award for naming the range.' } };
  const p = parseRawQuestion(generateQuestion(v).split('\n'));
  assert.equal(p.scoreBlock.points, 5);
  assert.equal(p.scoreBlock.type, 'response');
  assert.ok(p.scoreBlock.rubric.includes('Award for naming the range.'));
});

test('round-trip: aiMode override', () => {
  const v = { prompt: 'Q', responseType: 'none', aiMode: 'passive' };
  const p = parseRawQuestion(generateQuestion(v).split('\n'));
  assert.equal(p.aiMode, 'passive');
});
