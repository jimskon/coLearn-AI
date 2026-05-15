const fs = require('node:fs');
const path = require('node:path');
const OpenAI = require('openai');
require('dotenv').config();

const CREATOR_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'activity_creator_template.txt');

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
  classLevel,
  classTopicDomain,
  classDescription,
  activityDescription,
}) {
  const template = fs.readFileSync(CREATOR_TEMPLATE_PATH, 'utf8');

  return template
    .replace('{{TITLE}}', sanitizeHeaderValue(title, 'New Activity'))
    .replace('{{MODE}}', sanitizeHeaderValue(mode, 'group'))
    .replace('{{CLASS_LEVEL}}', sanitizeHeaderValue(classLevel, 'Not specified'))
    .replace('{{CLASS_TOPIC_DOMAIN}}', sanitizeHeaderValue(classTopicDomain, 'Not specified'))
    .replace('{{DURATION_MINUTES}}', String(durationMinutes))
    .replace('{{SELECTED_MODEL}}', sanitizeHeaderValue(selectedModel, 'gpt-5-mini'))
    .replace('{{CLASS_DESCRIPTION_BLOCK}}', normalizeTextBlock(classDescription))
    .replace('{{ACTIVITY_DESCRIPTION_BLOCK}}', normalizeTextBlock(activityDescription));
}

function stripCodeFences(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1].trim() : raw;
}

function normalizeGeneratedDraft(text, fallbackInput) {
  const cleaned = stripCodeFences(text);
  if (!cleaned.includes('\\title{') || !cleaned.includes('\\questiongroup{')) {
    return renderFallbackTemplate(fallbackInput);
  }
  return cleaned;
}

async function generateWithOpenAI({
  title,
  mode,
  durationMinutes,
  selectedModel,
  classLevel,
  classTopicDomain,
  classDescription,
  activityDescription,
}) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const system = [
    'You are an expert instructional designer creating editable activity markup for coLearn-AI.',
    'Return only valid activity markup. Do not use Markdown code fences. Do not add commentary before or after the markup.',
    'Use these commands when appropriate: \\title{...}, \\mode{...}, \\studentlevel{...}, \\activitycontext{...}, \\section{...}, \\questiongroup{...}, \\question{...}, \\textresponse{n}, \\sampleresponses{...}, \\feedbackprompt{...}, \\endquestion, \\endquestiongroup.',
    'Always produce a complete first-pass activity draft with at least one \\section and at least one \\questiongroup.',
    'Prefer 2-4 question groups for medium-length activities. Keep the scope realistic for the requested duration.',
    'For mode=group, use collaborative prompts and progression.',
    'For mode=demo, use guided observation, prediction, and explanation prompts suitable for individual experimentation.',
    'For mode=test, use concise, direct prompts suitable for individual completion and avoid collaborative wording.',
    'Make the activity reflect the creator brief, not generic filler.',
  ].join('\n');

  const user = [
    `Activity title: ${title}`,
    `Mode: ${mode}`,
    `Target duration (minutes): ${durationMinutes}`,
    `Class level: ${classLevel || 'Not specified'}`,
    `Topic/domain: ${classTopicDomain || 'Not specified'}`,
    `Class description:\n${classDescription || 'Not specified.'}`,
    `Creator brief:\n${activityDescription}`,
    '',
    'Write a useful first-pass activity draft now.',
  ].join('\n\n');

  const chat = await openai.chat.completions.create({
    model: selectedModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
    max_tokens: 2200,
  });

  return chat.choices?.[0]?.message?.content || '';
}

async function generateActivityDraft(input) {
  const fallbackInput = {
    title: input.title,
    mode: input.mode,
    durationMinutes: input.durationMinutes,
    selectedModel: input.selectedModel,
    classLevel: input.classLevel,
    classTopicDomain: input.classTopicDomain,
    classDescription: input.classDescription,
    activityDescription: input.activityDescription,
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'test-key') {
    return renderFallbackTemplate(fallbackInput);
  }

  try {
    const generated = await generateWithOpenAI(fallbackInput);
    return normalizeGeneratedDraft(generated, fallbackInput);
  } catch (err) {
    console.error('Activity draft generation failed, falling back to template:', err);
    return renderFallbackTemplate(fallbackInput);
  }
}

module.exports = {
  generateActivityDraft,
  renderFallbackTemplate,
  normalizeGeneratedDraft,
};
