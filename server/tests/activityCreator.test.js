const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeGeneratedDraft } = require('../utils/activityCreator');

test('normalizeGeneratedDraft salvages structured plain-text activity output into markup', () => {
  const raw = [
    'Title: Introduction to Python',
    '',
    'mode: group',
    '',
    'Student level: Any',
    '',
    'Context: Beginner-friendly practice using only input, print, and if statements.',
    '',
    'Learning Objectives',
    'Students will be able to:',
    'Run a short Python program that uses input, print, and if statements',
    'Write a short program that uses an if statement',
    '',
    'Exploration',
    '2. Run and predict',
    'a. Run the program below. Before running, predict what it will print.',
    'name = input("What is your name? ")',
    'likes_pizza = input("Do you like pizza? (yes/no) ")',
    'print("Hello, " + name + "!")',
    'if likes_pizza.lower() == "yes":',
    '    print("Great! Pizza is tasty.")',
    'Sample: It greets the user and sometimes prints a pizza message.',
    'Feedback: Compare your prediction with the actual output.',
  ].join('\n');

  const result = normalizeGeneratedDraft(raw, {
    title: 'Introduction to Python',
    mode: 'group',
    retriesRequired: 3,
    timedSections: [],
    majorSections: ['Learning Objectives', 'Exploration'],
    classLevel: 'Any',
    classTopicDomain: 'Any',
  });

  assert.equal(result.usedFallback, false);
  assert.match(result.text, /\\title\{Introduction to Python\}/);
  assert.match(result.text, /\\section\{Learning Objectives\}/);
  assert.match(result.text, /\\begin\{itemize\}/);
  assert.match(result.text, /\\questiongroup\{Run and predict\}/);
  assert.match(result.text, /\\question\{Run the program below\. Before running, predict what it will print\.\}/);
  assert.match(result.text, /\\python/);
  assert.match(result.text, /\\sampleresponses\{It greets the user and sometimes prints a pizza message\.\}/);
  assert.match(result.text, /\\feedbackprompt\{Compare your prediction with the actual output\.\}/);
});

test('normalizeGeneratedDraft repairs missing endquestion markers in generated markup', () => {
  const raw = [
    '\\title{Introduction to Python}',
    '\\mode{group}',
    '\\studentlevel{Any}',
    '\\activitycontext{Any}',
    '\\section{Exploration}',
    '\\questiongroup{Run-and-observe}',
    '\\question{What happened when you ran the code?}',
    '\\textresponse{3}',
    '\\sampleresponses{It printed a greeting.}',
    '\\feedbackprompt{Describe the output in your own words.}',
    '\\question{What changed after you edited the input value?}',
    '\\textresponse{3}',
    '\\sampleresponses{The branch output changed.}',
    '\\feedbackprompt{Connect the changed input to the new output.}',
    '\\endquestiongroup',
  ].join('\n');

  const result = normalizeGeneratedDraft(raw, {
    title: 'Introduction to Python',
    mode: 'group',
    retriesRequired: 3,
    timedSections: [],
    majorSections: ['Exploration'],
    classLevel: 'Any',
    classTopicDomain: 'Any',
  });

  assert.equal(result.usedFallback, false);
  assert.equal((result.text.match(/\\endquestion/g) || []).length, 2);
  assert.match(result.text, /\\feedbackprompt\{Describe the output in your own words\.\}\n\\endquestion\n\\question\{/);
  assert.match(result.text, /\\feedbackprompt\{Connect the changed input to the new output\.\}\n\\endquestion\n\\endquestiongroup/);
});
