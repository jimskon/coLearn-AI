import { useMemo } from 'react';

import { RUN_ACTIVITY_MODES } from './modes';

export default function useRunModePolicy({
  mode = RUN_ACTIVITY_MODES.STUDENT,
  user,
  activeStudentId,
  activity,
  isPlaygroundMode = false,
  isTestMode = false,
}) {
  return useMemo(() => {
    const isInstructor =
      user?.role === 'instructor' ||
      user?.role === 'root' ||
      user?.role === 'creator';

    const isStudent = user?.role === 'student';

    const isSandbox = mode === RUN_ACTIVITY_MODES.SANDBOX;
    const isInstructorPreview = mode === RUN_ACTIVITY_MODES.INSTRUCTOR_PREVIEW;

    const isActive =
      !!user &&
      (
        isSandbox ||
        isPlaygroundMode ||
        (isTestMode && isStudent) ||
        (activeStudentId != null && String(user.id) === String(activeStudentId))
      );

    const isObserver = !isActive;
    const activityPaused = Number(activity?.section_timer_paused) === 1;

    return {
      mode,
      isSandbox,
      isInstructorPreview,
      isInstructor,
      isStudent,
      isActive,
      isObserver,
      activityPaused,
      canPollActiveStudent: mode === RUN_ACTIVITY_MODES.STUDENT && !isTestMode,
      canSendHeartbeat: mode === RUN_ACTIVITY_MODES.STUDENT,
      allowFreeNavigation: isSandbox,
      usesRealInstanceProgression: mode === RUN_ACTIVITY_MODES.STUDENT,
    };
  }, [mode, user, activeStudentId, activity?.section_timer_paused, isPlaygroundMode, isTestMode]);
}

