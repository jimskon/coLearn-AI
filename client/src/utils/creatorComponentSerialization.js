/*
 * Deterministic component replacement for the visual editor.
 *
 * We never insert or update individual lines in a selected component.  We
 * take its complete, parser-provided source range, serialize the editable
 * fields once, and replace that exact range.  This prevents a second visual
 * edit from accumulating another \sampleresponses or \feedbackprompt tag.
 */

const managedQuestionTags = new Set([
  'responsemode',
  'textresponse',
  'sampleresponses',
  'feedbackprompt',
  'followupprompt',
]);

function linesForRange(sourceText, startLine, endLine) {
  const lines = String(sourceText || '').split('\n');
  const start = Number(startLine) - 1;
  const end = Number(endLine) - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= lines.length) {
    return null;
  }
  return { lines, start, end, component: lines.slice(start, end + 1) };
}

function replaceRange(sourceText, startLine, endLine, replacementLines) {
  const range = linesForRange(sourceText, startLine, endLine);
  if (!range) return sourceText;
  range.lines.splice(range.start, range.end - range.start + 1, ...replacementLines);
  return range.lines.join('\n');
}

function commandName(line) {
  return String(line || '').trim().match(/^\\([A-Za-z]+)/)?.[1]?.toLowerCase() || '';
}

function isCodeStart(line) {
  return /^\\(python|pythonremote|pythonturtle|cpp)(?:\{[^}]*\})?\s*$/i.test(String(line || '').trim())
    || /^\\(python|cpp)display(?:\{[^}]*\})?\s*$/i.test(String(line || '').trim());
}

function isCodeEnd(line) {
  return /^\\end(python|pythonremote|pythonturtle|cpp|pythondisplay|cppdisplay)\s*$/i.test(String(line || '').trim());
}

function managedQuestionBodyLines(componentLines) {
  const preserved = [];
  let skipUntil = '';
  let inCode = false;

  for (let index = 1; index < componentLines.length - 1; index += 1) {
    const line = componentLines[index];
    const trimmed = String(line || '').trim();

    if (inCode) {
      preserved.push(line);
      if (isCodeEnd(trimmed)) inCode = false;
      continue;
    }
    if (isCodeStart(trimmed)) {
      inCode = true;
      preserved.push(line);
      continue;
    }
    if (skipUntil) {
      if (trimmed === skipUntil) skipUntil = '';
      continue;
    }
    if (trimmed.startsWith('\\multiplechoice{')) {
      skipUntil = '\\endmultiplechoice';
      continue;
    }
    if (trimmed.startsWith('\\score{')) {
      const type = trimmed.match(/^\\score\{\s*\d+\s*,\s*(response|code|output)\s*\}/i)?.[1]?.toLowerCase();
      if (type) preserved.push(`__COLEARN_SCORE_${type}__`);
      skipUntil = '\\endscore';
      continue;
    }
    if (managedQuestionTags.has(commandName(trimmed))) continue;
    preserved.push(line);
  }
  return preserved;
}

function scoreLines(type, pointsValue, instructionsValue) {
  const points = Number.parseInt(pointsValue, 10);
  if (!Number.isFinite(points) || points <= 0) return [];
  const instructions = String(instructionsValue || '').trim();
  return [
    `\\score{${points},${type}}`,
    ...(instructions ? instructions.split('\n') : []),
    '\\endscore',
  ];
}

function replaceSelectedCode(componentLines, sourceMeta, selectedCodeBlock, starterCode) {
  if (!selectedCodeBlock || String(starterCode ?? '') === String(selectedCodeBlock.content ?? '')) return componentLines;
  const startLine = Number(sourceMeta?.questionLine);
  const open = Number(selectedCodeBlock.openLine) - startLine;
  const close = Number(selectedCodeBlock.closeLine) - startLine;
  if (!Number.isInteger(open) || !Number.isInteger(close) || open < 1 || close <= open || close >= componentLines.length) {
    return componentLines;
  }
  const next = [...componentLines];
  next.splice(open + 1, close - open - 1, ...String(starterCode || '').split('\n'));
  return next;
}

