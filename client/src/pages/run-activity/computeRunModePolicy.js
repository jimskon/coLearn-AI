import {
  RUN_ACTIVITY_MODES,
  isElevatedRunViewer,
  normalizeRunActivityMode,
} from './modes.js';

export default function computeRunModePolicy({
  mode,
  user,
  activeStudentId,
  activity,
  isPlaygroundMode = false,
  isTestMode = false,
  isAssignmentMode = false,
}) {
  const normalizedMode = normalizeRunActivityMode(mode, { user });

  const isInstructor = isElevatedRunViewer(user);
  const isStudent = user?.role === 'student';

  const isStudentRun = normalizedMode === RUN_ACTIVITY_MODES.STUDENT_RUN;
  const isInstructorView = normalizedMode === RUN_ACTIVITY_MODES.INSTRUCTOR_VIEW;
  const isActivityPreview = normalizedMode === RUN_ACTIVITY_MODES.ACTIVITY_PREVIEW;
  const isCreatorSandbox = normalizedMode === RUN_ACTIVITY_MODES.CREATOR_SANDBOX;
  const isCreatorTestRun = normalizedMode === RUN_ACTIVITY_MODES.CREATOR_TEST_RUN;
  const isSandbox = isCreatorSandbox;
  const isInstructorPreview = isInstructorView;

  const isActive =
    !!user &&
    (
      isCreatorSandbox ||
      isCreatorTestRun ||
      (
        isStudentRun &&
        (
          isPlaygroundMode ||
          (isAssignmentMode && isStudent) ||
          (isTestMode && isStudent) ||
          (activeStudentId != null && String(user.id) === String(activeStudentId))
        )
      )
    );

  const isObserver = !isActive;
  const activityPaused =
    !isCreatorSandbox &&
    !isActivityPreview &&
    Number(activity?.section_timer_paused) === 1;

  const canEditAnswers =
    isCreatorSandbox ||
    isCreatorTestRun ||
    (
      isStudentRun &&
      isActive &&
      !activityPaused
    );

  const canSubmitGroup = isCreatorSandbox || (isStudentRun && isActive && !isTestMode && !isAssignmentMode);
  const canSubmitTest = isTestMode && (isStudentRun || isCreatorTestRun) && (isStudent || isCreatorTestRun);
  const canSubmitAssignment = isAssignmentMode && isStudentRun && isStudent && isActive;
  const canRunAI = isCreatorSandbox || (isStudentRun && isActive && !isTestMode);
  const canPersistDrafts = isStudentRun || isCreatorTestRun;
  const canPersistSubmissions = isStudentRun || isCreatorTestRun;
  const canPersistAIResults = isStudentRun || isCreatorTestRun;
  const loadPersistedResponses = isStudentRun || isInstructorView || isCreatorTestRun;

  return {
    mode: normalizedMode,
    isSandbox,
    isCreatorSandbox,
    isInstructorPreview,
    isStudentRun,
    isInstructorView,
    isActivityPreview,
    isCreatorTestRun,
    isInstructor,
    isStudent,
    isActive,
    isObserver,
    activityPaused,
    canEditAnswers,
    canSubmitGroup,
    canSubmitTest,
    canSubmitAssignment,
    canRunAI,
    canPersistDrafts,
    canPersistSubmissions,
    canPersistAIResults,
    canPollActiveStudent: (isStudentRun || isInstructorView) && !isTestMode,
    canSendHeartbeat: isStudentRun && isStudent,
    canUseLiveSync: isStudentRun || isInstructorView,
    canRegradeTests: isInstructorView && isInstructor && (isTestMode || isAssignmentMode),
    canSaveInstructorScores: isInstructorView && isInstructor && (isTestMode || isAssignmentMode),
    canGradeQuestionPreview: (isTestMode || isAssignmentMode || isSandbox) && (isCreatorTestRun || isCreatorSandbox || isInstructor),
    canGradeAllQuestions: (isTestMode || isAssignmentMode || isSandbox) && (isCreatorTestRun || isCreatorSandbox || isInstructor),
    canRefreshInstanceMetadata: isStudentRun,
    allowFreeNavigation: isCreatorSandbox || isAssignmentMode,
    loadPersistedResponses,
    persistResponses: canPersistDrafts,
    usesRealInstanceProgression: isStudentRun,
  };
}
