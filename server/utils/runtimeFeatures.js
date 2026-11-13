const { configuredDefaultLanguage, FALLBACK_LANGUAGE } = require('../../shared/activityLanguage.cjs');

const DEFAULT_RUNTIME_FEATURES = Object.freeze({
  remoteCpp: false,
  remotePython: false,
});

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function toCamelCase(token) {
  return String(token || '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part, index) => (
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
    ))
    .join('');
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  return TRUE_VALUES.has(String(value).trim().toLowerCase());
}

function getRuntimeFeatures(env = process.env) {
  const features = { ...DEFAULT_RUNTIME_FEATURES };

  for (const [key, value] of Object.entries(env || {})) {
    if (!key.startsWith('RUNTIME_FEATURE_')) continue;
    const featureName = toCamelCase(key.slice('RUNTIME_FEATURE_'.length));
    if (!featureName) continue;
    features[featureName] = parseBoolean(value, false);
  }

  return features;
}

/**
 * Deployment-wide defaults the client needs before it has parsed an activity.
 *
 * Separate from `features` because these are values, not switches: a feature
 * is on or off, a default is what to use when an activity did not say.
 */
function getRuntimeDefaults(env = process.env) {
  return {
    language: configuredDefaultLanguage(env) || FALLBACK_LANGUAGE,
  };
}

// ---- AI models (server/.env; see README, "AI models") ----
// Model names change as providers retire them, so none is fixed in code
// beyond these defaults. Lists are comma-separated; the first is the default.
const DEFAULT_AI_MODELS = Object.freeze({
  feedback: 'gpt-6-luna',
  aiBlock: Object.freeze(['gpt-6-luna', 'gpt-4o-mini']),
  creator: Object.freeze(['gpt-6-luna', 'gpt-6.1-terra']),
});

function envModel(name, fallback, env = process.env) {
  const value = String(env?.[name] ?? '').trim();
  return value || fallback;
}

function envModelList(name, fallback, env = process.env) {
  const list = [...new Set(String(env?.[name] ?? '').split(',').map((m) => m.trim()).filter(Boolean))];
  return list.length ? list : [...fallback];
}

function getAiModels(env = process.env) {
  const feedback = envModel('OPENAI_MODEL', DEFAULT_AI_MODELS.feedback, env);
  return {
    feedback, // group Check feedback (written answers and code)
    grading: envModel('OPENAI_GRADING_MODEL', feedback, env), // tests, assignments, practice, question help, summary
    aiBlock: envModelList('AI_BLOCK_MODELS', DEFAULT_AI_MODELS.aiBlock, env),
    creator: envModelList('CREATOR_MODELS', DEFAULT_AI_MODELS.creator, env),
  };
}

/** The requested model if it is in the list, otherwise the list's default (first). */
function pickModel(requested, allowed) {
  const model = String(requested || '').trim();
  return allowed.includes(model) ? model : allowed[0];
}

// GPT-4 and older take max_tokens and temperature; everything newer (gpt-5,
// gpt-6, o-series) is a reasoning model: max_completion_tokens, no temperature,
// optional reasoning effort.
function isReasoningModel(model) {
  return !/^gpt-(3|4)/i.test(String(model || '').trim());
}

// Reasoning effort per job (*_REASONING_EFFORT). Accepted values differ by
// model (gpt-6 models: none, low, medium, high, xhigh, max; gpt-5: minimal,
// low, medium, high). Blank or unknown = not sent (the model's default).
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
function envReasoningEffort(name, fallback = '', env = process.env) {
  const raw = env?.[name];
  const value = String(raw == null ? fallback : raw).trim().toLowerCase();
  return REASONING_EFFORTS.has(value) ? value : '';
}

function getRuntimeFeatureConfig(env = process.env) {
  const models = getAiModels(env);
  return {
    features: getRuntimeFeatures(env),
    defaults: getRuntimeDefaults(env),
    // Menus in the editor and creator; the first of each is the default.
    models: { aiBlock: models.aiBlock, creator: models.creator },
  };
}

// AI output-token limits are set in server/.env (see README, "AI token limits").
// A missing, non-numeric, or too-small value falls back to the default.
function envTokens(name, fallback, env = process.env) {
  const n = Number.parseInt(env?.[name], 10);
  return Number.isFinite(n) && n >= 100 ? n : fallback;
}

module.exports = {
  envTokens,
  getAiModels,
  pickModel,
  isReasoningModel,
  envReasoningEffort,
  DEFAULT_RUNTIME_FEATURES,
  getRuntimeFeatures,
  getRuntimeDefaults,
  getRuntimeFeatureConfig,
  parseBoolean,
};
