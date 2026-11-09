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

function getRuntimeFeatureConfig(env = process.env) {
  return {
    features: getRuntimeFeatures(env),
    defaults: getRuntimeDefaults(env),
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
  DEFAULT_RUNTIME_FEATURES,
  getRuntimeFeatures,
  getRuntimeDefaults,
  getRuntimeFeatureConfig,
  parseBoolean,
};
