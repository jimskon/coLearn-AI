'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { extractActivityResearchMeta } = require('../../shared/activityResearchMeta.cjs');
const { reconstructInstance, cappedSpan } = require('../research/reconstruct');
const text = require('../research/text');

// ---------------------------------------------------------------------------
// Synthetic trace builders
// ---------------------------------------------------------------------------
const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 8, 1, 14, 0, 0);

function makeTrace() {
  let rowId = 0;
  let submitSeq = 0;
  const rows = [];
  return {
    rows,
    // One group submit: state row, attempt row, plus answer/decision rows.
    submit({ group, user, at, advanced, sentBack = [], forceOverride = false, retries = 3, answers = {} }) {
      submitSeq += 1;
      const submitId = `s${submitSeq}`;
      const add = (questionId, response) => rows.push({
        id: ++rowId, submitId, questionId, response, userId: user, at: T0 + at * MIN,
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

const ACTIVITY = `
\\title{Loops}
\\section{Warm up}{10}
\\questiongroup{Reading loops}
\\question{What does the loop print?}
\\questiontype{output_prediction}
\\endquestion
\\question{Explain why.}
\\endquestion
\\endquestiongroup
\\section{Writing}{15}
\\questiongroup{Write code}
\\question{Write a loop that prints 0 to 2.}
\\questiontype{code_writing}
\\python
# your code
\\endpython
\\endquestion
\\question{How did that feel?}
\\multiplechoice{}
\\choice{Easy}
\\choice{Hard}
\\endmultiplechoice
\\endquestion
\\endquestiongroup
`;
const META = extractActivityResearchMeta(ACTIVITY);
const MEMBERS = [{ studentId: 101, isStudent: true }, { studentId: 102, isStudent: true }];

function run(trace, events = [], options = {}) {
  return reconstructInstance({
    instance: { id: 1, startAt: T0 },
    members: MEMBERS,
    rows: trace.rows,
    events,
    meta: META,
    options,
  });
}
const question = (result, qid) => result.questions.find((q) => q.qid === qid);

// ---------------------------------------------------------------------------
// Activity metadata
// ---------------------------------------------------------------------------
test('activity metadata numbers questions like the client parser', () => {
  assert.deepEqual([...META.questions.keys()], ['1a', '1b', '2a', '2b']);
  assert.equal(META.questions.get('1a').questionType, 'output_prediction');
  assert.equal(META.questions.get('1b').questionType, 'unknown'); // legacy / untagged
  assert.equal(META.questions.get('2a').hasCode, true);
  assert.equal(META.questions.get('2b').isSurvey, true);
  assert.equal(META.questions.get('2a').sectionIndex, 1);
  assert.equal(META.plannedMinutes, 25);
});

test('multi-select surveys and graded multiple choice are told apart', () => {
  const meta = extractActivityResearchMeta([
    '\\questiongroup{G}',
    '\\question{Pick all}', '\\multiplechoice{multiple}', '\\choice{A}', '\\choice{B}', '\\endmultiplechoice', '\\endquestion',
    '\\question{Capital?}', '\\multiplechoice{Ottawa}', '\\choice{Ottawa}', '\\choice{Paris}', '\\endmultiplechoice', '\\endquestion',
    '\\endquestiongroup',
  ]);
  assert.equal(meta.questions.get('1a').isSurvey, true);
  assert.equal(meta.questions.get('1b').isSurvey, false);
});

test('\\questiontype is not mistaken for \\question or \\questiongroup', () => {
  const meta = extractActivityResearchMeta('\\questiongroup{G}\n\\question{Q}\n\\questiontype{debugging}\n\\endquestion\n\\endquestiongroup');
  assert.deepEqual([...meta.questions.keys()], ['1a']);
  assert.equal(meta.questions.get('1a').questionType, 'debugging');
});

// ---------------------------------------------------------------------------
// Text measures
// ---------------------------------------------------------------------------
test('edit distance and line changes', () => {
  assert.deepEqual(text.editDistance('kitten', 'sitting'), { distance: 3, approximate: false });
  assert.equal(text.normalizedEditDistance('abcd', 'abXd').value, 0.25);
  assert.deepEqual(
    (({ linesAdded, linesRemoved }) => ({ linesAdded, linesRemoved }))(text.lineChanges('a\nb\nc', 'a\nX\nc')),
    { linesAdded: 1, linesRemoved: 1 }
  );
  assert.equal(text.wordCount('  three short words '), 3);
});

test('cappedSpan counts idle gaps only up to the threshold', () => {
  // 0 -> 5 -> 65 minutes with a 10-minute threshold: 5 + 10 = 15 minutes.
  assert.equal(cappedSpan(0, 65 * MIN, [5 * MIN], 10 * MIN), 15 * MIN);
});

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
test('balanced two-person group: submits alternate', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 1, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision', '1b': 'y', '1bFM': 'accepted' } });
  t.submit({ group: 1, user: 102, at: 3, advanced: true, answers: { '1a': 'x2', '1aFM': 'accepted', '1bFM': 'accepted' } });
  t.submit({ group: 2, user: 101, at: 6, advanced: false, sentBack: ['2a'], answers: { '2acode1': 'for i in range(2): print(i)', '2aCodeAccepted': 'false', '2b': 'Easy', '2bFM': 'accepted' } });
  t.submit({ group: 2, user: 102, at: 8, advanced: true, answers: { '2acode1': 'for i in range(3): print(i)', '2aCodeAccepted': 'true' } });
  const r = run(t);
  assert.deepEqual([...r.participation.submitsByStudent.entries()], [[101, 2], [102, 2]]);
  assert.equal(r.participation.longestSubmitStreak, 1);
});

test('one student dominates submissions', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 1, advanced: false, sentBack: ['1a'], answers: { '1a': 'x', '1aFM': 'needsRevision' } });
  t.submit({ group: 1, user: 101, at: 2, advanced: false, sentBack: ['1a'], answers: { '1a': 'xx', '1aFM': 'needsRevision' } });
  t.submit({ group: 1, user: 101, at: 3, advanced: true, answers: { '1a': 'xxx', '1aFM': 'accepted', '1bFM': 'accepted' } });
  const r = run(t);
  assert.deepEqual([...r.participation.submitsByStudent.entries()], [[101, 3], [102, 0]]);
  assert.equal(r.participation.longestSubmitStreak, 3);
});

test('first-attempt acceptance', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 2, advanced: true, answers: { '1a': '0 1 2', '1aFM': 'accepted', '1b': 'because', '1bFM': 'accepted' } });
  const q = question(run(t), '1a');
  assert.equal(q.outcome, 'ai_accepted');
  assert.equal(q.firstDecision, 'accepted');
  assert.equal(q.attemptsToAcceptance, 1);
  assert.equal(q.revisions.length, 0);
});

