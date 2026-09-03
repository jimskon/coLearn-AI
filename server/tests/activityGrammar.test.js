'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const grammar = require('../../shared/activityGrammar.cjs');
const families = require('../../shared/codeBlockFamilies.cjs');

// ---------------------------------------------------------------------------
// Code-block closers
// ---------------------------------------------------------------------------

test('every code block has a canonical closer, and it is its family closer', () => {
  for (const [family, spec] of Object.entries(grammar.CODE_FAMILIES)) {
    for (const member of spec.members) {
      assert.equal(grammar.familyOfBlock(member), family, `${member} belongs to ${family}`);
      assert.equal(grammar.canonicalCloserFor(member), `\\${spec.canonicalCloser}`);
    }
  }
});

test('any closer in a family closes any block in that family', () => {
  for (const spec of Object.values(grammar.CODE_FAMILIES)) {
    const closers = [spec.canonicalCloser, ...spec.members.map((m) => `end${m}`)];
    for (const member of spec.members) {
      for (const closer of closers) {
        assert.ok(
          grammar.closesBlock(`\\${closer}`, member),
          `\\${closer} should close \\${member}`,
        );
      }
    }
  }
});

test('closers never cross families', () => {
  assert.equal(grammar.closesBlock('\\endcpp', 'python'), false);
  assert.equal(grammar.closesBlock('\\endpython', 'cpp'), false);
  assert.equal(grammar.closesBlock('\\endpython', 'cppdisplay'), false);
  assert.equal(grammar.closesBlock('\\endcpp', 'pythonremote'), false);
});

test('a closer that is not a code closer resolves to no family', () => {
  for (const tag of ['\\endquestion', '\\endquestiongroup', '\\endscore', '\\end', '\\endai']) {
    assert.equal(grammar.familyOfCloser(tag), null, `${tag} is not a code closer`);
  }
});

test('line recognisers agree with closesBlock', () => {
  for (const spec of Object.values(grammar.CODE_FAMILIES)) {
    for (const member of spec.members) {
      assert.ok(grammar.isCodeOpenLine(`\\${member}`), `\\${member} opens`);
      assert.ok(grammar.isCodeOpenLine(`\\${member}{30}`), `\\${member}{30} opens`);
      assert.ok(grammar.isCodeCloseLine(`\\end${member}`), `\\end${member} closes`);
    }
    assert.ok(grammar.isCodeCloseLine(`\\${spec.canonicalCloser}`));
  }
  assert.equal(grammar.isCodeOpenLine('\\question{hi}'), false);
  assert.equal(grammar.isCodeCloseLine('\\endquestion'), false);
});

// ---------------------------------------------------------------------------
// Deletion safety
//
// The visual editor strips managed tags from a question body and re-emits them
// from inspector state, and drops what it does not recognise. Both sets come
// from this file, so these assertions are what stop a vocabulary change from
// quietly turning into data loss.
// ---------------------------------------------------------------------------

test('every managed question tag is a declared question singleton', () => {
  for (const tag of grammar.MANAGED_QUESTION_TAGS) {
    assert.ok(
      grammar.SINGLETONS.question.includes(tag),
      `${tag} is managed by the inspector but not declared in SINGLETONS.question`,
    );
  }
});

test('allTags covers containers, their closers, code blocks and singletons', () => {
  const tags = grammar.allTags();
  for (const [name, spec] of Object.entries(grammar.CONTAINERS)) {
    assert.ok(tags.has(name), `${name} missing from allTags`);
    assert.ok(tags.has(spec.closeTag.replace(/^\\/, '')), `${spec.closeTag} missing from allTags`);
  }
  for (const list of Object.values(grammar.SINGLETONS)) {
    for (const tag of list) assert.ok(tags.has(tag), `${tag} missing from allTags`);
  }
  for (const spec of Object.values(grammar.CODE_FAMILIES)) {
    for (const member of spec.members) assert.ok(tags.has(member), `${member} missing from allTags`);
  }
});

