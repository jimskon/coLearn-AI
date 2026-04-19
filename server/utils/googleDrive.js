const { google } = require('googleapis');
const { authorize } = require('./googleAuth');

const drive = google.drive({ version: 'v3', auth: authorize() });

exports.getFilesInFolder = async function getFilesInFolder(folderId) {
  const auth = await authorize();
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
    fields: 'files(id, name, mimeType)',
  });

  console.log(`✅ Found ${res.data.files.length} Google Docs in folder ${folderId}`);
  return res.data.files;
};


exports.getFileMetadata = async (fileId) => {
  const res = await drive.files.get({
    fileId,
    fields: 'id, name',
  });
  return res.data;
};