export function serializeQuestionComponent(sourceText, block, edits, selectedCodeBlock, starterCode) {
  const meta = block?.sourceMeta;
  const range = linesForRange(sourceText, meta?.questionLine, meta?.endQuestionLine);
  if (!range) return sourceText;

  const component = replaceSelectedCode(range.component, meta, selectedCodeBlock, starterCode);
  const isMultipleChoice = !!edits?.multipleChoiceEnabled;
  const responseLines = String(edits?.responseLines ?? '').trim();
  const responseCount = responseLines ? Math.max(1, Number.parseInt(responseLines, 10) || 1) : 0;
  const selectionMode = edits?.multipleChoiceSelectionMode === 'multiple' ? 'multiple' : 'single';
  const choices = (edits?.multipleChoiceChoices || [])
    .map((choice) => ({ value: String(choice?.value ?? choice ?? '').trim(), points: choice?.points }))
    .filter((choice) => choice.value);
  const answer = String(edits?.multipleChoiceAnswer || '').trim();
  const prompt = String(edits?.prompt || '').trim();
  const sample = String(edits?.sampleResponse || '').trim();
  const feedback = String(edits?.feedbackPrompt || '').trim();
  const followup = String(edits?.followupPrompt || '').trim();
  const mode = String(edits?.responseMode || block?.responseMode || 'answer').trim().toLowerCase() || 'answer';

  const serialized = [`\\question{${prompt}}`];
  if (mode !== 'answer' || block?.sourceMeta?.responseModeLine) serialized.push(`\\responsemode{${mode}}`);
  if (!isMultipleChoice && responseCount > 0) serialized.push(`\\textresponse{${responseCount}}`);
  if (isMultipleChoice) {
    serialized.push(`\\multiplechoice{${selectionMode === 'multiple' ? 'multiple' : answer}}`);
    serialized.push(...choices.map(({ value, points }) => (
      `\\choice{${value}}${selectionMode === 'single' && Number.isInteger(points) && points >= 0 ? `{${points}}` : ''}`
    )));
    serialized.push('\\endmultiplechoice');
  }
  if (sample || block?.sourceMeta?.sampleLines?.length) serialized.push(`\\sampleresponses{${sample}}`);
  if (feedback || block?.sourceMeta?.feedbackLines?.length) serialized.push(`\\feedbackprompt{${feedback}}`);
  if (followup || block?.sourceMeta?.followupLines?.length) serialized.push(`\\followupprompt{${followup}}`);
  const scores = {
    response: scoreLines('response', isMultipleChoice ? '' : edits?.responseScorePoints, edits?.responseScoreInstructions),
    code: scoreLines('code', edits?.codeScorePoints, edits?.codeScoreInstructions),
    output: scoreLines('output', edits?.outputScorePoints, edits?.outputScoreInstructions),
  };
  const body = managedQuestionBodyLines(component);
  const existingScoreTypes = new Set();
  for (const line of body) {
    const type = String(line).match(/^__COLEARN_SCORE_(response|code|output)__$/)?.[1];
    if (type) existingScoreTypes.add(type);
  }
  for (const type of ['response', 'code', 'output']) {
    if (!existingScoreTypes.has(type)) serialized.push(...scores[type]);
  }
  for (const line of body) {
    const type = String(line).match(/^__COLEARN_SCORE_(response|code|output)__$/)?.[1];
    if (type) serialized.push(...scores[type]);
    else serialized.push(line);
  }
  serialized.push('\\endquestion');

  return replaceRange(sourceText, meta.questionLine, meta.endQuestionLine, serialized);
}

