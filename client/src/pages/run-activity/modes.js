export const RUN_ACTIVITY_MODES = Object.freeze({
  STUDENT_RUN: 'student_run',
  INSTRUCTOR_VIEW: 'instructor_view',
  ACTIVITY_PREVIEW: 'activity_preview',
  CREATOR_SANDBOX: 'creator_sandbox',
  CREATOR_TEST_RUN: 'creator_test',

  // Legacy aliases accepted by existing URLs/tests.
  STUDENT: 'student',
  SANDBOX: 'sandbox',
  INSTRUCTOR_PREVIEW: 'instructor_preview',
});

export function isElevatedRunViewer(user) {
  return (
    user?.role === 'instructor' ||
    user?.role === 'root' ||
    user?.role === 'creator'
  );
}

export function normalizeRunActivityMode(mode, { user } = {}) {
  const value = String(mode || '').trim().toLowerCase();

  if (value === RUN_ACTIVITY_MODES.SANDBOX || value === RUN_ACTIVITY_MODES.CREATOR_SANDBOX) {
    return RUN_ACTIVITY_MODES.CREATOR_SANDBOX;
  }

  if (value === RUN_ACTIVITY_MODES.CREATOR_TEST_RUN) {
    return RUN_ACTIVITY_MODES.CREATOR_TEST_RUN;
  }

  if (value === 'preview' || value === RUN_ACTIVITY_MODES.ACTIVITY_PREVIEW) {
    return RUN_ACTIVITY_MODES.ACTIVITY_PREVIEW;
  }

  if (
    value === 'view' ||
    value === 'instructor' ||
    value === RUN_ACTIVITY_MODES.INSTRUCTOR_PREVIEW ||
    value === RUN_ACTIVITY_MODES.INSTRUCTOR_VIEW
  ) {
    return RUN_ACTIVITY_MODES.INSTRUCTOR_VIEW;
  }

  if (value === RUN_ACTIVITY_MODES.STUDENT || value === RUN_ACTIVITY_MODES.STUDENT_RUN) {
    return RUN_ACTIVITY_MODES.STUDENT_RUN;
  }

  return isElevatedRunViewer(user)
    ? RUN_ACTIVITY_MODES.INSTRUCTOR_VIEW
    : RUN_ACTIVITY_MODES.STUDENT_RUN;
}
