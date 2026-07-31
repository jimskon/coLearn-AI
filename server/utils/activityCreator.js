const fs = require('node:fs');
const path = require('node:path');
const OpenAI = require('openai');
require('dotenv').config();

const CREATOR_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'activity_creator_template.txt');
const MARKUP_HOUSE_STYLE_PATH = path.join(__dirname, '..', 'templates', 'activity_markup_house_style.txt');
const DEFAULT_CREATOR_OPENAI_TIMEOUT_MS = 45000;
const CREATOR_HOUSE_STYLE_SUMMARY = [
  'Markup rules:',
  '- Start with \\title{...}, \\mode{...}, \\studentlevel{...}, \\activitycontext{...}, and \\retries{n}.',
  '- Use \\section{Title} or \\section{Title}{minutes} for each requested section.',
  '- Put interactive work inside \\questiongroup{...} ... \\endquestiongroup.',
  '- Put each prompt inside \\question{...} ... \\endquestion.',
  '- Use \\textresponse{n} for short written answers.',
  '- Use \\multiplechoice{answer} for single-answer multiple-choice questions, and use \\multiplechoice{} for survey questions with no correct answer.',
  '- Never invent a fake correct answer just to satisfy the parser when a multiple-choice question is intended to be a survey.',
  '- Use \\sampleresponses{...} and \\feedbackprompt{...} with plain text only.',
  '- Wrap runnable Python in \\python ... \\endpython or \\pythonremote ... \\endpythonremote.',
  '- Use \\ai{mode} ... \\endai only when it clearly supports the pedagogy.',
  '- Do not include Markdown fences, prose before the activity, or diagnostics.',
].join('\n');

function sanitizeHeaderValue(value, fallback = '') {
  return String(value == null ? fallback : value)
    .replace(/\r\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/[{}]/g, '')
    .trim() || fallback;
}

function normalizeTextBlock(value, fallback = 'Not specified.') {
  const normalized = String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  return normalized || fallback;
}

function normalizeTimedSections(timedSections) {
  if (!Array.isArray(timedSections)) return [];

  return timedSections
    .map((section) => ({
      title: sanitizeHeaderValue(section?.title, ''),
      minutes: Number(section?.minutes),
    }))
    .filter((section) => section.title && Number.isFinite(section.minutes) && section.minutes > 0)
    .map((section) => ({
      title: section.title,
      minutes: Math.round(section.minutes),
    }));
}

function renderRequestedSectionMarkup(majorSections, timedSections) {
  const normalizedMajorSections = Array.isArray(majorSections) ? majorSections : [];
  const timingByTitle = new Map(
    normalizeTimedSections(timedSections).map((section) => [section.title, section.minutes])
  );

  return normalizedMajorSections
    .map((sectionName) => {
      const title = sanitizeHeaderValue(sectionName, 'Section');
      const minutes = timingByTitle.get(title);
      return Number.isFinite(minutes)
        ? `\\section{${title}}{${minutes}}`
        : `\\section{${title}}`;
    })
    .join('\n');
}

function renderFallbackTemplate({
  title,
  mode,
  durationMinutes,
  selectedModel,
  majorSections,
  timedSections,
  retriesRequired,
  classLevel,
  classTopicDomain,
  classDescription,
  activityDescription,
}) {
  const template = fs.readFileSync(CREATOR_TEMPLATE_PATH, 'utf8');

  return template
    .replace('__TITLE__', sanitizeHeaderValue(title, 'New Activity'))
    .replace('__MODE__', sanitizeHeaderValue(mode, 'group'))
    .replace('__CLASS_LEVEL__', sanitizeHeaderValue(classLevel, 'Not specified'))
    .replace('__CLASS_TOPIC_DOMAIN__', sanitizeHeaderValue(classTopicDomain, 'Not specified'))
    .replace('__DURATION_MINUTES__', String(durationMinutes))
    .replace('__SELECTED_MODEL__', sanitizeHeaderValue(selectedModel, 'gpt-5-mini'))
    .replace('__RETRIES_REQUIRED__', String(Math.max(0, Math.round(Number(retriesRequired) || 0))))
    .replace('__MAJOR_SECTIONS_BLOCK__', normalizeTextBlock((majorSections || []).join(', '), 'Not specified.'))
    .replace('__TIMED_SECTIONS_BLOCK__', normalizeTextBlock(
      normalizeTimedSections(timedSections).map((section) => `${section.title}: ${section.minutes} minutes`).join('\n'),
      'No section timers requested.'
    ))
    .replace('__REQUESTED_SECTION_MARKUP__', renderRequestedSectionMarkup(majorSections, timedSections))
    .replace('__CLASS_DESCRIPTION_BLOCK__', normalizeTextBlock(classDescription))
    .replace('__ACTIVITY_DESCRIPTION_BLOCK__', normalizeTextBlock(activityDescription));
}

function stripCodeFences(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1].trim() : raw;
}

function extractJsonObject(text) {
  const raw = stripCodeFences(text);
  try {
    return JSON.parse(raw);
  } catch (_) {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(raw.slice(first, last + 1));
    }
    throw new Error('Model response was not valid JSON.');
  }
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}

function normalizeLegacyCommandSyntax(text) {
  return String(text || '')
    .replace(/^\\begin\{questiongroup\}\{([^}]*)\}$/gm, '\\questiongroup{$1}')
    .replace(/^\\begin\{question\}\{([^}]*)\}$/gm, '\\question{$1}')
    .replace(/^\\begin\{pythonremote\}$/gm, '\\pythonremote')
    .replace(/^\\begin\{python\}$/gm, '\\python')
    .replace(/^\\begin\{cpp\}$/gm, '\\cpp')
    .replace(/^\\begin\{pythonturtle\}(?:\{([^}]*)\})?$/gm, (_match, args) => args ? `\\pythonturtle{${args}}` : '\\pythonturtle')
    .replace(/^\\end\{questiongroup\}$/gm, '\\endquestiongroup')
    .replace(/^\\end\{question\}$/gm, '\\endquestion')
    .replace(/^\\end\{pythonremote\}$/gm, '\\endpythonremote')
    .replace(/^\\end\{python\}$/gm, '\\endpython')
    .replace(/^\\end\{cpp\}$/gm, '\\endcpp')
    .replace(/^\\end\{pythonturtle\}$/gm, '\\endpythonturtle');
}

function decodeCommonHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function splitObjectiveCandidates(text) {
  return String(text || '')
    .split(/\n|;|(?=\d+\))/)
    .map((item) => item.replace(/^\d+\)\s*/, '').trim())
    .filter(Boolean);
}

function normalizeLearningObjectivesSection(text) {
  const lines = String(text || '').split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /^\\section\{Learning Objectives\}(?:\{\d+\})?$/.test(line.trim()));

  if (startIndex === -1) {
    return text;
  }

  let firstContentIndex = startIndex + 1;
  while (firstContentIndex < lines.length && !lines[firstContentIndex].trim()) {
    firstContentIndex += 1;
  }

  if (firstContentIndex >= lines.length) {
    return text;
  }

  const firstContentLine = lines[firstContentIndex].trim();
  if (
    firstContentLine.startsWith('\\text{') ||
    firstContentLine.startsWith('\\begin{itemize}') ||
    firstContentLine.startsWith('\\questiongroup{')
  ) {
    return text;
  }

  let endIndex = firstContentIndex;
  while (endIndex < lines.length) {
    const trimmed = lines[endIndex].trim();
    if (!trimmed) {
      endIndex += 1;
      continue;
    }
    if (trimmed.startsWith('\\section{') || trimmed.startsWith('\\questiongroup{')) {
      break;
    }
    endIndex += 1;
  }

  const contentLines = lines
    .slice(firstContentIndex, endIndex)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!contentLines.length) {
    return text;
  }

  const objectiveLines = contentLines.filter(
    (line) => line.toLowerCase() !== 'students will be able to:'
  );

  if (!objectiveLines.length) {
    return text;
  }

  const containsCommands = objectiveLines.some((line) => line.startsWith('\\'));
  const normalizedObjectiveLines = containsCommands
    ? objectiveLines.flatMap((line) => {
        if (/^\\sampleresponses\{/.test(line)) {
          const args = parseCommandArgs(line, 'sampleresponses');
          return splitObjectiveCandidates(args?.[0] || '');
        }
        if (line.startsWith('\\item ')) {
          return [line.replace(/^\\item\s+/, '').trim()];
        }
        if (!line.startsWith('\\')) {
          return splitObjectiveCandidates(line);
        }
        return [];
      })
    : objectiveLines;

  if (!normalizedObjectiveLines.length) {
    return text;
  }

  const replacement = [
    '\\text{Students will be able to:}',
    '\\begin{itemize}',
    ...normalizedObjectiveLines.map((line) => `\\item ${line.replace(/^[-*]\s*/, '')}`),
    '\\end{itemize}',
  ];

  return [
    ...lines.slice(0, firstContentIndex),
    ...replacement,
    ...lines.slice(endIndex),
  ].join('\n');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyRetriesDirective(text, retriesRequired) {
  const count = Math.max(0, Math.round(Number(retriesRequired) || 0));
  const directive = `\\retries{${count}}`;

  if (/^\\retries\{\d+\}$/m.test(text)) {
    return text.replace(/^\\retries\{\d+\}$/m, directive);
  }

  const lines = String(text || '').split(/\r?\n/);
  const anchorIndex = lines.findIndex((line) => /^\\activitycontext\{/.test(line.trim()) || /^\\studentlevel\{/.test(line.trim()) || /^\\mode\{/.test(line.trim()));
  const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : 0;
  lines.splice(insertAt, 0, directive);
  return lines.join('\n');
}

function applyTimedSectionDirectives(text, timedSections) {
  let nextText = String(text || '');

  for (const section of normalizeTimedSections(timedSections)) {
    const pattern = new RegExp(`^\\\\section\\{${escapeRegExp(section.title)}\\}(?:\\{\\d+\\})?$`, 'm');
    if (pattern.test(nextText)) {
      nextText = nextText.replace(pattern, `\\section{${section.title}}{${section.minutes}}`);
    }
  }

  return nextText;
}

function normalizePythonTurtleDirectives(text) {
  return String(text || '').replace(/^\\pythonturtle\{(\d+\s*[xX]\s*\d+)\s*,\s*(\d+)\}$/gm, (match, dims, timeout) => {
    const parsedTimeout = Number(timeout);
    return Number.isFinite(parsedTimeout) && parsedTimeout > 0 && parsedTimeout < 1000
      ? '\\pythonturtle{' + dims.replace(/\s+/g, '') + '}'
      : match;
  });
}

function repairGeneratedMarkupClosures(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const repaired = [];
  let inQuestionGroup = false;
  let inQuestion = false;
  let inAiBlock = false;

  function closeAiBlock() {
    if (inAiBlock) {
      repaired.push('\\endai');
      inAiBlock = false;
    }
  }

  function closeQuestion() {
    closeAiBlock();
    if (inQuestion) {
      repaired.push('\\endquestion');
      inQuestion = false;
    }
  }

  function closeQuestionGroup() {
    closeQuestion();
    if (inQuestionGroup) {
      repaired.push('\\endquestiongroup');
      inQuestionGroup = false;
    }
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('\\section{')) {
      closeQuestionGroup();
      repaired.push(rawLine);
      continue;
    }

    if (trimmed.startsWith('\\questiongroup{')) {
      closeQuestionGroup();
      inQuestionGroup = true;
      repaired.push(rawLine);
      continue;
    }

    if (trimmed.startsWith('\\question{')) {
      if (!inQuestionGroup) {
        inQuestionGroup = true;
        repaired.push('\\questiongroup{Question Group}');
      }
      closeQuestion();
      inQuestion = true;
      repaired.push(rawLine);
      continue;
    }

    if (trimmed.startsWith('\\ai{')) {
      if (inAiBlock) {
        closeAiBlock();
      }
      inAiBlock = true;
      repaired.push(rawLine);
      continue;
    }

    if (trimmed === '\\endai') {
      if (inAiBlock) {
        repaired.push(rawLine);
        inAiBlock = false;
      }
      continue;
    }

    if (trimmed === '\\endquestion') {
      closeAiBlock();
      if (inQuestion) {
        repaired.push(rawLine);
        inQuestion = false;
      }
      continue;
    }

    if (trimmed === '\\endquestiongroup') {
      closeQuestion();
      if (inQuestionGroup) {
        repaired.push(rawLine);
        inQuestionGroup = false;
      }
      continue;
    }

    repaired.push(rawLine);
  }

  closeQuestionGroup();

  return repaired.join('\n');
}

function questionLikelyNeedsPythonBlock(questionLines) {
  const joined = questionLines.join('\n');
  const lower = joined.toLowerCase();

  const definitelyProseTask =
    /\b(objective|objectives|reflection|reflect|paragraph|sentence|sentences|explain|description|describe|summarize|summary|idea|ideas|list)\b/.test(lower) ||
    (/\bprompt\b/.test(lower) && !/\bpython prompt\b/.test(lower) && !/\bcode prompt\b/.test(lower));

  if (definitelyProseTask) {
    return false;
  }

  const asksForCodeWork =
    /\b(write|modify|change|edit|update|create|build|complete|revise|fix)\b/.test(lower) &&
    /\b(code|program|python|script)\b/.test(lower);

  const asksToShowCode =
    /\b(show|paste|enter)\b/.test(lower) &&
    /\b(code|program)\b/.test(lower);

  const sampleLooksLikeCode =
    /\\sampleresponses\{[\s\S]*(print\s*\(|input\s*\(|if\s+|[A-Za-z_][A-Za-z0-9_]*\s*=)/i.test(joined);

  return asksForCodeWork || asksToShowCode || sampleLooksLikeCode;
}

function questionNeedsPythonBlockFromParts({ prompt = '', details = [], sample = '' }) {
  return questionLikelyNeedsPythonBlock([
    `\\question{${prompt}}`,
    ...details,
    sample ? `\\sampleresponses{${sample}}` : '',
  ].filter(Boolean));
}

function repairCodingQuestionsToUsePythonBlocks(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const output = [];
  let questionBuffer = null;
  let currentCodeTemplate = [];

  function flushQuestionBuffer() {
    if (!questionBuffer) return;

    const hasPythonBlock = questionBuffer.lines.some((line) =>
      /^\\(python|pythonremote|pythonturtle)(?:\{|$)/i.test(line.trim())
    );

    if (!hasPythonBlock && questionLikelyNeedsPythonBlock(questionBuffer.lines)) {
      const insertAt = questionBuffer.lines.findIndex((line) => /^\\textresponse\{/.test(line.trim()));
      const pythonSeed = currentCodeTemplate.length ? [...currentCodeTemplate] : ['# Write your Python code here'];
      const pythonBlock = ['\\python', ...pythonSeed, '\\endpython'];

      if (insertAt >= 0) {
        questionBuffer.lines.splice(insertAt, 1, ...pythonBlock);
      } else {
        const endIndex = questionBuffer.lines.findIndex((line) => line.trim() === '\\endquestion');
        if (endIndex >= 0) {
          questionBuffer.lines.splice(endIndex, 0, ...pythonBlock);
        } else {
          questionBuffer.lines.push(...pythonBlock);
        }
      }
    }

    output.push(...questionBuffer.lines);
    questionBuffer = null;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('\\question{')) {
      flushQuestionBuffer();
      questionBuffer = { lines: [rawLine] };
      continue;
    }

    if (questionBuffer) {
      questionBuffer.lines.push(rawLine);
      if (trimmed === '\\endquestion') {
        flushQuestionBuffer();
      }
    } else {
      output.push(rawLine);
    }

    if (/^\\(python|pythonremote|pythonturtle)(?:\{|$)/i.test(trimmed)) {
      const nextTemplate = [];
      index += 1;
      while (index < lines.length && !/^\\end(python|pythonremote|pythonturtle)$/i.test(lines[index].trim())) {
        nextTemplate.push(lines[index]);
        if (!questionBuffer) {
          output.push(lines[index]);
        }
        index += 1;
      }
      if (index < lines.length) {
        const closingLine = lines[index];
        if (!questionBuffer) {
          output.push(closingLine);
        } else {
          questionBuffer.lines.push(...nextTemplate, closingLine);
        }
      }
      currentCodeTemplate = nextTemplate;
    }
  }

  flushQuestionBuffer();
  return output.join('\n');
}

function repairUnsupportedStructuredResponsePrompts(text) {
  return String(text || '')
    .replace(/\s*\(one per line\)\./gi, '.')
    .replace(/\s*\(one on each line\)\./gi, '.')
    .replace(/\s*\(one idea per line\)\./gi, '.')
    .replace(/\s*\(one sentence per line\)\./gi, '.')
    .replace(/\s*\(one per line\)/gi, '')
    .replace(/\s*\(one on each line\)/gi, '')
    .replace(/\s*\(one idea per line\)/gi, '')
    .replace(/\s*\(one sentence per line\)/gi, '')
    .replace(
      /\\question\{Each group member:\s*write your name and which role you were assigned\.?\}/gi,
      '\\question{As a group, briefly note which roles were assigned within your group.}'
    )
    .replace(
      /\\question\{Each group member:\s*([^}]*)\}/gi,
      '\\question{As a group, give one concise shared response: $1}'
    );
}

function escapeMarkupText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[{}]/g, '')
    .trim();
}

function looksLikePythonCode(line) {
  const text = String(line || '');
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(if|elif|else|for|while|def|class|return|import|from|print)\b/.test(trimmed)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)) return true;
  if (/(input|print|lower)\s*\(/.test(trimmed)) return true;
  if (/^\s+/.test(text) && /[A-Za-z0-9_]/.test(trimmed)) return true;
  return false;
}

function flushPlaintextQuestion(question, output) {
  if (!question?.prompt) return;

  const promptParts = [question.prompt];
  if (question.details.length) {
    promptParts.push(question.details.join(' '));
  }

  output.push(`\\question{${escapeMarkupText(promptParts.join(' '))}}`);

  if (question.code.length) {
    output.push('\\python');
    output.push(...question.code);
    output.push('\\endpython');
  } else if (questionNeedsPythonBlockFromParts(question)) {
    const pythonSeed = question.codeTemplate?.length
      ? [...question.codeTemplate]
      : ['# Write your Python code here'];
    output.push('\\python');
    output.push(...pythonSeed);
    output.push('\\endpython');
  } else {
    output.push(`\\textresponse{${question.responseLines}}`);
  }

  if (question.sample) {
    output.push(`\\sampleresponses{${escapeMarkupText(question.sample)}}`);
  }

  if (question.feedback) {
    output.push(`\\feedbackprompt{${escapeMarkupText(question.feedback)}}`);
  }

  output.push('\\endquestion');
}

function coercePlaintextActivityToMarkup(text, fallbackInput) {
  const rawLines = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  if (rawLines.some((line) => line.trim().startsWith('\\'))) {
    return null;
  }

  const normalizedSections = Array.isArray(fallbackInput?.majorSections) && fallbackInput.majorSections.length
    ? fallbackInput.majorSections
    : ['Learning Objectives', 'Exploration', 'Concept Invention', 'Application', 'Reflection'];

  const metadata = {
    title: sanitizeHeaderValue(fallbackInput?.title, 'New Activity'),
    mode: sanitizeHeaderValue(fallbackInput?.mode, 'group'),
    studentLevel: sanitizeHeaderValue(fallbackInput?.classLevel, 'Any'),
    activityContext: sanitizeHeaderValue(fallbackInput?.classTopicDomain, 'Any'),
  };

  const sectionSet = new Set(normalizedSections.map((item) => item.trim()));
  const output = [
    `\\title{${metadata.title}}`,
    `\\mode{${metadata.mode}}`,
    `\\studentlevel{${metadata.studentLevel}}`,
    `\\activitycontext{${metadata.activityContext}}`,
    `\\retries{${Math.max(0, Math.round(Number(fallbackInput?.retriesRequired) || 0))}}`,
  ];

  let currentSection = '';
  let currentGroupTitle = '';
  let currentQuestion = null;
  let currentCodeTemplate = [];
  let inObjectivesList = false;
  let sawQuestionGroup = false;

  function closeObjectivesList() {
    if (inObjectivesList) {
      output.push('\\end{itemize}');
      inObjectivesList = false;
    }
  }

  function closeQuestion() {
    if (currentQuestion) {
      flushPlaintextQuestion(currentQuestion, output);
      if (currentQuestion.code.length) {
        currentCodeTemplate = [...currentQuestion.code];
      }
      currentQuestion = null;
    }
  }

  function closeQuestionGroup() {
    closeQuestion();
    if (currentGroupTitle) {
      output.push('\\endquestiongroup');
      currentGroupTitle = '';
    }
  }

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;

    const titleMatch = line.match(/^Title:\s*(.+)$/i);
    if (titleMatch) {
      metadata.title = sanitizeHeaderValue(titleMatch[1], metadata.title);
      output[0] = `\\title{${metadata.title}}`;
      continue;
    }

    const modeMatch = line.match(/^mode:\s*(.+)$/i);
    if (modeMatch) {
      metadata.mode = sanitizeHeaderValue(modeMatch[1], metadata.mode);
      output[1] = `\\mode{${metadata.mode}}`;
      continue;
    }

    const levelMatch = line.match(/^Student level:\s*(.+)$/i);
    if (levelMatch) {
      metadata.studentLevel = sanitizeHeaderValue(levelMatch[1], metadata.studentLevel);
      output[2] = `\\studentlevel{${metadata.studentLevel}}`;
      continue;
    }

    const contextMatch = line.match(/^Context:\s*(.+)$/i);
    if (contextMatch) {
      metadata.activityContext = sanitizeHeaderValue(contextMatch[1], metadata.activityContext);
      output[3] = `\\activitycontext{${metadata.activityContext}}`;
      continue;
    }

    if (sectionSet.has(line)) {
      closeObjectivesList();
      closeQuestionGroup();
      currentSection = line;
      const timedMinutes = normalizeTimedSections(fallbackInput?.timedSections).find((section) => section.title === line)?.minutes;
      output.push(Number.isFinite(timedMinutes) ? `\\section{${line}}{${timedMinutes}}` : `\\section{${line}}`);
      continue;
    }

    if (currentSection === 'Learning Objectives' && /^Students will be able to:?$/i.test(line)) {
      output.push('\\text{Students will be able to:}');
      output.push('\\begin{itemize}');
      inObjectivesList = true;
      continue;
    }

    if (currentSection === 'Learning Objectives' && !currentGroupTitle) {
      if (!inObjectivesList) {
        output.push('\\text{Students will be able to:}');
        output.push('\\begin{itemize}');
        inObjectivesList = true;
      }
      output.push(`\\item ${escapeMarkupText(line.replace(/^[-*]\s*/, ''))}`);
      continue;
    }

    closeObjectivesList();

    const groupMatch = line.match(/^(?:\d+\.\s*)?(.+)$/);
    const questionMatch = line.match(/^[a-z]\.\s+(.+)$/i);

    if (questionMatch) {
      if (!currentGroupTitle) {
        currentGroupTitle = 'Question Group';
        output.push(`\\questiongroup{${currentGroupTitle}}`);
        sawQuestionGroup = true;
      }
      closeQuestion();
      currentQuestion = {
        prompt: questionMatch[1].trim(),
        details: [],
        code: [],
        codeTemplate: currentCodeTemplate,
        sample: '',
        feedback: '',
        responseLines: 3,
      };
      continue;
    }

    if (groupMatch && /^\d+\.\s+/.test(line) && !/^Question Group\b/i.test(groupMatch[1].trim())) {
      closeQuestionGroup();
      currentGroupTitle = escapeMarkupText(groupMatch[1]);
      output.push(`\\questiongroup{${currentGroupTitle}}`);
      sawQuestionGroup = true;
      continue;
    }

    if (!currentQuestion) {
      continue;
    }

    if (/^Sample:\s*/i.test(line)) {
      currentQuestion.sample = line.replace(/^Sample:\s*/i, '').trim();
      continue;
    }

    if (/^Feedback:\s*/i.test(line)) {
      currentQuestion.feedback = line.replace(/^Feedback:\s*/i, '').trim();
      continue;
    }

    if (/^⏱/.test(line) || /^Type input\(\) here/i.test(line)) {
      continue;
    }

    if (looksLikePythonCode(rawLine)) {
      currentQuestion.code.push(rawLine.replace(/\t/g, '  '));
      continue;
    }

    currentQuestion.details.push(line);
  }

  closeObjectivesList();
  closeQuestionGroup();

  if (!sawQuestionGroup) {
    return null;
  }

  return output.join('\n');
}

function normalizeGeneratedDraft(text, fallbackInput) {
  const stripped = repairUnsupportedStructuredResponsePrompts(
    decodeCommonHtmlEntities(
      normalizeLegacyCommandSyntax(stripCodeFences(text))
    )
  );
  const plaintextMarkup = coercePlaintextActivityToMarkup(stripped, fallbackInput);
  const cleaned = repairCodingQuestionsToUsePythonBlocks(
    repairGeneratedMarkupClosures(
      normalizePythonTurtleDirectives(
        applyTimedSectionDirectives(
          applyRetriesDirective(
            normalizeLearningObjectivesSection(plaintextMarkup || stripped),
            fallbackInput.retriesRequired
          ),
          fallbackInput.timedSections
        )
      )
    )
  );
  const normalized = cleaned;

  if (!normalized.includes('\\title{') || !normalized.includes('\\questiongroup{')) {
    return {
      text: renderFallbackTemplate(fallbackInput),
      usedFallback: true,
      reason: 'Model output did not pass activity markup validation.',
      rawOutput: cleaned,
    };
  }
  return {
    text: normalized,
    usedFallback: false,
    reason: null,
    rawOutput: normalized,
  };
}

function getCreatorOpenAiTimeoutMs() {
  const parsed = Number(process.env.CREATOR_OPENAI_TIMEOUT_MS || DEFAULT_CREATOR_OPENAI_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : DEFAULT_CREATOR_OPENAI_TIMEOUT_MS;
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateWithOpenAI({
  title,
  mode,
  durationMinutes,
  selectedModel,
  majorSections,
  timedSections,
  retriesRequired,
  classLevel,
  classTopicDomain,
  classDescription,
  activityDescription,
}) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const normalizedTimedSections = normalizeTimedSections(timedSections);
  const timeoutMs = getCreatorOpenAiTimeoutMs();

  const system = [
    'You are an expert instructional designer creating editable activity markup for coLearn-AI.',
    'Return only valid activity markup. Do not use Markdown code fences. Do not add commentary before or after the markup.',
    'Use these commands when appropriate: \\title{...}, \\mode{...}, \\studentlevel{...}, \\activitycontext{...}, \\retries{n}, \\section{...}, \\section{...}{minutes}, \\questiongroup{...}, \\question{...}, \\textresponse{n}, \\info{target,seconds}{...}, \\sampleresponses{...}, \\feedbackprompt{...}, \\followupprompt{...}, \\python ... \\endpython, \\pythonremote ... \\endpythonremote, \\cpp ... \\endcpp, \\ai{mode}, \\aititle{...}, \\aiprompt{...}, \\aiguardrail{...}, \\aicontext{...}, \\aiinput{n}, \\endai, \\endquestion, \\endquestiongroup.',
    'Only include \\info blocks if the creator explicitly asks for them.',
    'If you use \\info, only use these targets: questiongroup, question, textresponse, coderesponse, submitbutton, and aifeedback. Never use \\info{instructor,...}.',
    'Always produce a complete first-pass activity draft with at least one \\section and at least one \\questiongroup.',
    'Prefer 2-3 question groups for a first-pass draft. Keep the scope realistic for the requested duration.',
    'Keep each question concise. Keep sample responses and feedback prompts short.',
    'Do not echo the creator brief, requested sections, diagnostics, or planning notes into the activity body.',
    'It is better to finish a complete compact activity than to begin a longer activity and stop halfway through.',
    'Treat Learning Objectives as a structural section, not as an interactive activity, unless the creator explicitly asks otherwise.',
    'If a timed section plan is provided, use the exact section titles and emit them as \\section{Title}{minutes}.',
    'If the activity uses turtle graphics, always wrap the turtle code in \\pythonturtle ... \\endpythonturtle.',
    'For \\pythonturtle blocks, do not invent tiny explicit timeouts. Omit the timeout unless a specific non-default runtime limit is truly needed. Prefer \\pythonturtle{WxH} over \\pythonturtle{WxH,timeout}.',
    'Emit one global \\retries{n} directive near the top of the activity using the requested retry count.',
    'If you include code examples, wrap them in explicit code blocks such as \\cpp ... \\endcpp, \\python ... \\endpython, or \\pythonremote ... \\endpythonremote. Never paste raw code directly into question text.',
    'Only use a runnable \\python block when students must write or modify executable Python code.',
    'If students are asked to modify existing code, repeat the current code in a new editable \\python block so they can run and test the changed version.',
    'Use \\textresponse for prose tasks such as objectives, predictions, explanations, prompt-writing, reflections, lists, and short written answers.',
    'Do not ask multiple students to type separate answers into one shared text box.',
    'Do not ask for unsupported response formats such as "one per line", per-student rosters, tables-in-a-textbox, or "each group member writes ..." inside a single \\textresponse.',
    'If you need multiple contributions, ask for one concise group summary or split the work into separate questions.',
    'If the creator specifies language constraints or allowed constructs, obey them exactly. Do not introduce unrelated syntax, libraries, or data structures.',
    'If you include multiple-choice questions, use \\multiplechoice{answer} only for questions with a real correct answer. For survey or opinion questions, keep \\multiplechoice{} blank and never invent a placeholder answer to satisfy validation.',
    'Do not use \\ai blocks unless the creator explicitly asks for inline AI interaction inside the activity.',
    'If you do use an \\ai block, keep it tightly scoped and include a guardrail.',
    'Use the compact house-style rules below as syntax guidance.',
    'For mode=group, use collaborative prompts and progression.',
    'For mode=demo, use guided observation, prediction, and explanation prompts suitable for individual experimentation.',
    'For mode=test, use concise, direct prompts suitable for individual completion and avoid collaborative wording.',
    'Make the activity reflect the creator brief, not generic filler.',
    '',
    CREATOR_HOUSE_STYLE_SUMMARY,
  ].join('\n');

  const user = [
    `Activity title: ${title}`,
    `Mode: ${mode}`,
    `Target duration (minutes): ${durationMinutes}`,
    `Global retries required before bypass: ${Math.max(0, Math.round(Number(retriesRequired) || 0))}`,
    `Use these major sections in this order: ${(majorSections || []).join(' | ') || 'Learning Objectives | Exploration | Concept Invention | Application | Reflection'}`,
    normalizedTimedSections.length
      ? `Timed sections (use these exact titles and minutes):\n${normalizedTimedSections.map((section) => `- ${section.title}: ${section.minutes}`).join('\n')}`
      : 'Timed sections: none requested.',
    `Class level: ${classLevel || 'Not specified'}`,
    `Topic/domain: ${classTopicDomain || 'Not specified'}`,
    `Class description:\n${classDescription || 'Not specified.'}`,
    `Creator brief:\n${activityDescription}`,
    '',
    'Write a useful first-pass activity draft now.',
  ].join('\n\n');

  const request = {
    model: selectedModel,
    instructions: system,
    input: user,
    text: { format: { type: 'text' } },
    max_output_tokens: 3500,
  };

  if (!String(selectedModel || '').startsWith('gpt-5')) {
    request.temperature = 0.7;
  }

  const response = await withTimeout(
    openai.responses.create(request),
    timeoutMs,
    'Creator draft generation'
  );
  const raw = response.output_text || '';
  return raw;
}

async function reviseWithOpenAI({
  currentText,
  revisionRequest,
  selectedModel,
  title,
  classLevel,
  classTopicDomain,
  classDescription,
  parseIssues,
}) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const houseStyle = fs.readFileSync(MARKUP_HOUSE_STYLE_PATH, 'utf8').trim();
  const timeoutMs = getCreatorOpenAiTimeoutMs();

  const system = [
    'You are an expert instructional designer revising coLearn-AI activity markup.',
    'Return only strict JSON with keys: proposedDocText, summary, warnings.',
    'proposedDocText must be the complete revised activity markup, not a patch and not commentary.',
    'summary and warnings must be arrays of short strings.',
    'Preserve valid activity syntax and existing structure unless the creator request requires a change.',
    'For targeted requests such as "change 3a" or "add after 4b", make the smallest coherent edit that satisfies the request.',
    'If a multiple-choice question is a survey or opinion item, keep \\multiplechoice{} blank and do not invent a correct answer just to satisfy parser validation.',
    'Only include \\info blocks if the creator explicitly asks for them.',
    'If you use \\info, only use these targets: questiongroup, question, textresponse, coderesponse, submitbutton, and aifeedback. Never use \\info{instructor,...}.',
    'If the activity uses turtle graphics, always wrap the turtle code in \\pythonturtle ... \\endpythonturtle.',
    'Do not put activity commands such as \\pythonturtle, \\python, \\question, or \\section inside \\sampleresponses{...}, \\feedbackprompt{...}, or \\followupprompt{...}.',
    'Keep sample responses and feedback prompts plain text.',
    'Never omit required closing tags such as \\endquestion and \\endquestiongroup.',
    'Use this house-style example as syntax guidance:',
    houseStyle,
  ].join('\n');

  const issuesBlock = Array.isArray(parseIssues) && parseIssues.length
    ? parseIssues
        .slice(0, 20)
        .map((issue) => `- ${issue.severity || issue.code || 'issue'} line ${issue.line || '?'}: ${issue.message || issue.context || ''}`)
        .join('\n')
    : 'No parser issues reported by the client.';

  const user = [
    `Activity title: ${title || 'Untitled activity'}`,
    `Class level: ${classLevel || 'Not specified'}`,
    `Topic/domain: ${classTopicDomain || 'Not specified'}`,
    `Class description:\n${classDescription || 'Not specified.'}`,
    `Creator request:\n${revisionRequest}`,
    `Current parser issues:\n${issuesBlock}`,
    'Current activity markup:',
    currentText,
    '',
    'Revise the current activity markup now. Return strict JSON only.',
  ].join('\n\n');

  const request = {
    model: selectedModel,
    instructions: system,
    input: user,
    text: { format: { type: 'text' } },
    max_output_tokens: 5000,
  };

  if (!String(selectedModel || '').startsWith('gpt-5')) {
    request.temperature = 0.45;
  }

  const response = await withTimeout(
    openai.responses.create(request),
    timeoutMs,
    'Creator draft revision'
  );
  return response.output_text || '';
}

function normalizeQuestionMarkup(text) {
  const normalized = stripCodeFences(String(text || '')).trim();
  if (!normalized || !/^\\question\{[\s\S]*\}/.test(normalized) || !/\\endquestion\s*$/.test(normalized)) {
    return null;
  }
  if (/\\(?:questiongroup|endquestiongroup|section)\b/.test(normalized)) {
    return null;
  }
  return normalized;
}

function buildQuestionRevisionResponseFormat() {
  return {
    type: 'json_schema',
    name: 'question_revision',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['proposedQuestionMarkup', 'summary', 'warnings'],
      properties: {
        proposedQuestionMarkup: { type: 'string' },
        summary: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } },
      },
    },
  };
}

