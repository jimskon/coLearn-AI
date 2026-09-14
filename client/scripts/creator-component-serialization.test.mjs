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
