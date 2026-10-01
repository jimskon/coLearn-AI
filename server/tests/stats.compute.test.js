'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { summarize, balanceIndex } = require('../stats/compute');

test('balanceIndex is 1 for even submits, 0 when one member does everything', () => {
  assert.equal(balanceIndex([3, 3, 3]), 1);
  assert.equal(balanceIndex([5, 0, 0]), 0);
  assert.equal(balanceIndex([4]), null);
  assert.equal(balanceIndex([0, 0]), null);
});

test('summarize counts groups, revisions, AI decisions, and submit outcomes', () => {
  const result = summarize({
    instances: [
      { id: 1, activityId: 10 },
      { id: 2, activityId: 10 },
      { id: 3, activityId: 11 }, // no members: not a group
    ],
    members: [
      { instanceId: 1, studentId: 101 },
      { instanceId: 1, studentId: 102 },
      { instanceId: 2, studentId: 103 },
      { instanceId: 2, studentId: 104 },
    ],
    answerRows: [
      // 1a: text answer submitted three times (two revisions)
      { id: 1, instanceId: 1, questionId: '1a', submitId: 'a1' },
      { id: 2, instanceId: 1, questionId: '1a', submitId: 'a2' },
      { id: 3, instanceId: 1, questionId: '1a', submitId: 'a3' },
      // 1b: code-only question, two cells written together on one submit
      { id: 4, instanceId: 1, questionId: '1bcode1', submitId: 'b1' },
      { id: 5, instanceId: 1, questionId: '1bcode2', submitId: 'b1' },
      // group 2's 1a: legacy rows without submit_id, two versions
      { id: 6, instanceId: 2, questionId: '1a', submitId: null },
      { id: 7, instanceId: 2, questionId: '1a', submitId: null },
      { id: 8, instanceId: 1, questionId: '1aS', submitId: 'a1' }, // derived key: ignored
      { id: 9, instanceId: 3, questionId: '1a', submitId: 'x' }, // not a group: ignored
    ],
    decisionRows: [
      { instanceId: 1, questionId: '1aFM', response: 'needsRevision' },
      { instanceId: 1, questionId: '1aFM', response: 'accepted' },
      { instanceId: 1, questionId: '1bCodeAccepted', response: 'true' },
      { instanceId: 2, questionId: '1aFM', response: 'accepted' },
    ],
    states: [
      { instanceId: 1, submitId: 's1', userId: 101, response: 'inprogress' }, // held back by AI
      { instanceId: 1, submitId: 's2', userId: 102, response: 'complete' },
      { instanceId: 2, submitId: 's3', userId: 103, response: 'inprogress' }, // evaluation error
      { instanceId: 2, submitId: 's4', userId: 103, response: 'complete' }, // via Continue
    ],
    attempts: [
      // The code question 1b is sent back only through its attempt tag.
      { instanceId: 1, submitId: 's1', response: JSON.stringify({ unanswered: ['1a (AI)', '1b (needs revision)'] }) },
      { instanceId: 1, submitId: 's2', response: JSON.stringify({ unanswered: [] }) },
      { instanceId: 2, submitId: 's3', response: JSON.stringify({ unanswered: ['1a (evaluation error)'] }) },
      { instanceId: 2, submitId: 's4', response: JSON.stringify({ forceOverride: true, unanswered: [] }) },
    ],
    enrolledStudentIds: [101, 102, 103, 104, 105],
  });

  assert.deepEqual(result.students, { enrolled: 5, participating: 4 });
  assert.deepEqual(result.groups, { count: 2, avgSize: 2 });
  assert.equal(result.activities, 1);

  assert.equal(result.revisions.questions, 3);
  assert.equal(result.revisions.codeQuestions, 1);
  assert.equal(result.revisions.versions, 6);
  assert.equal(result.revisions.avgRevisionsPerQuestion, 1);
  assert.equal(result.revisions.pctQuestionsRevised, 66.7);

  assert.equal(result.aiGate.evaluatedQuestions, 3);
  assert.equal(result.aiGate.questionsSentBack, 2);
  assert.equal(result.aiGate.groupSubmits, 4);
  assert.equal(result.aiGate.advanced, 2);
  assert.equal(result.aiGate.advancedViaContinue, 1);
  assert.equal(result.aiGate.heldBackByAI, 1);
  assert.equal(result.aiGate.notAdvancedOther, 1);
  assert.equal(result.aiGate.pctSubmitsHeldBackByAI, 25);

  // Group 1 split submits 1/1 (balance 1); group 2 had one member do both (balance 0).
  assert.equal(result.participation.groupsMeasured, 2);
  assert.equal(result.participation.avgBalance, 0.5);
  assert.equal(result.participation.avgTopSubmitterSharePct, 75);
  assert.equal(result.participation.pctMembersWhoSubmitted, 75);
});

test('summarize returns empty-safe values with no data', () => {
  const result = summarize({});
  assert.equal(result.groups.count, 0);
  assert.equal(result.revisions.avgRevisionsPerQuestion, null);
  assert.equal(result.aiGate.pctSubmitsHeldBackByAI, null);
  assert.equal(result.participation.avgBalance, null);
});