function extractQuestionMarkupFromText(text) {
  const raw = stripCodeFences(text);
  const start = raw.indexOf('\\question{');
  const end = raw.lastIndexOf('\\endquestion');
  if (start < 0 || end < start) return null;
  return normalizeQuestionMarkup(raw.slice(start, end + '\\endquestion'.length));
}

function parseQuestionRevisionOutput(raw) {
  try {
    const parsed = extractJsonObject(raw);
    return {
      proposedQuestionMarkup: normalizeQuestionMarkup(
        parsed.proposedQuestionMarkup || parsed.proposed_question_markup || parsed.markup
      ),
      summary: normalizeStringList(parsed.summary),
      warnings: normalizeStringList(parsed.warnings),
      recoveredFromMarkup: false,
    };
  } catch (error) {
    const proposedQuestionMarkup = extractQuestionMarkupFromText(raw);
    if (!proposedQuestionMarkup) throw error;
    return {
      proposedQuestionMarkup,
      summary: ['Recovered the proposed question from the model response.'],
      warnings: ['The model did not return valid JSON, but its complete question markup was recovered.'],
      recoveredFromMarkup: true,
    };
  }
}

function buildQuestionRevisionInstructions() {
  return [
    'You are an expert instructional designer revising one coLearn-AI question block.',
    'Return only strict JSON with keys: proposedQuestionMarkup, summary, warnings.',
    'proposedQuestionMarkup must contain exactly one complete \\question{...} ... \\endquestion block.',
    'Do not emit \\questiongroup, \\endquestiongroup, \\section, or commentary.',
    'Keep the surrounding activity structure unchanged because you are revising only this question.',
    'The creator request is a required specification, not a suggestion. You may revise every part of this question block.',
    'When the request changes what the learner must do, explicitly rewrite the learner-facing \\question{...} text. Do not leave that text unchanged merely because you updated starter code.',
    'Keep the question prompt, code, response type, sample responses, feedback prompts, follow-up prompts, and any \\ai blocks consistent with the requested learning task. Change every dependent part that needs changing.',
    'For multiple-choice questions, preserve the author’s intent: use \\multiplechoice{answer} only for questions that truly have a correct answer, and keep \\multiplechoice{} blank for survey or opinion questions. Never invent a placeholder answer to satisfy the parser.',
    'Keep sample responses and feedback prompts plain text.',
    'Retain only valid coLearn-AI response-type blocks such as \\textresponse, \\python, \\pythonremote, \\pythonturtle, \\cpp, and \\ai.',
    'In summary, briefly state the learner-facing changes you made.',
  ].join('\n');
}

