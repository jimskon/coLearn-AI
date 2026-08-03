export function shouldSuppressStudentTestFeedbackUi({
  isTestMode = false,
  isStudent = false,
  runMode = 'preview',
} = {}) {
  return !!isTestMode && !!isStudent && runMode !== 'preview';
}

export function shouldHideStudentTestSections({
  isTestMode = false,
  isStudent = false,
  runMode = 'preview',
} = {}) {
  return !!isTestMode && !!isStudent && runMode !== 'preview';
}
