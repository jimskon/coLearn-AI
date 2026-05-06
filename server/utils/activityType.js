const { extractGoogleFileId } = require('./googleIds');

function normalizeActivityType(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();

  if (mode === 'test') return 'test';
  if (mode === 'demo' || mode === 'playground') return 'demo';
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

async function fetchActivityLinesFromDocUrl(sheetUrl) {
  const { google } = require('googleapis');
  const { authorize } = require('./googleAuth');
  const docId = extractGoogleFileId(sheetUrl);
  if (!docId) {
    throw new Error('Invalid Google Doc URL');
  }

  const auth = await authorize();
  const docs = google.docs({ version: 'v1', auth });
  const doc = await docs.documents.get({ documentId: docId });

  return (doc.data.body?.content || [])
    .flatMap((item) => item.paragraph?.elements || [])
    .map((element) => element.textRun?.content?.replace(/\r?\n$/, ''))
    .filter(Boolean);
}

async function inferActivityTypeFromActivity(activity) {
  const fallbackIsTest = Number(activity?.is_test) === 1;
  const sheetUrl = activity?.sheet_url || '';

  if (!sheetUrl) {
    return fallbackIsTest ? 'test' : 'group';
  }

  try {
    const lines = await fetchActivityLinesFromDocUrl(sheetUrl);
    return inferActivityTypeFromLines(lines, { fallbackIsTest });
  } catch (err) {
    console.warn('[activityType] Falling back to DB flag:', err.message);
    return fallbackIsTest ? 'test' : 'group';
  }
}

module.exports = {
  normalizeActivityType,
  inferActivityTypeFromLines,
  fetchActivityLinesFromDocUrl,
  inferActivityTypeFromActivity,
};
