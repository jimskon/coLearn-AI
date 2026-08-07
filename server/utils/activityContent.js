const { google } = require('googleapis');
const crypto = require('crypto');
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

async function fetchGoogleDocMetadataByUrl(sheetUrl) {
  const docId = extractGoogleFileId(sheetUrl);
  if (!docId) {
    throw new Error('Invalid Google Doc URL');
  }

  const auth = await authorize();
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.get({
    fileId: docId,
    fields: 'id,name,modifiedTime,webViewLink,mimeType',
  });

  return {
    id: response.data.id || docId,
    title: response.data.name || null,
    updated_at: response.data.modifiedTime || null,
    url: response.data.webViewLink || sheetUrl,
    mime_type: response.data.mimeType || null,
  };
}

function sourceSyncStatus({ localText, localUpdatedAt, remoteText, remoteUpdatedAt }) {
  const local = String(localText ?? '').replace(/\r\n/g, '\n');
  const remote = String(remoteText ?? '').replace(/\r\n/g, '\n');
  const localHash = crypto.createHash('sha256').update(local).digest('hex');
  const remoteHash = crypto.createHash('sha256').update(remote).digest('hex');

  if (localHash === remoteHash) {
    return { state: 'in_sync', local_hash: localHash, remote_hash: remoteHash };
  }

  const localTime = localUpdatedAt ? new Date(localUpdatedAt).getTime() : NaN;
  const remoteTime = remoteUpdatedAt ? new Date(remoteUpdatedAt).getTime() : NaN;
  const state = !local.trim()
    ? 'remote_only'
    : Number.isFinite(localTime) && Number.isFinite(remoteTime)
      ? (remoteTime > localTime ? 'remote_newer' : 'local_newer')
      : 'different_unknown';

  return { state, local_hash: localHash, remote_hash: remoteHash };
}

async function loadActivitySourceLines(activity) {
  const sourceType = String(activity?.source_type || 'remote').toLowerCase();
  const hasStoredText = activity?.content_text != null && String(activity.content_text).length > 0;

  if (sourceType === 'local' && hasStoredText) {
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
    `SELECT id, sheet_url, source_type, content_text, source_updated_at, is_test
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
  fetchGoogleDocMetadataByUrl,
  sourceSyncStatus,
  loadActivitySourceLines,
  loadActivitySourceText,
  loadActivitySourceById,
};
