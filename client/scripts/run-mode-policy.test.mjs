import test from 'node:test';
import assert from 'node:assert/strict';
import computeRunModePolicy from '../src/pages/run-activity/computeRunModePolicy.js';
import { RUN_ACTIVITY_MODES } from '../src/pages/run-activity/modes.js';

const student = { id: 7, role: 'student' };
const policy = (activity, extra = {}) => computeRunModePolicy({
  mode: RUN_ACTIVITY_MODES.STUDENT_RUN,
  user: student,
  activeStudentId: 7,
  activity,
  ...extra,
});

test('an open group run lets the active student answer, submit, and use AI', () => {
  const p = policy({ ended_at: null });
  assert.equal(p.activityEnded, false);
  assert.equal(p.isActive, true);
  assert.equal(p.canEditAnswers, true);
  assert.equal(p.canSubmitGroup, true);
  assert.equal(p.canRunAI, true);
});

test('an ended run (Ended - incomplete) is review only, even for the former active student', () => {
  const p = policy({ ended_at: '2026-10-06T15:00:00Z' });
  assert.equal(p.activityEnded, true);
  assert.equal(p.isActive, false);
  assert.equal(p.isObserver, true);
  assert.equal(p.canEditAnswers, false);
  assert.equal(p.canSubmitGroup, false);
  assert.equal(p.canRunAI, false);
});

test('ended_at never affects tests or assignments', () => {
  assert.equal(policy({ ended_at: '2026-10-06T15:00:00Z' }, { isTestMode: true }).activityEnded, false);
  assert.equal(policy({ ended_at: '2026-10-06T15:00:00Z' }, { isAssignmentMode: true }).activityEnded, false);
});