test('rejection followed by a successful revision', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 2, advanced: false, sentBack: ['1a'], answers: { '1a': 'four times', '1aFM': 'needsRevision', '1aF1': 'What is i after the third pass?', '1bFM': 'accepted' } });
  t.submit({ group: 1, user: 102, at: 5, advanced: true, answers: { '1a': 'three times', '1aFM': 'accepted' } });
  const q = question(run(t), '1a');
  assert.equal(q.outcome, 'ai_accepted');
  assert.equal(q.firstDecision, 'rejected');
  assert.equal(q.attemptsToAcceptance, 2);
  assert.equal(q.attempts[0].feedback, 'What is i after the third pass?');
  assert.equal(q.revisions.length, 1);
  assert.equal(q.revisions[0].charsBefore, 10);
  assert.equal(q.revisions[0].charsAfter, 11);
  assert.equal(q.revisions[0].charDelta, 1);
});

test('multiple rejections then acceptance; evaluations after acceptance are ignored', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 1, advanced: false, sentBack: ['1a'], answers: { '1a': 'a', '1aFM': 'needsRevision', '1b': 'ok', '1bFM': 'accepted' } });
  t.submit({ group: 1, user: 102, at: 2, advanced: false, sentBack: ['1a'], answers: { '1a': 'b', '1aFM': 'needsRevision', '1bFM': 'accepted' } });
  t.submit({ group: 1, user: 101, at: 3, advanced: true, answers: { '1a': 'c', '1aFM': 'accepted', '1bFM': 'accepted' } });
  const r = run(t);
  assert.equal(question(r, '1a').attemptsToAcceptance, 3);
  assert.equal(question(r, '1a').rejectedAttempts, 2);
  assert.equal(question(r, '1b').attempts.length, 1); // repeats after acceptance not counted
});