function isOutputTokenTruncation(response) {
  return response?.status === 'incomplete' && response?.incomplete_details?.reason === 'max_output_tokens';
}

async function reviseQuestionWithOpenAI({
  questionMarkup,
  revisionRequest,
  selectedModel,
  title,
  classLevel,
  classTopicDomain,
  classDescription,
  groupTitle,
}) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const timeoutMs = getCreatorOpenAiTimeoutMs();
  const system = buildQuestionRevisionInstructions();
  const user = [
    `Activity title: ${title || 'Untitled activity'}`,
    `Question group: ${groupTitle || 'Not specified'}`,
    `Class level: ${classLevel || 'Not specified'}`,
    `Topic/domain: ${classTopicDomain || 'Not specified'}`,
    `Class description:\n${classDescription || 'Not specified.'}`,
    `Creator request:\n${revisionRequest}`,
    'Current question markup:',
    questionMarkup,
  ].join('\n\n');
  const request = {
    model: selectedModel,
    instructions: system,
    input: user,
    text: { format: buildQuestionRevisionResponseFormat() },
    max_output_tokens: 3200,
  };
  if (!String(selectedModel || '').startsWith('gpt-5')) request.temperature = 0.35;
  const createResponse = (maxOutputTokens) => withTimeout(
    openai.responses.create({ ...request, max_output_tokens: maxOutputTokens }),
    timeoutMs,
    'Creator question revision'
  );

  let response = await createResponse(request.max_output_tokens);
  if (isOutputTokenTruncation(response)) {
    response = await createResponse(request.max_output_tokens * 2);
  }
  if (response?.status === 'incomplete') {
    const reason = response?.incomplete_details?.reason || 'unknown reason';
    throw new Error(`Question revision output was incomplete after retry (${reason}).`);
  }

  const output = String(response?.output_text || '').trim();
  if (!output) throw new Error('Question revision returned an empty response.');
  return output;
}

