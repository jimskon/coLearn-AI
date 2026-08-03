const { fetchGoogleDocLinesByUrl, loadActivitySourceLines } = require('./activityContent');

function normalizeActivityType(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();

  if (mode === 'test') return 'test';
  if (mode === 'demo' || mode === 'playground') return 'demo';
  if (mode === 'assignment') return 'assignment';
  if (mode === 'group' || mode === 'normal') return 'group';

  return null;
}

function normalizeAuthoredMode(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();

  if (mode === 'test') return 'test';
  if (mode === 'demo' || mode === 'playground') return mode;
  if (mode === 'assignment') return 'assignment';
  if (mode === 'group' || mode === 'normal') return 'group';

  return null;
}

function inferActivityTypeFromLines(lines, { fallbackIsTest = false } = {}) {
  let sawLegacyTest = false;

  for (const line of Array.isArray(lines) ? lines : []) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;

    if (trimmed === '\\test') {
      sawLegacyTest = true;
      continue;
    }

    const modeMatch = trimmed.match(/^\\mode\{([\s\S]*?)\}$/i);
    if (modeMatch) {
      const normalized = normalizeActivityType(modeMatch[1]);
      if (normalized) return normalized;
    }
  }

  if (sawLegacyTest) return 'test';
  return fallbackIsTest ? 'test' : 'group';
}

function inferAuthoredModeFromLines(lines, { fallbackIsTest = false } = {}) {
  let sawLegacyTest = false;

  for (const line of Array.isArray(lines) ? lines : []) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;

    if (trimmed === '\\test') {
      sawLegacyTest = true;
      continue;
    }

    const modeMatch = trimmed.match(/^\\mode\{([\s\S]*?)\}$/i);
    if (modeMatch) {
      const normalized = normalizeAuthoredMode(modeMatch[1]);
      if (normalized) return normalized;
    }
  }

  if (sawLegacyTest) return 'test';
  return fallbackIsTest ? 'test' : 'group';
}

const fetchActivityLinesFromDocUrl = fetchGoogleDocLinesByUrl;

async function inferActivityTypeFromActivity(activity) {
  const fallbackIsTest = Number(activity?.is_test) === 1;

  try {
    const lines = await loadActivitySourceLines(activity);
    return inferActivityTypeFromLines(lines, { fallbackIsTest });
  } catch (err) {
    console.warn('[activityType] Falling back to DB flag:', err.message);
    return fallbackIsTest ? 'test' : 'group';
  }
}

async function inferAuthoredModeFromActivity(activity) {
  const fallbackIsTest = Number(activity?.is_test) === 1;

  try {
    const lines = await loadActivitySourceLines(activity);
    return inferAuthoredModeFromLines(lines, { fallbackIsTest });
  } catch (err) {
    console.warn('[activityType] Falling back to DB flag:', err.message);
    return fallbackIsTest ? 'test' : 'group';
  }
}

module.exports = {
  normalizeActivityType,
  inferActivityTypeFromLines,
  inferAuthoredModeFromLines,
  fetchActivityLinesFromDocUrl,
  inferActivityTypeFromActivity,
  inferAuthoredModeFromActivity,
};
