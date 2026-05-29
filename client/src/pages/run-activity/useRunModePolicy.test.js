import assert from 'node:assert/strict';
import test from 'node:test';

import { RUN_ACTIVITY_MODES } from './modes.js';
import computeRunModePolicy from './computeRunModePolicy.js';

test('student mode marks the matching active student as active', () => {
  const policy = computeRunModePolicy({
    mode: RUN_ACTIVITY_MODES.STUDENT,
    user: { id: 42, role: 'student' },
    activeStudentId: 42,
  });

  assert.equal(policy.isStudent, true);
  assert.equal(policy.isActive, true);
  assert.equal(policy.isObserver, false);
  assert.equal(policy.canPollActiveStudent, true);
  assert.equal(policy.canSendHeartbeat, true);
  assert.equal(policy.canUseLiveSync, true);
  assert.equal(policy.persistResponses, true);
  assert.equal(policy.usesRealInstanceProgression, true);
});

test('student mode marks non-active students as observers', () => {
  const policy = computeRunModePolicy({
    mode: RUN_ACTIVITY_MODES.STUDENT,
    user: { id: 42, role: 'student' },
    activeStudentId: 7,
  });

  assert.equal(policy.isActive, false);
  assert.equal(policy.isObserver, true);
  assert.equal(policy.allowFreeNavigation, false);
});

test('test mode keeps student active but disables active-student polling', () => {
  const policy = computeRunModePolicy({
    mode: RUN_ACTIVITY_MODES.STUDENT,
    user: { id: 42, role: 'student' },
    activeStudentId: null,
    isTestMode: true,
  });

  assert.equal(policy.isActive, true);
  assert.equal(policy.isObserver, false);
  assert.equal(policy.canPollActiveStudent, false);
  assert.equal(policy.canSendHeartbeat, true);
});

test('sandbox mode is always active and allows free navigation without real progression', () => {
  const policy = computeRunModePolicy({
    mode: RUN_ACTIVITY_MODES.SANDBOX,
    user: { id: 42, role: 'student' },
    activeStudentId: 7,
  });

  assert.equal(policy.isSandbox, true);
  assert.equal(policy.isActive, true);
  assert.equal(policy.isObserver, false);
  assert.equal(policy.allowFreeNavigation, true);
  assert.equal(policy.canUseLiveSync, false);
  assert.equal(policy.persistResponses, false);
  assert.equal(policy.usesRealInstanceProgression, false);
});

test('instructor preview reports paused state from the activity timer flag', () => {
  const policy = computeRunModePolicy({
    mode: RUN_ACTIVITY_MODES.INSTRUCTOR_PREVIEW,
    user: { id: 5, role: 'instructor' },
    activity: { section_timer_paused: 1 },
  });

  assert.equal(policy.isInstructorPreview, true);
  assert.equal(policy.isInstructor, true);
  assert.equal(policy.activityPaused, true);
  assert.equal(policy.isActive, false);
  assert.equal(policy.isObserver, true);
});
