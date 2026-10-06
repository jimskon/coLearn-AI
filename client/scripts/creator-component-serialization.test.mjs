import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeQuestionComponent } from '../src/utils/creatorComponentSerialization.js';

const source = String.raw`\questiongroup{Roles}
\question{Old prompt}
\textresponse{4}
\sampleresponses{Old sample}
\feedbackprompt{Old feedback}
\sampleresponses{Accidentally duplicated sample}
\python
print("keep this")
\endpython
\endquestion
\endquestiongroup`;

const block = {
  responseMode: 'answer',
  sourceMeta: {
    questionLine: 2,
    endQuestionLine: 10,
    textResponseLine: 3,
    sampleLines: [4, 6],
    feedbackLines: [5],
    followupLines: [],
  },
};

test('question serializer replaces one complete question and removes duplicate managed tags', () => {
  const result = serializeQuestionComponent(source, block, {
    prompt: 'New prompt',
    responseLines: '2',
    sampleResponse: 'One canonical sample',
    feedbackPrompt: 'One canonical feedback rule',
    followupPrompt: '',
    multipleChoiceEnabled: false,
    responseScorePoints: '',
    codeScorePoints: '',
    outputScorePoints: '',
  });

  assert.equal((result.match(/\\sampleresponses\{/g) || []).length, 1);
  assert.equal((result.match(/\\feedbackprompt\{/g) || []).length, 1);
  assert.match(result, /\\question\{New prompt\}/);
  assert.match(result, /print\("keep this"\)/);
  assert.match(result, /\\endquestion\n\\endquestiongroup$/);
});

const typedSource = String.raw`\questiongroup{Loops}
\question{What prints?}
\questiontype{output_prediction}
\textresponse{2}
\endquestion
\question{Untyped}
\textresponse{2}
\endquestion
\endquestiongroup`;

const typedEdits = (questionType, prompt) => ({
  prompt,
  responseLines: '2',
  multipleChoiceEnabled: false,
  ...(questionType === undefined ? {} : { questionType }),
});

test('question serializer keeps an existing \\questiontype in place when unchanged', () => {
  const typedBlock = { questionType: 'output_prediction', sourceMeta: { questionLine: 2, endQuestionLine: 5 } };
  const result = serializeQuestionComponent(typedSource, typedBlock, typedEdits('output_prediction', 'What prints?'));
  assert.equal(result, typedSource);
});

test('question serializer changes or removes \\questiontype from the inspector', () => {
  const typedBlock = { questionType: 'output_prediction', sourceMeta: { questionLine: 2, endQuestionLine: 5 } };
  const changed = serializeQuestionComponent(typedSource, typedBlock, typedEdits('code_reading', 'What prints?'));
  assert.match(changed, /\\question\{What prints\?\}\n\\questiontype\{code_reading\}\n\\textresponse\{2\}/);
  const removed = serializeQuestionComponent(typedSource, typedBlock, typedEdits('', 'What prints?'));
  assert.doesNotMatch(removed.split('\\endquestion')[0], /questiontype/);
});

test('question serializer adds a new \\questiontype just before \\endquestion', () => {
  const untypedBlock = { sourceMeta: { questionLine: 6, endQuestionLine: 8 } };
  const result = serializeQuestionComponent(typedSource, untypedBlock, typedEdits('reflection', 'Untyped'));
  assert.match(result, /\\question\{Untyped\}\n\\textresponse\{2\}\n\\questiontype\{reflection\}\n\\endquestion/);
});

test('question serializer keeps an unknown \\questiontype it cannot represent', () => {
  const odd = typedSource.replace('output_prediction', 'tracing');
  const result = serializeQuestionComponent(odd, { sourceMeta: { questionLine: 2, endQuestionLine: 5 } }, typedEdits('', 'What prints?'));
  assert.equal(result, odd);
});
