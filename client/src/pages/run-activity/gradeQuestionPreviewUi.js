export function shouldShowQuestionGradePreview({
  blockType,
  canGradeQuestionPreview,
  isTestMode,
}) {
  return Boolean(
    canGradeQuestionPreview &&
      blockType === 'question' &&
      isTestMode
  );
}