test('retry exhaustion followed by Continue', () => {
  const t = makeTrace();
  for (let i = 1; i <= 3; i += 1) {
    t.submit({ group: 1, user: 101, at: i, advanced: false, sentBack: ['1a'], retries: 3, answers: { '1a': `try ${i}`, '1aFM': 'needsRevision', '1bFM': 'accepted' } });
  }
  t.submit({ group: 1, user: 102, at: 5, advanced: true, forceOverride: true, retries: 3, answers: {} });
  const q = question(run(t), '1a');
  assert.equal(q.outcome, 'continued');
  assert.equal(q.maxRetriesReached, true);
  assert.equal(q.attemptsToAcceptance, null);
  assert.equal(question(run(t), '1b').outcome, 'ai_accepted'); // not collapsed with Continue
});

test('instructor manual advance after repeated rejections', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 1, advanced: false, sentBack: ['1a'], answers: { '1a': 'a', '1aFM': 'needsRevision', '1bFM': 'accepted' } });
  t.submit({ group: 1, user: 102, at: 2, advanced: false, sentBack: ['1a'], answers: { '1a': 'b', '1aFM': 'needsRevision', '1bFM': 'accepted' } });
  const events = [{ id: 1, type: 'instructor_force_advance', at: T0 + 2.5 * MIN, userId: 9, details: { groupNum: 1 } }];
  const r = run(t, events);
  assert.equal(question(r, '1a').outcome, 'instructor_advanced');
  assert.equal(r.interventions.length, 1);
  assert.equal(r.interventions[0].type, 'force_advance');
  assert.equal(r.interventions[0].afterRepeatedRejections, true);
  assert.equal(r.interventions[0].afterInactivity, false);
});

test('abandoned question stays unresolved', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 1, advanced: false, sentBack: ['1a'], answers: { '1a': 'a', '1aFM': 'needsRevision', '1bFM': 'accepted' } });
  const r = run(t);
  assert.equal(question(r, '1a').outcome, 'unresolved');
  assert.equal(question(r, '2a').outcome, 'not_attempted');
});

test('survey multiple-choice questions are not counted as AI decisions', () => {
  const t = makeTrace();
  t.submit({ group: 2, user: 101, at: 1, advanced: true, answers: { '2acode1': 'print(1)', '2aCodeAccepted': 'true', '2b': 'Easy', '2bFM': 'accepted' } });
  assert.equal(question(run(t), '2b').outcome, 'survey');
});

test('instructor changes the active student: skipped and reassigned turn', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 102, at: 10, advanced: true, answers: { '1a': 'a', '1aFM': 'accepted', '1bFM': 'accepted' } });
  const events = [
    { id: 1, type: 'active_student_changed', at: T0 + 1 * MIN, userId: 101, details: { from: null, to: 101, reason: 'claimed' } },
    { id: 2, type: 'active_student_changed', at: T0 + 6 * MIN, userId: 9, details: { from: 101, to: 102, reason: 'instructor_rotate' } },
  ];
  const r = run(t, events);
  assert.equal(r.turnsRecorded, true);
  assert.equal(r.turns.length, 2);
  assert.equal(r.turns[0].studentId, 101);
  assert.equal(r.turns[0].skipped, true);
  assert.equal(r.turns[0].reassignedByInstructor, true);
  assert.equal(r.turns[1].submits, 1);
  assert.equal(r.turns[1].firstSubmitAt - r.turns[1].startAt, 4 * MIN);
  assert.equal(r.interventions[0].type, 'rotate_active');
  assert.equal(r.interventions[0].afterInactivity, true); // 5 minutes with no activity
});

