export function shouldShowQuestionGradePreview({
  blockType,
  canGradeQuestionPreview,
  isTestMode,
  isSandbox,
}) {
  return Boolean(
    canGradeQuestionPreview &&
      blockType === 'question' &&
      (isTestMode || isSandbox)
  );
}
