const { google } = require('googleapis');
const { authorize } = require('./googleAuth');
const { extractGoogleFileId } = require('./googleIds');

const DRIVE_WRITE_SCOPE = 'https://www.googleapis.com/auth/drive';

async function verifyCourseFolderAccess(folderUrl) {
  const folderId = extractGoogleFileId(folderUrl);
  if (!folderId) {
    return {
      ok: false,
      folderId: null,
      folderName: null,
      writable: false,
      error: 'Invalid Google Drive folder URL.',
    };
  }

  try {
    const auth = await authorize([DRIVE_WRITE_SCOPE]);
    const drive = google.drive({ version: 'v3', auth });

    const res = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType, trashed, capabilities(canAddChildren,canEdit)',
      supportsAllDrives: true,
    });

    const folder = res.data || {};
    if (folder.mimeType !== 'application/vnd.google-apps.folder') {
      return {
        ok: false,
        folderId,
        folderName: folder.name || null,
        writable: false,
        error: 'URL does not point to a Google Drive folder.',
      };
    }

    if (folder.trashed) {
      return {
        ok: false,
        folderId,
        folderName: folder.name || null,
        writable: false,
        error: 'Google Drive folder is in the trash.',
      };
    }

    const writable = Boolean(folder.capabilities?.canAddChildren || folder.capabilities?.canEdit);
    if (!writable) {
      return {
        ok: false,
        folderId,
        folderName: folder.name || null,
        writable: false,
        error: 'Service account cannot write to this folder.',
      };
    }

    return {
      ok: true,
      folderId,
      folderName: folder.name || null,
      writable: true,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      folderId,
      folderName: null,
      writable: false,
      error: error?.message || 'Failed to verify Google Drive folder access.',
    };
  }
}

module.exports = {
  DRIVE_WRITE_SCOPE,
  verifyCourseFolderAccess,
};
