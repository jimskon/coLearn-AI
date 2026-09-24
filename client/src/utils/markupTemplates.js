/**
 * markupTemplates.js
 *
 * Deterministic markup generators for each coLearn-AI element type.
 * Input: plain form-values object → output: markup string.
 * No AI, no side effects. One pure function per element type.
 */

// ─── Preamble ──────────────────────────────────────────────────────────────

/**
 * Generate the activity preamble block.
 * @param {{ title, name, mode, studentLevel, activityContext, aiCodeGuidance,
 *           aiMode, language, retries }} values
 */
export function generatePreamble(values) {
  const lines = [];
  const v = values || {};

  if (v.title)          lines.push(`\\title{${v.title}}`);
  if (v.name)           lines.push(`\\name{${v.name}}`);

  const mode = v.mode || 'group';
  lines.push(`\\mode{${mode}}`);

  if (v.retries !== '' && v.retries != null)
    lines.push(`\\retries{${v.retries}}`);
  if (v.studentLevel)   lines.push(`\\studentlevel{${v.studentLevel}}`);
  if (v.activityContext) lines.push(`\\activitycontext{${v.activityContext}}`);
  if (v.aiCodeGuidance) lines.push(`\\aicodeguidance{${v.aiCodeGuidance}}`);
  if (v.aiMode && v.aiMode !== 'no-positive')
    lines.push(`\\aimode{${v.aiMode}}`);
  if (v.language)       lines.push(`\\language{${v.language}}`);

  return lines.join('\n');
}

// ─── Section ───────────────────────────────────────────────────────────────

/**
 * @param {{ title: string }} values
 */
export function generateSection(values) {
  return `\\section{${(values || {}).title || ''}}`;
}

// ─── Question Group ────────────────────────────────────────────────────────

/**
 * Generate just the \questiongroup{title} header line (not the full group block).
 * The full block reconstruction happens in the engine.
 * @param {{ title: string }} values
 */
export function generateQuestionGroupHeader(values) {
  return `\\questiongroup{${(values || {}).title || ''}}`;
}

// ─── Response Blocks ───────────────────────────────────────────────────────

/** @param {{ lines: number|string }} values */
export function generateTextResponse(values) {
  const n = parseInt((values || {}).lines, 10);
  return `\\textresponse{${Number.isFinite(n) && n > 0 ? n : 4}}`;
}

/** @param {{ code: string, timeout: string|null }} values */
export function generatePythonBlock(values) {
  const v = values || {};
  const open = v.timeout ? `\\python{${v.timeout}}` : `\\python`;
  return `${open}\n${v.code || ''}\n\\endpython`;
}

/** @param {{ code: string, timeout: string|null }} values */
export function generateCppBlock(values) {
  const v = values || {};
  const open = v.timeout ? `\\cpp{${v.timeout}}` : `\\cpp`;
  return `${open}\n${v.code || ''}\n\\endcpp`;
}

/** @param {{ correctAnswer: string, choices: string[] }} values */
export function generateMultipleChoiceGraded(values) {
  const v = values || {};
  const lines = [`\\multiplechoice{${v.correctAnswer || ''}}`];
  for (const choice of (v.choices || [])) {
    lines.push(`\\choice{${choice}}`);
  }
  lines.push('\\endmultiplechoice');
  return lines.join('\n');
}

/** @param {{ choices: string[] }} values */
export function generateMultipleChoiceSurvey(values) {
  const lines = ['\\multiplechoice{multiple}'];
  for (const choice of ((values || {}).choices || [])) {
    lines.push(`\\choice{${choice}}`);
  }
  lines.push('\\endmultiplechoice');
  return lines.join('\n');
}

// ─── Score Block ───────────────────────────────────────────────────────────

/** @param {{ points: number|string, type: string, rubric: string }} values */
export function generateScoreBlock(values) {
  const v = values || {};
  return `\\score{${v.points || 1},${v.type || 'response'}}\n${v.rubric || ''}\n\\endscore`;
}

// ─── Full Question ─────────────────────────────────────────────────────────

/**
 * Generate a complete \question...\endquestion block.
 * @param {{
 *   prompt: string,
 *   aiMode?: string,
 *   responseType: 'text'|'python'|'cpp'|'mc_graded'|'mc_survey'|'none',
 *   responseValues?: object,
 *   feedbackPrompt?: string,
 *   sampleResponses?: string,
 *   followupPrompt?: string,
 *   scoreBlock?: { points, type, rubric }|null,
 * }} values
 */
export function generateQuestion(values) {
  const v = values || {};
  const lines = [`\\question{${v.prompt || ''}}`];

  if (v.aiMode && v.aiMode !== 'no-positive') {
    lines.push(`\\aimode{${v.aiMode}}`);
  }

  const rv = v.responseValues || {};
  switch (v.responseType) {
    case 'text':
      lines.push(generateTextResponse(rv));
      break;
    case 'python':
      lines.push(generatePythonBlock(rv));
      break;
    case 'cpp':
      lines.push(generateCppBlock(rv));
      break;
    case 'mc_graded':
      lines.push(generateMultipleChoiceGraded(rv));
      break;
    case 'mc_survey':
      lines.push(generateMultipleChoiceSurvey(rv));
      break;
    default:
      break; // 'none' — informational question
  }

  if (v.feedbackPrompt)   lines.push(`\\feedbackprompt{${v.feedbackPrompt}}`);
  if (v.sampleResponses)  lines.push(`\\sampleresponses{${v.sampleResponses}}`);
  if (v.followupPrompt)   lines.push(`\\followupprompt{${v.followupPrompt}}`);
  if (v.scoreBlock)       lines.push(generateScoreBlock(v.scoreBlock));

  lines.push('\\endquestion');
  return lines.join('\n');
}