export function serializeAiComponent(sourceText, block, edits, defaultModel, allowedModels) {
  const meta = block?.sourceMeta;
  if (!meta?.aiLine || !meta?.endAiLine) return sourceText;
  const model = allowedModels.some((option) => option.value === edits?.model) ? edits.model : defaultModel;
  const title = String(edits?.title || '').trim();
  const prompt = String(edits?.prompt || '').trim();
  const guardrail = String(edits?.guardrail || '').trim();
  const context = Array.isArray(edits?.contextSources)
    ? edits.contextSources
    : String(edits?.contextSources || '').split(',').map((item) => item.trim()).filter(Boolean);
  const inputRows = Math.max(2, Number.parseInt(edits?.inputRows, 10) || 4);
  const mode = String(edits?.mode || 'explain').trim().toLowerCase() || 'explain';
  const serialized = [
    `\\ai{${mode}}`,
    ...(meta.modelLine || model !== block?.model ? [`\\aimodel{${model}}`] : []),
    ...(title && (meta.titleLine || title !== String(block?.title || '').trim()) ? [`\\aititle{${title}}`] : []),
    ...(prompt || meta.promptLine ? [`\\aiprompt{${prompt}}`] : []),
    ...(guardrail || meta.guardrailLine ? [`\\aiguardrail{${guardrail}}`] : []),
    ...(context.length || meta.contextLine ? [`\\aicontext{${context.join(',')}}`] : []),
    ...(meta.inputLine || inputRows !== Number(block?.inputRows || 4) ? [`\\aiinput{${inputRows}}`] : []),
    '\\endai',
  ];
  return replaceRange(sourceText, meta.aiLine, meta.endAiLine, serialized);
}

export function serializeQuestionGroupComponent(sourceText, block, edits) {
  const meta = block?.sourceMeta;
  if (!meta?.groupLine || !meta?.endGroupLine) return sourceText;
  const range = linesForRange(sourceText, meta.groupLine, meta.endGroupLine);
  if (!range) return sourceText;
  const title = String(edits?.title || '').trim() || 'New Question Group';
  const retries = Math.max(0, Number.parseInt(edits?.retriesRequired, 10) || 0);
  const body = range.component.slice(1, -1).filter((line) => !/^\s*\\retries\{\d+\}\s*$/.test(line));
  let nextText = replaceRange(sourceText, meta.groupLine, meta.endGroupLine, [
    `\\questiongroup{${title}}`,
    ...(meta.retriesLine || retries !== 0 ? [`\\retries{${retries}}`] : []),
    ...body,
    '\\endquestiongroup',
  ]);

  // A section timer is a separate, one-line component immediately before the
  // group. Serialize that one command atomically too, rather than patching a
  // line after the group has changed size.
  const originalLines = String(sourceText || '').split('\n');
  let sectionIndex = -1;
  let sectionTitle = title;
  for (let index = Number(meta.groupLine) - 2; index >= 0; index -= 1) {
    const match = originalLines[index].match(/^\s*\\section\{([^{}]+)\}(?:\{\d+\})?\s*$/);
    if (match) {
      sectionIndex = index;
      sectionTitle = match[1].trim();
      break;
    }
  }
  const timerEnabled = edits?.sectionTimerEnabled === true;
  const minutes = Number.parseInt(edits?.sectionMinutes, 10);
  if (timerEnabled && Number.isFinite(minutes) && minutes > 0) {
    const nextLines = nextText.split('\n');
    if (sectionIndex >= 0) nextLines.splice(sectionIndex, 1, `\\section{${sectionTitle}}{${minutes}}`);
    else nextLines.splice(Number(meta.groupLine) - 1, 0, `\\section{${title}}{${minutes}}`);
    nextText = nextLines.join('\n');
  } else if (!timerEnabled && sectionIndex >= 0) {
    const nextLines = nextText.split('\n');
    nextLines.splice(sectionIndex, 1, `\\section{${sectionTitle}}`);
    nextText = nextLines.join('\n');
  }
  return nextText;
}
