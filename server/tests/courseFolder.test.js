const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function loadCourseFolderUtil({ getImpl, authorizeImpl } = {}) {
  const googleAuthPath = require.resolve('../utils/googleAuth');
  const courseFolderPath = require.resolve('../utils/courseFolder');

  const fakeGoogleApis = {
    google: {
      drive: () => ({
        files: {
          get: getImpl || (async () => ({ data: {} })),
        },
      }),
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'googleapis') {
      return fakeGoogleApis;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[googleAuthPath];
  delete require.cache[courseFolderPath];

  const googleAuth = require(googleAuthPath);
  const originalAuthorize = googleAuth.authorize;
  googleAuth.authorize = authorizeImpl || (() => ({ fake: true }));

  const courseFolder = require(courseFolderPath);

  return {
    courseFolder,
    restore() {
      Module._load = originalLoad;
      googleAuth.authorize = originalAuthorize;
      delete require.cache[googleAuthPath];
      delete require.cache[courseFolderPath];
    },
  };
}

test('verifyCourseFolderAccess rejects invalid folder URLs', async () => {
  const { courseFolder, restore } = loadCourseFolderUtil();

  try {
    const result = await courseFolder.verifyCourseFolderAccess('not a google folder');

    assert.deepEqual(result, {
      ok: false,
      folderId: null,
      folderName: null,
      writable: false,
      error: 'Invalid Google Drive folder URL.',
    });
  } finally {
    restore();
  }
});

test('verifyCourseFolderAccess returns folder metadata when writable', async () => {
  let requestedFileId = null;
  let requestedFields = null;
  let authorizeScopes = null;

  const { courseFolder, restore } = loadCourseFolderUtil({
    authorizeImpl: async (scopes) => {
      authorizeScopes = scopes;
      return { fake: true };
    },
    getImpl: async ({ fileId, fields }) => {
      requestedFileId = fileId;
      requestedFields = fields;
      return {
        data: {
          id: fileId,
          name: 'Instance Activities',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
          capabilities: {
            canAddChildren: true,
            canEdit: true,
          },
        },
      };
    },
  });

  try {
    const folderId = '1FolderGhIjKlMnOpQrStUvWxYz1234567890';
    const result = await courseFolder.verifyCourseFolderAccess(
      `https://drive.google.com/drive/folders/${folderId}?usp=sharing`
    );

    assert.equal(requestedFileId, folderId);
    assert.match(requestedFields, /capabilities/);
    assert.deepEqual(authorizeScopes, [courseFolder.DRIVE_WRITE_SCOPE]);
    assert.deepEqual(result, {
      ok: true,
      folderId,
      folderName: 'Instance Activities',
      writable: true,
      error: null,
    });
  } finally {
    restore();
  }
});

test('verifyCourseFolderAccess rejects non-folder Google Drive targets', async () => {
  const { courseFolder, restore } = loadCourseFolderUtil({
    getImpl: async ({ fileId }) => ({
      data: {
        id: fileId,
        name: 'Not A Folder',
        mimeType: 'application/vnd.google-apps.document',
        trashed: false,
        capabilities: {
          canAddChildren: false,
          canEdit: true,
        },
      },
    }),
  });

  try {
    const folderId = '1FolderGhIjKlMnOpQrStUvWxYz1234567890';
    const result = await courseFolder.verifyCourseFolderAccess(
      `https://drive.google.com/drive/folders/${folderId}?usp=sharing`
    );

    assert.deepEqual(result, {
      ok: false,
      folderId,
      folderName: 'Not A Folder',
      writable: false,
      error: 'URL does not point to a Google Drive folder.',
    });
  } finally {
    restore();
  }
});

test('verifyCourseFolderAccess rejects folders the service account cannot write to', async () => {
  const { courseFolder, restore } = loadCourseFolderUtil({
    getImpl: async ({ fileId }) => ({
      data: {
        id: fileId,
        name: 'Read Only Folder',
        mimeType: 'application/vnd.google-apps.folder',
        trashed: false,
        capabilities: {
          canAddChildren: false,
          canEdit: false,
        },
      },
    }),
  });

  try {
    const folderId = '1FolderGhIjKlMnOpQrStUvWxYz1234567890';
    const result = await courseFolder.verifyCourseFolderAccess(
      `https://drive.google.com/drive/folders/${folderId}?usp=sharing`
    );

    assert.deepEqual(result, {
      ok: false,
      folderId,
      folderName: 'Read Only Folder',
      writable: false,
      error: 'Service account cannot write to this folder.',
    });
  } finally {
    restore();
  }
});

test('verifyCourseFolderAccess surfaces Drive API errors cleanly', async () => {
  const { courseFolder, restore } = loadCourseFolderUtil({
    getImpl: async () => {
      throw new Error('Drive lookup failed');
    },
  });

  try {
    const folderId = '1FolderGhIjKlMnOpQrStUvWxYz1234567890';
    const result = await courseFolder.verifyCourseFolderAccess(
      `https://drive.google.com/drive/folders/${folderId}?usp=sharing`
    );

    assert.deepEqual(result, {
      ok: false,
      folderId,
      folderName: null,
      writable: false,
      error: 'Drive lookup failed',
    });
  } finally {
    restore();
  }
});
