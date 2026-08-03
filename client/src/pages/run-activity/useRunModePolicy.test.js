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
  assert.equal(policy.canPersistDrafts, true);
  assert.equal(policy.canPersistSubmissions, true);
  assert.equal(policy.canPersistAIResults, true);
  assert.equal(policy.loadPersistedResponses, true);
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
  assert.equal(policy.canEditAnswers, false);
  assert.equal(policy.canSubmitGroup, false);
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
  assert.equal(policy.canSubmitTest, true);
  assert.equal(policy.canSubmitGroup, false);
});

test('sandbox mode is always active and allows free navigation without real progression', () => {
  const policy = computeRunModePolicy({
    mode: RUN_ACTIVITY_MODES.SANDBOX,
    user: { id: 42, role: 'student' },
    activeStudentId: 7,
  });

  assert.equal(policy.isSandbox, true);
  assert.equal(policy.isCreatorSandbox, true);
  assert.equal(policy.isActive, true);
  assert.equal(policy.isObserver, false);
  assert.equal(policy.allowFreeNavigation, true);
  assert.equal(policy.canEditAnswers, true);
  assert.equal(policy.canSubmitGroup, true);
  assert.equal(policy.canRunAI, true);
  assert.equal(policy.canUseLiveSync, false);
  assert.equal(policy.persistResponses, false);
  assert.equal(policy.canPersistDrafts, false);
  assert.equal(policy.canPersistSubmissions, false);
  assert.equal(policy.canPersistAIResults, false);
  assert.equal(policy.loadPersistedResponses, false);
  assert.equal(policy.usesRealInstanceProgression, false);
});

test('instructor preview reports paused state from the activity timer flag', () => {
  const policy = computeRunModePolicy({
    mode: RUN_ACTIVITY_MODES.INSTRUCTOR_PREVIEW,
    user: { id: 5, role: 'instructor' },
    activity: { section_timer_paused: 1 },
  });

  assert.equal(policy.isInstructorPreview, true);
  assert.equal(policy.isInstructorView, true);
  assert.equal(policy.isInstructor, true);
  assert.equal(policy.activityPaused, true);
  assert.equal(policy.isActive, false);
  assert.equal(policy.isObserver, true);
  assert.equal(policy.canEditAnswers, false);
  assert.equal(policy.canPersistDrafts, false);
  assert.equal(policy.canPersistSubmissions, false);
  assert.equal(policy.loadPersistedResponses, true);
  assert.equal(policy.canUseLiveSync, true);
  assert.equal(policy.canSendHeartbeat, false);
});

test('default mode for instructors is read-only instructor view', () => {
  const policy = computeRunModePolicy({
    user: { id: 5, role: 'instructor' },
    activeStudentId: 5,
  });

  assert.equal(policy.mode, RUN_ACTIVITY_MODES.INSTRUCTOR_VIEW);
  assert.equal(policy.isInstructorView, true);
  assert.equal(policy.isActive, false);
  assert.equal(policy.canEditAnswers, false);
  assert.equal(policy.canSubmitGroup, false);
  assert.equal(policy.canPersistDrafts, false);
  assert.equal(policy.loadPersistedResponses, true);
});

test('activity preview is read-only and isolated from persisted response state', () => {
  const policy = computeRunModePolicy({
    mode: RUN_ACTIVITY_MODES.ACTIVITY_PREVIEW,
    user: { id: 9, role: 'creator' },
    activity: { section_timer_paused: 1 },
  });

  assert.equal(policy.isActivityPreview, true);
  assert.equal(policy.activityPaused, false);
  assert.equal(policy.isActive, false);
  assert.equal(policy.canEditAnswers, false);
  assert.equal(policy.canSubmitGroup, false);
  assert.equal(policy.canRunAI, false);
  assert.equal(policy.canUseLiveSync, false);
  assert.equal(policy.canPersistDrafts, false);
  assert.equal(policy.canPersistSubmissions, false);
  assert.equal(policy.loadPersistedResponses, false);
});

test('creator sandbox can run feedback but cannot write any real instance state', () => {
  const policy = computeRunModePolicy({
    mode: RUN_ACTIVITY_MODES.CREATOR_SANDBOX,
    user: { id: 9, role: 'creator' },
    activity: { section_timer_paused: 1 },
  });

  assert.equal(policy.mode, RUN_ACTIVITY_MODES.CREATOR_SANDBOX);
  assert.equal(policy.activityPaused, false);
  assert.equal(policy.canEditAnswers, true);
  assert.equal(policy.canSubmitGroup, true);
  assert.equal(policy.canRunAI, true);
  assert.equal(policy.canUseLiveSync, false);
  assert.equal(policy.canPersistDrafts, false);
  assert.equal(policy.canPersistSubmissions, false);
  assert.equal(policy.canPersistAIResults, false);
  assert.equal(policy.loadPersistedResponses, false);
});

test('creator test run behaves like a test-taking mode for creators', () => {
  const policy = computeRunModePolicy({
    mode: RUN_ACTIVITY_MODES.CREATOR_TEST_RUN,
    user: { id: 9, role: 'creator' },
    activity: { is_test: 1 },
    isTestMode: true,
  });

  assert.equal(policy.mode, RUN_ACTIVITY_MODES.CREATOR_TEST_RUN);
  assert.equal(policy.isCreatorTestRun, true);
  assert.equal(policy.isActive, true);
  assert.equal(policy.canEditAnswers, true);
  assert.equal(policy.canSubmitTest, true);
  assert.equal(policy.canSubmitGroup, false);
  assert.equal(policy.canRunAI, false);
  assert.equal(policy.canPersistDrafts, true);
  assert.equal(policy.canPersistSubmissions, true);
  assert.equal(policy.loadPersistedResponses, true);
});
