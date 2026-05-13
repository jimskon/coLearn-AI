const { google } = require('googleapis');
const { authorize } = require('./googleAuth');
const { extractGoogleFileId } = require('./googleIds');

function linesFromStoredText(contentText) {
  if (contentText == null) return [];
  return String(contentText).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function linesFromGoogleDoc(doc) {
  return (doc?.data?.body?.content || [])
    .map((item) => {
      if (!item.paragraph?.elements) return null;
      return item.paragraph.elements
        .map((element) => element.textRun?.content || '')
        .join('')
        .replace(/\r?\n$/, '');
    })
    .filter((line) => line !== null);
}

async function fetchGoogleDocLinesByUrl(sheetUrl) {
  const docId = extractGoogleFileId(sheetUrl);
  if (!docId) {
    throw new Error('Invalid Google Doc URL');
  }

  const auth = await authorize();
  const docs = google.docs({ version: 'v1', auth });
  const doc = await docs.documents.get({ documentId: docId });
  return linesFromGoogleDoc(doc);
}

async function loadActivitySourceLines(activity) {
  const sourceType = String(activity?.source_type || 'remote').toLowerCase();

  if (sourceType === 'local') {
    return linesFromStoredText(activity?.content_text);
  }

  const sheetUrl = activity?.sheet_url || '';
  if (!sheetUrl) {
    return [];
  }

  return fetchGoogleDocLinesByUrl(sheetUrl);
}

async function loadActivitySourceText(activity) {
  const lines = await loadActivitySourceLines(activity);
  return {
    lines,
    text: lines.join('\n'),
  };
}

async function loadActivitySourceById(db, activityId) {
  const [rows] = await db.query(
    `SELECT id, sheet_url, source_type, content_text, is_test
       FROM pogil_activities
      WHERE id = ?`,
    [activityId]
  );

  if (!rows.length) {
    return null;
  }

  const activity = rows[0];
  const source = await loadActivitySourceText(activity);
  return {
    activity,
    ...source,
  };
}

module.exports = {
  linesFromStoredText,
  linesFromGoogleDoc,
  fetchGoogleDocLinesByUrl,
  loadActivitySourceLines,
  loadActivitySourceText,
  loadActivitySourceById,
};
