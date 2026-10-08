const test = require('node:test');
const assert = require('node:assert/strict');
const { validateActivityMarkup } = require('../../shared/activityMarkupValidation.cjs');

const validActivity = String.raw`\title{Example}
\questiongroup{Warm-up}
\retries{1}
\question{Name one role.}
\textresponse{2}
\sampleresponses{Facilitator}
\feedbackprompt{Accept the role name.}
\endquestion
\endquestiongroup`;

test('activity markup validation accepts a normally structured activity', () => {
  const result = validateActivityMarkup(validActivity);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test('activity markup validation rejects duplicate singular question tags', () => {
  const result = validateActivityMarkup(validActivity.replace(
    '\\feedbackprompt{Accept the role name.}',
    '\\feedbackprompt{Accept the role name.}\n\\feedbackprompt{A second rule.}',
  ));
  assert.equal(result.valid, false);
  assert.match(result.issues[0].message, /Duplicate \\feedbackprompt/);
  assert.equal(result.issues[0].line, 8);
});

test('activity markup validation allows a question-level aimode alongside the activity one', () => {
  const twoQuestions = String.raw`\title{Example}
\aimode{positive, brief}
\questiongroup{Warm-up}
\question{One}
\aimode{lenient}
\textresponse{2}
\endquestion
\question{Two}
\aimode{no-positive}
\textresponse{2}
\endquestion
\endquestiongroup`;
  assert.deepEqual(validateActivityMarkup(twoQuestions).issues, []);

  const duplicated = validateActivityMarkup(twoQuestions.replace(
    '\\aimode{lenient}',
    '\\aimode{lenient}\n\\aimode{positive}',
  ));
  assert.equal(duplicated.valid, false);
  assert.match(duplicated.issues[0].message, /Duplicate \\aimode in this question/);

  const rootTwice = validateActivityMarkup(twoQuestions.replace(
    '\\aimode{positive, brief}',
    '\\aimode{positive, brief}\n\\aimode{lenient}',
  ));
  assert.match(rootTwice.issues[0].message, /Duplicate \\aimode in this activity/);
});

test('activity markup validation rejects invalid nesting and leaves markup in code alone', () => {
  const nested = validateActivityMarkup(String.raw`\questiongroup{One}
\question{Question}
\endquestiongroup
\endquestion`);
  assert.equal(nested.valid, false);
  assert.ok(nested.issues.some((issue) => issue.code === 'invalid-nesting'));

  const code = validateActivityMarkup(String.raw`\questiongroup{One}
\question{Question}
\python
print("\\endquestion")
\endpython
\endquestion
\endquestiongroup`);
  assert.equal(code.valid, true);
});

test('activity markup validation permits complete score and file blocks', () => {
  const result = validateActivityMarkup(String.raw`\questiongroup{One}
\question{Question}
\score{2,response}
Award two points for a complete answer.
\endscore
\file{starter.py}
\question{This is file content, not markup.}
\endfile
\endquestion
\endquestiongroup`);
  assert.equal(result.valid, true);
});
