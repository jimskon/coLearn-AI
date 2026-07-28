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
  assert.equal((result.text.match(/^\\endquestion$/gm) || []).length, 2);
  assert.match(result.text, /\\feedbackprompt\{Describe the output in your own words\.\}\n\\endquestion\n\\question\{/);
  assert.match(result.text, /\\feedbackprompt\{Connect the changed input to the new output\.\}\n\\endquestion\n\\endquestiongroup/);
});

test('normalizeGeneratedDraft replaces textresponse with python block for code-writing markup prompts', () => {
  const raw = [
    '\\title{Introduction to Python}',
    '\\mode{group}',
    '\\studentlevel{Any}',
    '\\activitycontext{Any}',
    '\\section{Application}',
    '\\questiongroup{Write code}',
    '\\question{Write a short Python program that asks for a name and prints a greeting.}',
    '\\textresponse{6}',
    '\\sampleresponses{name = input("Name? ")\nprint("Hello, " + name)}',
    '\\feedbackprompt{Run the code and check that it greets the user.}',
    '\\endquestion',
    '\\endquestiongroup',
  ].join('\n');

  const result = normalizeGeneratedDraft(raw, {
    title: 'Introduction to Python',
    mode: 'group',
    retriesRequired: 3,
    timedSections: [],
    majorSections: ['Application'],
    classLevel: 'Any',
    classTopicDomain: 'Any',
  });

  assert.equal(result.usedFallback, false);
  assert.doesNotMatch(result.text, /\\textresponse\{6\}/);
  assert.match(result.text, /\\question\{Write a short Python program/);
  assert.match(result.text, /\\python\n# Write your Python code here\n\\endpython/);
});

test('normalizeGeneratedDraft uses a python block when salvaging plain-text code-writing prompts', () => {
  const raw = [
    'Title: Introduction to Python',
    'mode: group',
    'Student level: Any',
    'Context: Any',
    '',
    'Exploration',
    '1. Run and change',
    'a. Run the code below and explain what it does.',
    'name = input("What is your name? ")',
    'print("Hello, " + name)',
    'Sample: It asks for a name and prints a greeting.',
    'Feedback: Run it once before changing anything.',
    'b. Change the program so it also asks for a favorite color and prints it.',
    'Sample: name = input("What is your name? ") print("Hello, " + name)',
    'Feedback: Test the changed version.',
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
  assert.match(result.text, /\\question\{Change the program so it also asks for a favorite color and prints it\.\}/);
  assert.match(result.text, /\\python\nname = input\("What is your name\? "\)\nprint\("Hello, " \+ name\)\n\\endpython/);
});

test('normalizeGeneratedDraft decodes common html entities in generated markup', () => {
  const raw = [
    '\\title{Roles &amp; Teams}',
    '\\mode{group}',
    '\\studentlevel{Any}',
    '\\activitycontext{Any}',
    '\\section{Exploration}',
    '\\questiongroup{Intro &amp; Roles}',
    '\\question{Explain what &lt;role&gt; means in this activity.}',
    '\\textresponse{3}',
    '\\sampleresponses{A role is a specific job in the group.}',
    '\\feedbackprompt{Use plain language.}',
    '\\endquestion',
    '\\endquestiongroup',
  ].join('\n');

  const result = normalizeGeneratedDraft(raw, {
    title: 'Roles & Teams',
    mode: 'group',
    retriesRequired: 3,
    timedSections: [],
    majorSections: ['Exploration'],
    classLevel: 'Any',
    classTopicDomain: 'Any',
  });

  assert.equal(result.usedFallback, false);
  assert.match(result.text, /\\title\{Roles & Teams\}/);
  assert.match(result.text, /\\questiongroup\{Intro & Roles\}/);
  assert.match(result.text, /\\question\{Explain what <role> means in this activity\.\}/);
});

test('normalizeGeneratedDraft removes unsupported one-per-line and per-member textbox prompts', () => {
  const raw = [
    '\\title{POGIL Roles}',
    '\\mode{group}',
    '\\studentlevel{Any}',
    '\\activitycontext{Any}',
    '\\section{Exploration}',
    '\\questiongroup{Intro & Roles}',
    '\\question{List the four POGIL roles used in this course (one per line).}',
    '\\textresponse{4}',
    '\\sampleresponses{Manager, Recorder, Presenter, Reflector.}',
    '\\feedbackprompt{Make sure all four roles are included.}',
    '\\endquestion',
    '\\question{Each group member: write your name and which role you were assigned.}',
    '\\textresponse{4}',
    '\\sampleresponses{Jim - Recorder; Ana - Manager.}',
    '\\feedbackprompt{Match each person to a role.}',
    '\\endquestion',
    '\\endquestiongroup',
  ].join('\n');

  const result = normalizeGeneratedDraft(raw, {
    title: 'POGIL Roles',
    mode: 'group',
    retriesRequired: 3,
    timedSections: [],
    majorSections: ['Exploration'],
    classLevel: 'Any',
    classTopicDomain: 'Any',
  });

  assert.equal(result.usedFallback, false);
  assert.doesNotMatch(result.text, /\(one per line\)/i);
  assert.match(result.text, /\\question\{List the four POGIL roles used in this course\.\}/);
  assert.match(result.text, /\\question\{As a group, briefly note which roles were assigned within your group\.\}/);
});