test('question duration is measured from group entry, with idle gaps capped', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 0, advanced: true, answers: { '1a': 'a', '1aFM': 'accepted', '1b': 'b', '1bFM': 'accepted' } });
  // Group 2 entered at minute 0; accepted at minute 40 after a 40-minute gap.
  t.submit({ group: 2, user: 102, at: 40, advanced: true, answers: { '2acode1': 'x', '2aCodeAccepted': 'true', '2b': 'Hard', '2bFM': 'accepted' } });
  const q = question(run(t), '2a');
  assert.equal(q.enteredAt, T0);
  assert.equal(q.durationMs, 10 * MIN); // capped at the 10-minute idle threshold
});

// ---------------------------------------------------------------------------
// Pseudonymous IDs
// ---------------------------------------------------------------------------
test('pseudonyms are stable, kind-specific, and do not reveal the id', () => {
  const { pseudonym } = require('../research/pseudonym');
  const secret = 'test-secret-0123456789';
  const a = pseudonym('student', 42, secret);
  assert.equal(a, pseudonym('student', 42, secret));
  assert.notEqual(a, pseudonym('student', 43, secret));
  assert.notEqual(a.slice(2), pseudonym('group', 42, secret).slice(2));
  assert.match(a, /^S-[0-9a-f]{12}$/);
  assert.equal(a.includes('42'), false);
  assert.notEqual(a, pseudonym('student', 42, 'another-secret-0123456789'));
});

test('rapid instructor rotations count as one intervention', () => {
  const t = makeTrace();
  const rotate = (id, sec, from, to) => ({
    id, type: 'active_student_changed', at: T0 + 5 * MIN + sec * 1000, userId: 9,
    details: { from, to, reason: 'instructor_rotate' },
  });
  const events = [
    { id: 1, type: 'active_student_changed', at: T0, userId: 101, details: { from: null, to: 101, reason: 'claimed' } },
    rotate(2, 0, 101, 102), rotate(3, 8, 102, 101), rotate(4, 9, 101, 102), // one burst
    rotate(5, 60, 102, 101), // separate intervention
  ];
  const r = run(t, events);
  const rotations = r.interventions.filter((i) => i.type === 'rotate_active');
  assert.equal(rotations.length, 2);
  assert.equal(rotations[0].rotations, 3);
  assert.equal(rotations[1].rotations, 1);
});

test('a turn cleared because everyone left is logged as all_absent', () => {
  const calls = [];
  const auditPath = require.resolve('../utils/auditLogger');
  const turnPath = require.resolve('../utils/turnEvents');
  const original = require.cache[auditPath];
  require.cache[auditPath] = { id: auditPath, filename: auditPath, loaded: true,
    exports: { recordAuditEvent: async (type, opts) => { calls.push({ type, details: opts.details }); } } };
  delete require.cache[turnPath];
  try {
    const { recordTurnChange, TURN_REASONS } = require('../utils/turnEvents');
    recordTurnChange(null, 7, 103, null, TURN_REASONS.ABSENT_REASSIGNED);
    recordTurnChange(null, 7, 103, 119, TURN_REASONS.ABSENT_REASSIGNED);
    recordTurnChange(null, 7, 119, 119, TURN_REASONS.CLAIMED); // no change: not logged
  } finally {
    if (original) require.cache[auditPath] = original; else delete require.cache[auditPath];
    delete require.cache[turnPath];
  }
  assert.deepEqual(calls.map((c) => c.details.reason), ['all_absent', 'absent_reassigned']);
});

test('a submit and the rotation it causes share a second: the submit counts in the turn it ends', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 2, advanced: false, sentBack: ['1a'], answers: { '1a': 'a', '1aFM': 'needsRevision', '1bFM': 'accepted' } });
  const events = [
    { id: 1, type: 'active_student_changed', at: T0 + 1 * MIN, userId: 101, details: { from: null, to: 101, reason: 'claimed' } },
    { id: 2, type: 'active_student_changed', at: T0 + 2 * MIN, userId: 101, details: { from: 101, to: 102, reason: 'rotation_after_submit' } },
  ];
  const r = run(t, events);
  assert.equal(r.turns[0].submits, 1);
  assert.equal(r.turns[0].firstSubmitAt - r.turns[0].startAt, 1 * MIN);
  assert.equal(r.turns[0].skipped, false);
});

