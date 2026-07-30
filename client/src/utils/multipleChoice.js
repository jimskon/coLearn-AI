export function validateMultipleChoice(correctAnswerRaw, choicesRaw) {
  const correctAnswer = String(correctAnswerRaw || '').trim();
  const choices = Array.isArray(choicesRaw) ? choicesRaw : [];
  const values = choices.map((choice) => String(choice?.value ?? choice ?? '').trim());
  const seenChoices = new Set();
  const duplicateChoices = new Set();

  for (const value of values) {
    if (seenChoices.has(value)) duplicateChoices.add(value);
    seenChoices.add(value);
  }

  const errors = [];
  if (!correctAnswer) errors.push('\\multiplechoice{answer} requires a correct answer value.');
  if (values.length < 2) errors.push('A \\multiplechoice block requires at least two \\choice entries.');
  if (values.some((value) => !value)) errors.push('\\choice{value} requires a non-empty value.');
  for (const duplicate of duplicateChoices) {
    errors.push(`Duplicate multiple-choice value "${duplicate}". Choice values must be unique.`);
  }
  if (correctAnswer && !seenChoices.has(correctAnswer)) {
    errors.push('The value in \\multiplechoice{answer} must exactly match one \\choice value.');
  }

  return { correctAnswer, errors };
}
