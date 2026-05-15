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

function renderFallbackTemplate({
  title,
  mode,
  durationMinutes,
  selectedModel,
  majorSections,
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
    .replace('__MAJOR_SECTIONS_BLOCK__', normalizeTextBlock((majorSections || []).join(', '), 'Not specified.'))
    .replace('__CLASS_DESCRIPTION_BLOCK__', normalizeTextBlock(classDescription))
    .replace('__ACTIVITY_DESCRIPTION_BLOCK__', normalizeTextBlock(activityDescription));
}

function stripCodeFences(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1].trim() : raw;
}

function normalizeGeneratedDraft(text, fallbackInput) {
  const cleaned = stripCodeFences(text);
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
  classLevel,
  classTopicDomain,
  classDescription,
  activityDescription,
}) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const houseStyle = fs.readFileSync(MARKUP_HOUSE_STYLE_PATH, 'utf8').trim();

  const system = [
    'You are an expert instructional designer creating editable activity markup for coLearn-AI.',
    'Return only valid activity markup. Do not use Markdown code fences. Do not add commentary before or after the markup.',
    'Use these commands when appropriate: \\title{...}, \\mode{...}, \\studentlevel{...}, \\activitycontext{...}, \\section{...}, \\questiongroup{...}, \\question{...}, \\textresponse{n}, \\sampleresponses{...}, \\feedbackprompt{...}, \\endquestion, \\endquestiongroup.',
    'Always produce a complete first-pass activity draft with at least one \\section and at least one \\questiongroup.',
    'Prefer 2-3 question groups for a first-pass draft. Keep the scope realistic for the requested duration.',
    'Keep each question concise. Keep sample responses and feedback prompts short.',
    'It is better to finish a complete compact activity than to begin a longer activity and stop halfway through.',
    'Treat Learning Objectives as a structural section, not as an interactive activity, unless the creator explicitly asks otherwise.',
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
    `Use these major sections in this order: ${(majorSections || []).join(' | ') || 'Learning Objectives | Exploration | Concept Invention | Application | Reflection'}`,
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

async function generateActivityDraft(input) {
  const fallbackInput = {
    title: input.title,
    mode: input.mode,
    durationMinutes: input.durationMinutes,
    selectedModel: input.selectedModel,
    majorSections: input.majorSections,
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

module.exports = {
  generateActivityDraft,
  renderFallbackTemplate,
  normalizeGeneratedDraft,
};
