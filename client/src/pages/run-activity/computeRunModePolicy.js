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
}) {
  const normalizedMode = normalizeRunActivityMode(mode, { user });

  const isInstructor = isElevatedRunViewer(user);
  const isStudent = user?.role === 'student';

  const isStudentRun = normalizedMode === RUN_ACTIVITY_MODES.STUDENT_RUN;
  const isInstructorView = normalizedMode === RUN_ACTIVITY_MODES.INSTRUCTOR_VIEW;
  const isActivityPreview = normalizedMode === RUN_ACTIVITY_MODES.ACTIVITY_PREVIEW;
  const isCreatorSandbox = normalizedMode === RUN_ACTIVITY_MODES.CREATOR_SANDBOX;
  const isSandbox = isCreatorSandbox;
  const isInstructorPreview = isInstructorView;

  const isActive =
    !!user &&
    (
      isCreatorSandbox ||
      (
        isStudentRun &&
        (
          isPlaygroundMode ||
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
    (
      isStudentRun &&
      isActive &&
      !activityPaused
    );

  const canSubmitGroup = isCreatorSandbox || (isStudentRun && isActive && !isTestMode);
  const canSubmitTest = isStudentRun && isTestMode && isStudent;
  const canRunAI = isCreatorSandbox || (isStudentRun && isActive && !isTestMode);
  const canPersistDrafts = isStudentRun;
  const canPersistSubmissions = isStudentRun;
  const canPersistAIResults = isStudentRun;
  const loadPersistedResponses = isStudentRun || isInstructorView;

  return {
    mode: normalizedMode,
    isSandbox,
    isInstructorPreview,
    isStudentRun,
    isInstructorView,
    isActivityPreview,
    isCreatorSandbox,
    isInstructor,
    isStudent,
    isActive,
    isObserver,
    activityPaused,
    canEditAnswers,
    canSubmitGroup,
    canSubmitTest,
    canRunAI,
    canPersistDrafts,
    canPersistSubmissions,
    canPersistAIResults,
    canPollActiveStudent: (isStudentRun || isInstructorView) && !isTestMode,
    canSendHeartbeat: isStudentRun && isStudent,
    canUseLiveSync: isStudentRun || isInstructorView,
    canRegradeTests: isInstructorView && isInstructor && isTestMode,
    canSaveInstructorScores: isInstructorView && isInstructor && isTestMode,
    canRefreshInstanceMetadata: isStudentRun,
    allowFreeNavigation: isCreatorSandbox,
    loadPersistedResponses,
    persistResponses: canPersistDrafts,
    usesRealInstanceProgression: isStudentRun,
  };
}