test('turns inside an instructor rotation burst are transient', () => {
  const t = makeTrace();
  const ev = (id, sec, from, to, reason) => ({ id, type: 'active_student_changed', at: T0 + sec * 1000, userId: 9, details: { from, to, reason } });
  const events = [
    ev(1, 0, null, 101, 'claimed'),
    ev(2, 60, 101, 102, 'instructor_rotate'),
    ev(3, 61, 102, 101, 'instructor_rotate'),
    ev(4, 62, 101, 102, 'instructor_rotate'),
  ];
  const r = run(t, events);
  assert.deepEqual(r.turns.map((x) => x.transient), [false, true, true, false]);
});

test('without turn events the first group has no known entry time', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 5, advanced: true, answers: { '1a': 'a', '1aFM': 'accepted', '1b': 'b', '1bFM': 'accepted' } });
  const withoutTurns = run(t);
  assert.equal(question(withoutTurns, '1a').enteredAt, null);
  assert.equal(question(withoutTurns, '1a').durationMs, null);
  assert.equal(withoutTurns.timing.startKnown, false);
  assert.equal(withoutTurns.timing.submitSpanMs, 0);

  const withTurns = run(t, [{ id: 1, type: 'active_student_changed', at: T0 + 1 * MIN, userId: 101, details: { from: null, to: 101, reason: 'claimed' } }]);
  assert.equal(question(withTurns, '1a').enteredAt, T0 + 1 * MIN);
  assert.equal(question(withTurns, '1a').durationMs, 4 * MIN);
  assert.equal(question(withTurns, '1a').firstResponseMs, 4 * MIN);
  assert.equal(withTurns.timing.startKnown, true);
});

test('a run whose turn logging began mid-run is partial: no turn or session-start data', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 1, advanced: false, sentBack: ['1a'], answers: { '1a': 'a', '1aFM': 'needsRevision', '1bFM': 'accepted' } });
  t.submit({ group: 1, user: 102, at: 9, advanced: true, answers: { '1a': 'b', '1aFM': 'accepted' } });
  // Logging deployed between the two submits.
  const events = [{ id: 1, type: 'active_student_changed', at: T0 + 5 * MIN, userId: 101, details: { from: 101, to: 102, reason: 'instructor_rotate' } }];
  const r = run(t, events);
  assert.equal(r.turnCoverage, 'partial');
  assert.equal(r.turnsRecorded, false);
  assert.equal(r.timing.startKnown, false);
  assert.equal(question(r, '1a').enteredAt, null);
  // Submit-based facts are unaffected.
  assert.equal(question(r, '1a').attemptsToAcceptance, 2);
  assert.deepEqual([...r.participation.submitsByStudent.entries()], [[101, 1], [102, 1]]);
});

test('instructor pauses are removed from durations before idle capping', () => {
  const t = makeTrace();
  t.submit({ group: 1, user: 101, at: 0, advanced: true, answers: { '1a': 'a', '1aFM': 'accepted', '1b': 'b', '1bFM': 'accepted' } });
  // Group 2 entered at minute 0; a 7-minute pause; accepted at minute 9.
  t.submit({ group: 2, user: 102, at: 9, advanced: true, answers: { '2acode1': 'x', '2aCodeAccepted': 'true', '2b': 'Easy', '2bFM': 'accepted' } });
  const events = [
    { id: 1, type: 'activity_paused', at: T0 + 1 * MIN },
    { id: 2, type: 'activity_resumed', at: T0 + 8 * MIN },
  ];
  const q = question(run(t, events), '2a');
  assert.equal(q.durationMs, 2 * MIN); // 9 minutes minus the 7-minute pause
});