async function generateActivityDraft(input) {
  const fallbackInput = {
    title: input.title,
    mode: input.mode,
    durationMinutes: input.durationMinutes,
    selectedModel: input.selectedModel,
    majorSections: input.majorSections,
    timedSections: input.timedSections,
    retriesRequired: input.retriesRequired,
    classLevel: input.classLevel,
    classTopicDomain: input.classTopicDomain,
    classDescription: input.classDescription,
    activityDescription: input.activityDescription,
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'test-key') {
    return {
      text: renderFallbackTemplate(fallbackInput),
      generation_status: 'fallback',
      generation_error: 'OPENAI_API_KEY is not configured for live generation.',
      raw_model_output: null,
    };
  }

  try {
    const generated = await generateWithOpenAI(fallbackInput);
    const normalized = normalizeGeneratedDraft(generated, fallbackInput);
    if (normalized.usedFallback) {
      console.warn('[activityCreator] Falling back after validation failure.');
    }
    return {
      text: normalized.text,
      generation_status: normalized.usedFallback ? 'fallback' : 'generated',
      generation_error: normalized.reason,
      raw_model_output: normalized.usedFallback ? normalized.rawOutput : null,
    };
  } catch (err) {
    console.error('Activity draft generation failed, falling back to template:', err);
    return {
      text: renderFallbackTemplate(fallbackInput),
      generation_status: 'fallback',
      generation_error: err?.message || 'Generation failed.',
      raw_model_output: null,
    };
  }
}