test('the vocabulary does not shrink without someone noticing', () => {
  // A tag removed from the grammar becomes a tag the visual editor deletes from
  // question bodies. Removing one should require editing this list deliberately.
  const expected = [
    'ai', 'aicodeguidance', 'aicontext', 'aiguardrail', 'aiinput', 'aimodel',
    'aiprompt', 'aititle', 'activitycontext', 'choice', 'cpp', 'cppdisplay',
    'feedbackprompt', 'file', 'followupprompt', 'image', 'include', 'info',
    'item', 'language', 'link', 'mode', 'mono', 'multiplechoice', 'name',
    'python', 'pythondisplay', 'pythonremote', 'pythonturtle', 'question',
    'questiongroup', 'responsemode', 'retries', 'row', 'sampleresponses',
    'score', 'section', 'studentlevel', 'table', 'test', 'text', 'textresponse',
    'texttt', 'title', 'tresponse',
  ];
  const tags = grammar.allTags();
  const missing = expected.filter((tag) => !tags.has(tag));
  assert.deepEqual(missing, [], `grammar no longer defines: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// No drift between the authority and its consumers
// ---------------------------------------------------------------------------

test('codeBlockFamilies re-exports the authority rather than restating it', () => {
  assert.equal(families.FAMILIES, grammar.CODE_FAMILIES);
  assert.equal(families.closesBlock('\\endpython', 'pythonremote'), true);
  assert.equal(families.canonicalCloserFor('cppdisplay'), '\\endcpp');
});

test('the validator accepts every closer the grammar accepts', () => {
  const { validateActivityMarkup } = require('../../shared/activityMarkupValidation.cjs');
  const doc = (open, close) => [
    '\\title{T}', '\\name{n}', '\\questiongroup{G}', '\\question{Q}',
    `\\${open}`, 'print("x")', `\\${close}`,
    '\\textresponse{2}', '\\endquestion', '\\endquestiongroup',
  ].join('\n');

  for (const spec of Object.values(grammar.CODE_FAMILIES)) {
    const closers = [spec.canonicalCloser, ...spec.members.map((m) => `end${m}`)];
    for (const member of spec.members) {
      for (const closer of closers) {
        const errors = validateActivityMarkup(doc(member, closer))
          .issues.filter((issue) => issue.severity === 'error');
        assert.deepEqual(
          errors, [],
          `validator rejected \\${member} … \\${closer}: ${errors[0]?.message || ''}`,
        );
      }
    }
  }
});

test('the validator still reports a genuine cross-family mismatch', () => {
  const { validateActivityMarkup } = require('../../shared/activityMarkupValidation.cjs');
  const errors = validateActivityMarkup([
    '\\title{T}', '\\name{n}', '\\questiongroup{G}', '\\question{Q}',
    '\\python', 'print("x")', '\\endcpp',
    '\\endquestion', '\\endquestiongroup',
  ].join('\n')).issues.filter((issue) => issue.severity === 'error');

  assert.ok(errors.length > 0, 'mismatch must still be an error');
  assert.match(errors[0].message, /python opened at line \d+ is still open/);
});

test('an unclosed code block suggests the canonical closer', () => {
  const { validateActivityMarkup } = require('../../shared/activityMarkupValidation.cjs');
  const errors = validateActivityMarkup([
    '\\title{T}', '\\name{n}', '\\questiongroup{G}', '\\question{Q}',
    '\\pythonremote', 'print("x")',
    '\\endquestion', '\\endquestiongroup',
  ].join('\n')).issues.filter((issue) => issue.severity === 'error');

  const unclosed = errors.find((issue) => issue.code === 'unclosed-block');
  assert.ok(unclosed, 'unclosed block must still be detected');
  assert.match(unclosed.message, /\\endpython\./, 'should suggest the canonical closer');
});
