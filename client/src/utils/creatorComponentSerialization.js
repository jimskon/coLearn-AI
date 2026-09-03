import activityGrammar from '../../../shared/activityGrammar.cjs';

/*
 * Deterministic component replacement for the visual editor.
 *
 * We never insert or update individual lines in a selected component.  We
 * take its complete, parser-provided source range, serialize the editable
 * fields once, and replace that exact range.  This prevents a second visual
 * edit from accumulating another \sampleresponses or \feedbackprompt tag.
 */

// Question-scope tags the inspector owns. Sourced from the syntax authority so
// that adding a tag to the language cannot silently make the editor delete it.
const managedQuestionTags = new Set(activityGrammar.MANAGED_QUESTION_TAGS);

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
  return activityGrammar.isCodeOpenLine(line);
}

function isCodeEnd(line) {
  return activityGrammar.isCodeCloseLine(line);
}

const FIELD_TOKEN = (name) => `__COLEARN_FIELD_${name}__`;
const SCORE_TOKEN = (type) => `__COLEARN_SCORE_${type}__`;
const FIELD_TOKEN_RE = /^__COLEARN_FIELD_([a-z]+)__$/;
const SCORE_TOKEN_RE = /^__COLEARN_SCORE_(response|code|output)__$/;

// The order new fields are introduced in, when the question did not have them
// before. Existing fields keep wherever the author had them.
const FIELD_ORDER = [
  'responsemode', 'textresponse', 'multiplechoice',
  'sampleresponses', 'feedbackprompt', 'followupprompt',
];

/**
 * Index of the last source line of a brace-delimited command starting at
 * startIndex. A tag may be written across several lines --
 * "\sampleresponses{" / text / "}" -- and treating only its first line as the
 * command would leave the continuation lines behind to be re-emitted as body
 * text, duplicating them.
 */
function braceSpanEnd(componentLines, startIndex) {
  let depth = 0;
  let sawBrace = false;
  for (let index = startIndex; index < componentLines.length; index += 1) {
    for (const character of String(componentLines[index] || '')) {
      if (character === '{') { depth += 1; sawBrace = true; }
      else if (character === '}') depth -= 1;
    }
    if (sawBrace && depth <= 0) return index;
  }
  return startIndex;
}

/** Index of the line that closes a block, or the last body line if unclosed. */
function blockEnd(componentLines, startIndex, closeTag) {
  for (let index = startIndex + 1; index < componentLines.length; index += 1) {
    if (String(componentLines[index] || '').trim().toLowerCase() === closeTag) return index;
  }
  return componentLines.length - 2;
}

/**
 * Split a question body into lines to keep verbatim and placeholders for the
 * fields the inspector owns.
 *
 * PRESERVE BY DEFAULT. Anything not explicitly recognised is kept exactly as
 * written. The previous behaviour was the inverse -- only recognised
 * constructs survived and the rest was dropped -- which meant the visual
 * editor silently deleted \info, \image, \link, tables, comments and any tag
 * added to the language after the inspector was written. An editor's job is to
 * change what was asked and leave everything else alone.
 *
 * Managed fields become positional tokens rather than being removed, so a
 * rewritten field stays where the author put it instead of being hoisted to the
 * top of the question.
 */
function managedQuestionBodyLines(componentLines) {
  const preserved = [];
  const originalScoreBlocks = {};
  let inCode = false;

  // Skip \question{...} itself, however many source lines its braces span.
  let index = braceSpanEnd(componentLines, 0) + 1;

  for (; index < componentLines.length - 1; index += 1) {
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

    const name = commandName(trimmed);

    if (name === 'score') {
      const type = trimmed.match(/^\\score\{\s*\d+\s*,\s*(response|code|output)\s*\}/i)?.[1]?.toLowerCase();
      const endIndex = blockEnd(componentLines, index, '\\endscore');
      if (type) {
        preserved.push(SCORE_TOKEN(type));
        // Kept so a score the inspector cannot rebuild can be restored verbatim
        // rather than dropped.
        originalScoreBlocks[type] = componentLines.slice(index, endIndex + 1);
      } else {
        // Unparseable \score header: keep the whole block exactly as written.
        preserved.push(...componentLines.slice(index, endIndex + 1));
      }
      index = endIndex;
      continue;
    }

    if (name === 'multiplechoice') {
      preserved.push(FIELD_TOKEN('multiplechoice'));
      index = blockEnd(componentLines, index, '\\endmultiplechoice');
      continue;
    }

    if (managedQuestionTags.has(name)) {
      preserved.push(FIELD_TOKEN(name));
      index = braceSpanEnd(componentLines, index);
      continue;
    }

    preserved.push(line);
  }

  return { preserved, originalScoreBlocks };
}

