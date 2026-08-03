export function shouldSuppressStudentTestFeedbackUi({
  isTestMode = false,
  isStudent = false,
  isCreatorTestRun = false,
  runMode = 'preview',
} = {}) {
  return !!isTestMode && (!!isStudent || !!isCreatorTestRun) && runMode !== 'preview';
}

export function shouldHideStudentTestSections({
  isTestMode = false,
  isStudent = false,
  isCreatorTestRun = false,
  runMode = 'preview',
} = {}) {
  return !!isTestMode && (!!isStudent || !!isCreatorTestRun) && runMode !== 'preview';
}
