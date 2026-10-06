// Display labels for \questiontype values (see MarkUp.md, "Question type").
export const QUESTION_TYPE_OPTIONS = [
  ['code_writing', 'Code writing'],
  ['code_reading', 'Code reading'],
  ['output_prediction', 'Output prediction'],
  ['debugging', 'Debugging'],
  ['conceptual_explanation', 'Conceptual explanation'],
  ['application_problem_solving', 'Application / problem solving'],
  ['reflection', 'Reflection'],
  ['other', 'Other'],
];

const LABELS = Object.fromEntries(QUESTION_TYPE_OPTIONS);

export function questionTypeLabel(value) {
  return LABELS[value] || value || '';
}