async function reviseActivityDraft(input) {
  const currentText = String(input.currentText || '').trim();
  const revisionRequest = String(input.revisionRequest || '').trim();

  if (!currentText || !revisionRequest) {
    return {
      proposedDocText: currentText,
      summary: [],
      warnings: ['Both currentText and revisionRequest are required.'],
      generation_status: 'fallback',
      generation_error: 'Missing revision input.',
      raw_model_output: null,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'test-key') {
    return {
      proposedDocText: currentText,
      summary: [],
      warnings: ['OPENAI_API_KEY is not configured for live revision. The current draft was returned unchanged.'],
      generation_status: 'fallback',
      generation_error: 'OPENAI_API_KEY is not configured for live revision.',
      raw_model_output: null,
    };
  }

  try {
    const raw = await reviseWithOpenAI({
      currentText,
      revisionRequest,
      selectedModel: input.selectedModel || 'gpt-5-mini',
      title: input.title,
      classLevel: input.classLevel,
      classTopicDomain: input.classTopicDomain,
      classDescription: input.classDescription,
      parseIssues: input.parseIssues,
    });
    const parsed = extractJsonObject(raw);
    const proposed = stripCodeFences(
      parsed.proposedDocText ||
      parsed.proposed_doc_text ||
      parsed.markup ||
      ''
    ).trim();

    if (!proposed.includes('\\title{') || !proposed.includes('\\questiongroup{')) {
      return {
        proposedDocText: currentText,
        summary: [],
        warnings: ['The model response did not contain a complete activity draft, so the current draft was returned unchanged.'],
        generation_status: 'fallback',
        generation_error: 'Model output did not pass activity markup validation.',
        raw_model_output: raw,
      };
    }

    return {
      proposedDocText: proposed,
      summary: normalizeStringList(parsed.summary),
      warnings: normalizeStringList(parsed.warnings),
      generation_status: 'generated',
      generation_error: null,
      raw_model_output: raw,
    };
  } catch (err) {
    console.error('Activity draft revision failed:', err);
    return {
      proposedDocText: currentText,
      summary: [],
      warnings: ['Revision failed; the current draft was returned unchanged.'],
      generation_status: 'fallback',
      generation_error: err?.message || 'Revision failed.',
      raw_model_output: null,
    };
  }
}

async function reviseQuestionDraft(input) {
  const questionMarkup = normalizeQuestionMarkup(input.questionMarkup);
  const revisionRequest = String(input.revisionRequest || '').trim();
  if (!questionMarkup || !revisionRequest) {
    return {
      proposedQuestionMarkup: questionMarkup || String(input.questionMarkup || '').trim(),
      summary: [],
      warnings: ['A complete question block and revision request are required.'],
      generation_status: 'fallback',
      generation_error: 'Missing or invalid question revision input.',
      raw_model_output: null,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'test-key') {
    return {
      proposedQuestionMarkup: questionMarkup,
      summary: [],
      warnings: ['OPENAI_API_KEY is not configured for live revision. The current question was returned unchanged.'],
      generation_status: 'fallback',
      generation_error: 'OPENAI_API_KEY is not configured for live revision.',
      raw_model_output: null,
    };
  }

  try {
    const raw = await reviseQuestionWithOpenAI({
      questionMarkup,
      revisionRequest,
      selectedModel: input.selectedModel || 'gpt-5-mini',
      title: input.title,
      classLevel: input.classLevel,
      classTopicDomain: input.classTopicDomain,
      classDescription: input.classDescription,
      groupTitle: input.groupTitle,
    });
    const parsed = parseQuestionRevisionOutput(raw);
    const proposedQuestionMarkup = parsed.proposedQuestionMarkup;
    if (!proposedQuestionMarkup) {
      return {
        proposedQuestionMarkup: questionMarkup,
        summary: [],
        warnings: ['The model response was not one complete question block, so the current question was returned unchanged.'],
        generation_status: 'fallback',
        generation_error: 'Model output did not pass question markup validation.',
        raw_model_output: raw,
      };
    }
    return {
      proposedQuestionMarkup,
      summary: parsed.summary,
      warnings: parsed.warnings,
      generation_status: 'generated',
      generation_error: null,
      raw_model_output: raw,
    };
  } catch (err) {
    console.error('Question revision failed:', err);
    return {
      proposedQuestionMarkup: questionMarkup,
      summary: [],
      warnings: ['Question revision failed; the current question was returned unchanged.'],
      generation_status: 'fallback',
      generation_error: err?.message || 'Question revision failed.',
      raw_model_output: null,
    };
  }
}

module.exports = {
  generateActivityDraft,
  reviseActivityDraft,
  reviseQuestionDraft,
  buildQuestionRevisionInstructions,
  buildQuestionRevisionResponseFormat,
  isOutputTokenTruncation,
  parseQuestionRevisionOutput,
  normalizeQuestionMarkup,
  renderFallbackTemplate,
  normalizeGeneratedDraft,
  normalizeTimedSections,
  repairGeneratedMarkupClosures,
  renderFallbackTemplate,
};
