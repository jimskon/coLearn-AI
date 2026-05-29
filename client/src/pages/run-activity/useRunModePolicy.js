import { useMemo } from 'react';

import { RUN_ACTIVITY_MODES } from './modes';
import computeRunModePolicy from './computeRunModePolicy';

export default function useRunModePolicy({
  mode = RUN_ACTIVITY_MODES.STUDENT,
  user,
  activeStudentId,
  activity,
  isPlaygroundMode = false,
  isTestMode = false,
}) {
  return useMemo(() => computeRunModePolicy({
    mode,
    user,
    activeStudentId,
    activity,
    isPlaygroundMode,
    isTestMode,
  }), [mode, user, activeStudentId, activity?.section_timer_paused, isPlaygroundMode, isTestMode]);
}
