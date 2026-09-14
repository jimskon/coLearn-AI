'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const grammar = require('../../shared/activityGrammar.cjs');
const {
  LLM_REVISION_PRIMER,
  buildLlmRevisionPrompt,
  extractMarkupFromPaste,
} = require('../../shared/llmRevisionPrimer.cjs');

// ---------------------------------------------------------------------------
// The briefing must not fall behind the language
//
// Whole-activity revision now happens in someone else's model, and the only
// thing standing between that model and the markup is this text. A tag the
// briefing never mentions is a tag the model has no reason to keep.
// ---------------------------------------------------------------------------

test('every tag the grammar defines is named in the briefing', () => {
  const missing = [];
  for (const list of Object.values(grammar.SINGLETONS)) {
    for (const tag of list) if (!LLM_REVISION_PRIMER.includes(`\\${tag}`)) missing.push(tag);
  }
  for (const tag of grammar.INLINE_TAGS) {
    if (!LLM_REVISION_PRIMER.includes(`\\${tag}`)) missing.push(tag);
  }
  for (const name of Object.keys(grammar.CONTAINERS)) {
    if (!LLM_REVISION_PRIMER.includes(`\\${name}`)) missing.push(name);
  }
  assert.deepEqual(missing, [], `briefing never mentions: ${missing.join(', ')}`);
});

test('every code block and its canonical closer are named', () => {
  for (const spec of Object.values(grammar.CODE_FAMILIES)) {
    assert.ok(LLM_REVISION_PRIMER.includes(`\\${spec.canonicalCloser}`));
    for (const member of spec.members) {
      assert.ok(LLM_REVISION_PRIMER.includes(`\\${member}`), `\\${member} not mentioned`);
    }
  }
});

test('the closed value sets are stated, not left to be guessed', () => {
  for (const mode of grammar.ENUMS.mode) assert.ok(LLM_REVISION_PRIMER.includes(mode));
  for (const type of grammar.ENUMS.scoreType) assert.ok(LLM_REVISION_PRIMER.includes(type));
});

test('the instructor-facing tags are called out as the ones not to drop', () => {
  // The specific loss that motivated all of this.
  const rules = LLM_REVISION_PRIMER.slice(0, LLM_REVISION_PRIMER.indexOf('DOCUMENT SHAPE'));
  for (const tag of ['sampleresponses', 'feedbackprompt', 'followupprompt', 'score']) {
    assert.ok(rules.includes(`\\${tag}`), `\\${tag} must be named in the rules, not just the tag list`);
  }
});

test('the prompt carries the activity as well as the briefing', () => {
  const prompt = buildLlmRevisionPrompt('\\title{T}\n\\name{t}');
  assert.ok(prompt.startsWith('You are revising'));
  assert.ok(prompt.includes('\\title{T}'));
  assert.ok(prompt.includes('```'), 'the activity is fenced so the model can see where it ends');
});

// ---------------------------------------------------------------------------
// Getting the markup back out
// ---------------------------------------------------------------------------

test('a fenced reply is unwrapped and its chatter dropped', () => {
  const reply = 'Sure! Here is the revised activity:\n\n```\n\\title{T}\n\\name{t}\n```\n\nLet me know!';
  assert.equal(extractMarkupFromPaste(reply), '\\title{T}\n\\name{t}');
});

test('a language-tagged fence is unwrapped too', () => {
  assert.equal(extractMarkupFromPaste('```latex\n\\title{T}\n```'), '\\title{T}');
});

test('bare markup with a preamble keeps everything from the first real tag', () => {
  assert.equal(
    extractMarkupFromPaste('Here you go:\n\\title{T}\n\\name{t}'),
    '\\title{T}\n\\name{t}',
  );
});

test('clean markup is returned unchanged', () => {
  const markup = '\\title{T}\n\\name{t}\n\\questiongroup{G}\n\\endquestiongroup';
  assert.equal(extractMarkupFromPaste(markup), markup);
});

test('an activity that opens mid-document is not truncated further', () => {
  // A paste starting at \questiongroup is a fragment, not chatter -- the
  // structural diff is what should object to it, not this function.
  const fragment = '\\questiongroup{G}\n\\question{Q}\n\\endquestion\n\\endquestiongroup';
  assert.equal(extractMarkupFromPaste(fragment), fragment);
});

test('nothing pasted yields nothing, not a crash', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.equal(extractMarkupFromPaste(value), '');
  }
});
