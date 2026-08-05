export function validateMultipleChoice(correctAnswerRaw, choicesRaw) {
  const correctAnswer = String(correctAnswerRaw || '').trim();
  const choices = Array.isArray(choicesRaw) ? choicesRaw : [];
  const values = choices.map((choice) => String(choice?.value ?? choice ?? '').trim());
  const choicePoints = choices.map((choice) => choice?.points);
  const hasChoiceScores = choicePoints.some((points) => points !== null && points !== undefined && points !== '');
  const seenChoices = new Set();
  const duplicateChoices = new Set();

  for (const value of values) {
    if (seenChoices.has(value)) duplicateChoices.add(value);
    seenChoices.add(value);
  }

  const errors = [];
  if (values.length < 2) errors.push('A \\multiplechoice block requires at least two \\choice entries.');
  if (values.some((value) => !value)) errors.push('\\choice{value} requires a non-empty value.');
  for (const duplicate of duplicateChoices) {
    errors.push(`Duplicate multiple-choice value "${duplicate}". Choice values must be unique.`);
  }
  if (correctAnswer && !seenChoices.has(correctAnswer)) {
    errors.push('The value in \\multiplechoice{answer} must exactly match one \\choice value.');
  }

  if (hasChoiceScores) {
    if (choicePoints.some((points) => !Number.isInteger(points) || points < 0)) {
      errors.push('When one choice has points, every \\choice{value}{points} entry must use a non-negative whole number of points.');
    }
    if (!choicePoints.some((points) => Number(points) > 0)) {
      errors.push('A scored multiple-choice question must award points to at least one choice.');
    }
  }

  return {
    correctAnswer,
    hasChoiceScores,
    maxChoicePoints: hasChoiceScores ? Math.max(0, ...choicePoints.map((points) => Number(points) || 0)) : 0,
    errors,
  };
}

export function isSurveyMultipleChoice(questionBlock) {
  return Array.isArray(questionBlock?.multipleChoice?.choices)
    && questionBlock.multipleChoice.choices.length >= 2
    && !String(questionBlock.multipleChoice.correctAnswer || '').trim()
    && !questionBlock.multipleChoice.hasChoiceScores;
}
