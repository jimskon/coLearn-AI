/**
 * visual-editor-templates.test.mjs
 *
 * Tests for markupTemplates.js — every pure template generator.
 * Run: node --test scripts/visual-editor-templates.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePreamble,
  generateSection,
  generateQuestionGroupHeader,
  generateTextResponse,
  generatePythonBlock,
  generateCppBlock,
  generateMultipleChoiceGraded,
  generateMultipleChoiceSurvey,
  generateScoreBlock,
  generateQuestion,
} from '../src/utils/markupTemplates.js';

// ─── generatePreamble ──────────────────────────────────────────────────────

test('generatePreamble emits title, name, and mode', () => {
  const out = generatePreamble({ title: 'For Loops', name: 'Skon', mode: 'group' });
  assert.ok(out.includes('\\title{For Loops}'));
  assert.ok(out.includes('\\name{Skon}'));
  assert.ok(out.includes('\\mode{group}'));
});

test('generatePreamble defaults mode to group when omitted', () => {
  const out = generatePreamble({ title: 'T' });
  assert.ok(out.includes('\\mode{group}'));
});

test('generatePreamble skips empty optional fields', () => {
  const out = generatePreamble({ title: 'T', name: '', mode: 'test', studentLevel: '' });
  assert.ok(!out.includes('\\name{'));
  assert.ok(!out.includes('\\studentlevel{'));
});

test('generatePreamble emits retries when 0', () => {
  const out = generatePreamble({ retries: 0 });
  assert.ok(out.includes('\\retries{0}'));
});

test('generatePreamble suppresses default aiMode (no-positive)', () => {
  const out = generatePreamble({ aiMode: 'no-positive' });
  assert.ok(!out.includes('\\aimode{'));
});

test('generatePreamble emits non-default aiMode', () => {
  const out = generatePreamble({ aiMode: 'active' });
  assert.ok(out.includes('\\aimode{active}'));
});

test('generatePreamble emits activityContext and aiCodeGuidance when provided', () => {
  const out = generatePreamble({
    activityContext: 'Explore Python loops',
    aiCodeGuidance: 'Always explain, never just give code',
  });
  assert.ok(out.includes('\\activitycontext{Explore Python loops}'));
  assert.ok(out.includes('\\aicodeguidance{Always explain, never just give code}'));
});

test('generatePreamble emits language', () => {
  const out = generatePreamble({ language: 'python' });
  assert.ok(out.includes('\\language{python}'));
});

test('generatePreamble handles null/undefined gracefully', () => {
  assert.doesNotThrow(() => generatePreamble(null));
  assert.doesNotThrow(() => generatePreamble(undefined));
  assert.doesNotThrow(() => generatePreamble({}));
});

// ─── generateSection ───────────────────────────────────────────────────────

test('generateSection wraps title in \\section{}', () => {
  assert.equal(generateSection({ title: 'Explore' }), '\\section{Explore}');
});

test('generateSection handles empty title', () => {
  assert.equal(generateSection({ title: '' }), '\\section{}');
});

test('generateSection handles null gracefully', () => {
  assert.doesNotThrow(() => generateSection(null));
});

// ─── generateQuestionGroupHeader ──────────────────────────────────────────

test('generateQuestionGroupHeader wraps title in \\questiongroup{}', () => {
  assert.equal(
    generateQuestionGroupHeader({ title: 'Roles' }),
    '\\questiongroup{Roles}'
  );
});

test('generateQuestionGroupHeader handles empty title', () => {
  assert.equal(generateQuestionGroupHeader({}), '\\questiongroup{}');
});

// ─── generateTextResponse ─────────────────────────────────────────────────

test('generateTextResponse emits \\textresponse{n}', () => {
  assert.equal(generateTextResponse({ lines: 3 }), '\\textresponse{3}');
});

test('generateTextResponse defaults to 4 lines when value is missing', () => {
  assert.equal(generateTextResponse({}), '\\textresponse{4}');
  assert.equal(generateTextResponse({ lines: 0 }), '\\textresponse{4}');
  assert.equal(generateTextResponse({ lines: -1 }), '\\textresponse{4}');
  assert.equal(generateTextResponse({ lines: 'x' }), '\\textresponse{4}');
});

test('generateTextResponse accepts numeric string', () => {
  assert.equal(generateTextResponse({ lines: '6' }), '\\textresponse{6}');
});

// ─── generatePythonBlock ──────────────────────────────────────────────────

test('generatePythonBlock emits \\python...\\endpython', () => {
  const out = generatePythonBlock({ code: 'print("hi")' });
  assert.equal(out, '\\python\nprint("hi")\n\\endpython');
});

test('generatePythonBlock includes timeout when provided', () => {
  const out = generatePythonBlock({ code: 'x = 1', timeout: '30' });
  assert.ok(out.startsWith('\\python{30}\n'));
});

test('generatePythonBlock handles empty code', () => {
  const out = generatePythonBlock({ code: '' });
  assert.equal(out, '\\python\n\n\\endpython');
});

// ─── generateCppBlock ─────────────────────────────────────────────────────

test('generateCppBlock emits \\cpp...\\endcpp', () => {
  const out = generateCppBlock({ code: 'int main(){}' });
  assert.equal(out, '\\cpp\nint main(){}\n\\endcpp');
});

test('generateCppBlock includes timeout when provided', () => {
  const out = generateCppBlock({ code: '', timeout: '10' });
  assert.ok(out.startsWith('\\cpp{10}\n'));
});

// ─── generateMultipleChoiceGraded ─────────────────────────────────────────

test('generateMultipleChoiceGraded emits correct answer and choices', () => {
  const out = generateMultipleChoiceGraded({
    correctAnswer: 'Ottawa',
    choices: ['Toronto', 'Ottawa', 'Montreal'],
  });
  const lines = out.split('\n');
  assert.equal(lines[0], '\\multiplechoice{Ottawa}');
  assert.equal(lines[1], '\\choice{Toronto}');
  assert.equal(lines[2], '\\choice{Ottawa}');
  assert.equal(lines[3], '\\choice{Montreal}');
  assert.equal(lines[4], '\\endmultiplechoice');
});

test('generateMultipleChoiceGraded handles empty choices array', () => {
  const out = generateMultipleChoiceGraded({ correctAnswer: 'A', choices: [] });
  assert.ok(out.includes('\\multiplechoice{A}'));
  assert.ok(out.includes('\\endmultiplechoice'));
});

// ─── generateMultipleChoiceSurvey ─────────────────────────────────────────

test('generateMultipleChoiceSurvey uses "multiple" header', () => {
  const out = generateMultipleChoiceSurvey({ choices: ['Yes', 'No', 'Maybe'] });
  const lines = out.split('\n');
  assert.equal(lines[0], '\\multiplechoice{multiple}');
  assert.ok(lines.includes('\\choice{Yes}'));
  assert.ok(lines.includes('\\choice{No}'));
  assert.ok(lines.includes('\\choice{Maybe}'));
  assert.equal(lines[lines.length - 1], '\\endmultiplechoice');
});

// ─── generateScoreBlock ───────────────────────────────────────────────────

test('generateScoreBlock emits \\score...\\endscore with rubric', () => {
  const out = generateScoreBlock({ points: 5, type: 'response', rubric: 'Award for complete answer.' });
  assert.ok(out.includes('\\score{5,response}'));
  assert.ok(out.includes('Award for complete answer.'));
  assert.ok(out.includes('\\endscore'));
});

test('generateScoreBlock defaults points to 1 and type to response', () => {
  const out = generateScoreBlock({});
  assert.ok(out.startsWith('\\score{1,response}'));
});

// ─── generateQuestion ─────────────────────────────────────────────────────

test('generateQuestion emits question header and endquestion', () => {
  const out = generateQuestion({ prompt: 'What is a loop?', responseType: 'none' });
  assert.ok(out.startsWith('\\question{What is a loop?}'));
  assert.ok(out.endsWith('\\endquestion'));
});

test('generateQuestion with text response includes textresponse', () => {
  const out = generateQuestion({
    prompt: 'Explain.',
    responseType: 'text',
    responseValues: { lines: 5 },
  });
  assert.ok(out.includes('\\textresponse{5}'));
});

test('generateQuestion with python response includes python block', () => {
  const out = generateQuestion({
    prompt: 'Write code.',
    responseType: 'python',
    responseValues: { code: 'print(1)', timeout: null },
  });
  assert.ok(out.includes('\\python\nprint(1)\n\\endpython'));
});

test('generateQuestion with cpp response includes cpp block', () => {
  const out = generateQuestion({
    prompt: 'Write C++.',
    responseType: 'cpp',
    responseValues: { code: 'cout<<1;', timeout: null },
  });
  assert.ok(out.includes('\\cpp\ncout<<1;\n\\endcpp'));
});

test('generateQuestion with mc_graded includes multiplechoice block', () => {
  const out = generateQuestion({
    prompt: 'Which city?',
    responseType: 'mc_graded',
    responseValues: { correctAnswer: 'Ottawa', choices: ['Ottawa', 'Paris'] },
  });
  assert.ok(out.includes('\\multiplechoice{Ottawa}'));
  assert.ok(out.includes('\\choice{Paris}'));
});

test('generateQuestion with mc_survey uses multiple header', () => {
  const out = generateQuestion({
    prompt: 'Pick any.',
    responseType: 'mc_survey',
    responseValues: { choices: ['A', 'B'] },
  });
  assert.ok(out.includes('\\multiplechoice{multiple}'));
});

test('generateQuestion emits feedbackPrompt and sampleResponses', () => {
  const out = generateQuestion({
    prompt: 'Trace it.',
    responseType: 'text',
    responseValues: { lines: 3 },
    feedbackPrompt: 'Check the bound.',
    sampleResponses: 'Prints 0 to 4.',
  });
  assert.ok(out.includes('\\feedbackprompt{Check the bound.}'));
  assert.ok(out.includes('\\sampleresponses{Prints 0 to 4.}'));
});

test('generateQuestion emits followupPrompt', () => {
  const out = generateQuestion({
    prompt: 'Q',
    responseType: 'none',
    followupPrompt: 'Now modify it.',
  });
  assert.ok(out.includes('\\followupprompt{Now modify it.}'));
});

test('generateQuestion emits score block when provided', () => {
  const out = generateQuestion({
    prompt: 'Q',
    responseType: 'text',
    responseValues: { lines: 2 },
    scoreBlock: { points: 10, type: 'response', rubric: 'Full marks for X.' },
  });
  assert.ok(out.includes('\\score{10,response}'));
  assert.ok(out.includes('Full marks for X.'));
  assert.ok(out.includes('\\endscore'));
});

test('generateQuestion suppresses default aiMode (no-positive)', () => {
  const out = generateQuestion({ prompt: 'Q', responseType: 'none', aiMode: 'no-positive' });
  assert.ok(!out.includes('\\aimode{'));
});

test('generateQuestion emits non-default aiMode', () => {
  const out = generateQuestion({ prompt: 'Q', responseType: 'none', aiMode: 'passive' });
  assert.ok(out.includes('\\aimode{passive}'));
});

test('generateQuestion round-trips through parseRawQuestion structural check', () => {
  // Structural check: output has opening and closing tag
  const out = generateQuestion({
    prompt: 'Explain recursion.',
    responseType: 'python',
    responseValues: { code: 'def f(n):\n  return 1 if n==0 else n*f(n-1)', timeout: null },
    feedbackPrompt: 'Did they mention base case?',
    sampleResponses: 'Base case + recursive call.',
    scoreBlock: { points: 5, type: 'response', rubric: 'Award for base case.' },
  });
  const lines = out.split('\n');
  assert.ok(lines[0].startsWith('\\question{'));
  assert.equal(lines[lines.length - 1], '\\endquestion');
  assert.ok(out.includes('\\python'));
  assert.ok(out.includes('\\endpython'));
  assert.ok(out.includes('\\score{5,response}'));
  assert.ok(out.includes('\\endscore'));
});
