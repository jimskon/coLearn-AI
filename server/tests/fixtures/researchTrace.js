'use strict';
// Synthetic interaction traces for research analytics tests.

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 8, 1, 14, 0, 0);

// One group, two questions: 1a and 1b.
const ACTIVITY = [
  '\\title{Fixture}',
  '\\section{Only section}{20}',
  '\\questiongroup{Group one}',
  '\\question{First question}',
  '\\questiontype{conceptual_explanation}',
  '\\endquestion',
  '\\question{Second question}',
  '\\endquestion',
  '\\endquestiongroup',
].join('\n');

/** Builds `responses` rows for group submits. */
function makeTrace({ instanceId = 1, startRowId = 0 } = {}) {
  let rowId = startRowId;
  let seq = 0;
  const rows = [];
  return {
    rows,
    submit({ group = 1, user, at, advanced, sentBack = [], forceOverride = false, retries = 3, answers = {} }) {
      seq += 1;
      const submitId = `i${instanceId}-s${seq}`;
      const add = (questionId, response) => rows.push({
        id: ++rowId, submitId, questionId, response, userId: user, at: T0 + at * MIN, instanceId,
      });
      for (const [key, value] of Object.entries(answers)) add(key, value);
      add(`attempt:${group}`, JSON.stringify({
        groupNum: group, forceOverride, retriesRequired: retries,
        unanswered: sentBack.map((q) => `${q} (AI)`),
      }));
      add(`${group}state`, advanced ? 'complete' : 'inprogress');
      return submitId;
    },
  };
}

module.exports = { MIN, T0, ACTIVITY, makeTrace };