/**
 * Rebuild a \score block from inspector state, or keep the original when the
 * inspector cannot represent it. Returning [] here used to delete the block and
 * its instruction text outright whenever points failed to parse or were zero.
 */
function scoreLines(type, pointsValue, instructionsValue, originalBlock) {
  const points = Number.parseInt(pointsValue, 10);
  if (!Number.isFinite(points) || points <= 0) return originalBlock ? [...originalBlock] : [];
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

  const { preserved: body, originalScoreBlocks } = managedQuestionBodyLines(component);

  const fieldLines = {
    responsemode: (mode !== 'answer' || meta?.responseModeLine) ? [`\\responsemode{${mode}}`] : [],
    textresponse: (!isMultipleChoice && responseCount > 0) ? [`\\textresponse{${responseCount}}`] : [],
    multiplechoice: isMultipleChoice
      ? [
        `\\multiplechoice{${selectionMode === 'multiple' ? 'multiple' : answer}}`,
        ...choices.map(({ value, points }) => (
          `\\choice{${value}}${selectionMode === 'single' && Number.isInteger(points) && points >= 0 ? `{${points}}` : ''}`
        )),
        '\\endmultiplechoice',
      ]
      : [],
    sampleresponses: (sample || meta?.sampleLines?.length) ? [`\\sampleresponses{${sample}}`] : [],
    feedbackprompt: (feedback || meta?.feedbackLines?.length) ? [`\\feedbackprompt{${feedback}}`] : [],
    followupprompt: (followup || meta?.followupLines?.length) ? [`\\followupprompt{${followup}}`] : [],
  };

  const scoreBlocks = {
    response: scoreLines('response', isMultipleChoice ? '' : edits?.responseScorePoints, edits?.responseScoreInstructions, originalScoreBlocks.response),
    code: scoreLines('code', edits?.codeScorePoints, edits?.codeScoreInstructions, originalScoreBlocks.code),
    output: scoreLines('output', edits?.outputScorePoints, edits?.outputScoreInstructions, originalScoreBlocks.output),
  };

  // Substitute each field back where it already was.
  const placed = new Set();
  const rebuiltBody = [];
  for (const line of body) {
    const field = String(line).match(FIELD_TOKEN_RE)?.[1];
    if (field) {
      // Managed fields are singletons. A question that somehow accumulated two
      // \sampleresponses collapses to one, kept at the first position -- which
      // is the duplicate-shedding this serializer has always been responsible
      // for, now done without discarding the rest of the body with it.
      if (!placed.has(field)) {
        rebuiltBody.push(...(fieldLines[field] || []));
        placed.add(field);
      }
      continue;
    }
    const scoreType = String(line).match(SCORE_TOKEN_RE)?.[1];
    if (scoreType) {
      if (!placed.has(`score:${scoreType}`)) {
        rebuiltBody.push(...scoreBlocks[scoreType]);
        placed.add(`score:${scoreType}`);
      }
      continue;
    }
    rebuiltBody.push(line);
  }

  // Fields the question did not have before go directly after the prompt, which
  // is where the editor used to put everything.
  const introduced = [];
  for (const field of FIELD_ORDER) {
    if (!placed.has(field)) introduced.push(...(fieldLines[field] || []));
  }
  for (const scoreType of ['response', 'code', 'output']) {
    if (!placed.has(`score:${scoreType}`)) introduced.push(...scoreBlocks[scoreType]);
  }

  const serialized = [
    `\\question{${prompt}}`,
    ...introduced,
    ...rebuiltBody,
    '\\endquestion',
  ];

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
