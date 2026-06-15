const fs = require('node:fs');
const path = require('node:path');
const OpenAI = require('openai');
require('dotenv').config();

const CREATOR_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'activity_creator_template.txt');
const MARKUP_HOUSE_STYLE_PATH = path.join(__dirname, '..', 'templates', 'activity_markup_house_style.txt');

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

  const replacement = [
    '\\text{Students will be able to:}',
    '\\begin{itemize}',
    ...objectiveLines.map((line) => `\\item ${line.replace(/^[-*]\s*/, '')}`),
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
    const pattern = new RegExp(`^\\section\{${escapeRegExp(section.title)}\}(?:\{\d+\})?$`, 'm');
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

function normalizeGeneratedDraft(text, fallbackInput) {
  const cleaned = normalizePythonTurtleDirectives(
    applyTimedSectionDirectives(
      applyRetriesDirective(
        normalizeLearningObjectivesSection(stripCodeFences(text)),
        fallbackInput.retriesRequired
      ),
      fallbackInput.timedSections
    )
  );

  if (!cleaned.includes('\\title{') || !cleaned.includes('\\questiongroup{')) {
    return {
      text: renderFallbackTemplate(fallbackInput),
      usedFallback: true,
      reason: 'Model output did not pass activity markup validation.',
      rawOutput: cleaned,
    };
  }
  return {
    text: cleaned,
    usedFallback: false,
    reason: null,
    rawOutput: cleaned,
  };
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
  const houseStyle = fs.readFileSync(MARKUP_HOUSE_STYLE_PATH, 'utf8').trim();
  const normalizedTimedSections = normalizeTimedSections(timedSections);

  const system = [
    'You are an expert instructional designer creating editable activity markup for coLearn-AI.',
    'Return only valid activity markup. Do not use Markdown code fences. Do not add commentary before or after the markup.',
    'Use these commands when appropriate: \\title{...}, \\mode{...}, \\studentlevel{...}, \\activitycontext{...}, \\retries{n}, \\section{...}, \\section{...}{minutes}, \\questiongroup{...}, \\question{...}, \\textresponse{n}, \\sampleresponses{...}, \\feedbackprompt{...}, \\endquestion, \\endquestiongroup.',
    'Always produce a complete first-pass activity draft with at least one \\section and at least one \\questiongroup.',
    'Prefer 2-3 question groups for a first-pass draft. Keep the scope realistic for the requested duration.',
    'Keep each question concise. Keep sample responses and feedback prompts short.',
    'It is better to finish a complete compact activity than to begin a longer activity and stop halfway through.',
    'Treat Learning Objectives as a structural section, not as an interactive activity, unless the creator explicitly asks otherwise.',
    'If a timed section plan is provided, use the exact section titles and emit them as \\section{Title}{minutes}.',
    'For \\pythonturtle blocks, do not invent tiny explicit timeouts. Omit the timeout unless a specific non-default runtime limit is truly needed. Prefer \\pythonturtle{WxH} over \\pythonturtle{WxH,timeout}.',
    'Emit one global \\retries{n} directive near the top of the activity using the requested retry count.',
    'If you include code examples, wrap them in explicit code blocks such as \\cpp ... \\endcpp or \\python ... \\endpython. Never paste raw code directly into question text.',
    'Use the house-style example below as syntax guidance and imitate its structure when relevant.',
    'For mode=group, use collaborative prompts and progression.',
    'For mode=demo, use guided observation, prediction, and explanation prompts suitable for individual experimentation.',
    'For mode=test, use concise, direct prompts suitable for individual completion and avoid collaborative wording.',
    'Make the activity reflect the creator brief, not generic filler.',
    '',
    'House-style example:',
    houseStyle,
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
    max_output_tokens: 5000,
  };

  if (!String(selectedModel || '').startsWith('gpt-5')) {
    request.temperature = 0.7;
  }

  const response = await openai.responses.create(request);
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

  const system = [
    'You are an expert instructional designer revising coLearn-AI activity markup.',
    'Return only strict JSON with keys: proposedDocText, summary, warnings.',
    'proposedDocText must be the complete revised activity markup, not a patch and not commentary.',
    'summary and warnings must be arrays of short strings.',
    'Preserve valid activity syntax and existing structure unless the creator request requires a change.',
    'For targeted requests such as "change 3a" or "add after 4b", make the smallest coherent edit that satisfies the request.',
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
    max_output_tokens: 9000,
  };

  if (!String(selectedModel || '').startsWith('gpt-5')) {
    request.temperature = 0.45;
  }

  const response = await openai.responses.create(request);
  return response.output_text || '';
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

module.exports = {
  generateActivityDraft,
  reviseActivityDraft,
  renderFallbackTemplate,
  normalizeGeneratedDraft,
  normalizeTimedSections,
  renderFallbackTemplate,
};
