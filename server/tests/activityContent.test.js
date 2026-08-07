const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function createDocBodyLines(lines) {
  return {
    data: {
      body: {
        content: lines.map((line) => ({
          paragraph: {
            elements: [{ textRun: { content: `${line}\n` } }],
          },
        })),
      },
    },
  };
}

function loadActivityContent({ docsById = {} } = {}) {
  const googleAuthPath = require.resolve('../utils/googleAuth');
  const activityContentPath = require.resolve('../utils/activityContent');

  const fakeGoogleApis = {
    google: {
      docs: () => ({
        documents: {
          get: async ({ documentId }) => {
            const lines = docsById[documentId];
            if (!lines) throw new Error(`No stubbed doc for ${documentId}`);
            return createDocBodyLines(lines);
          },
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
  delete require.cache[activityContentPath];

  const googleAuth = require(googleAuthPath);
  const originalAuthorize = googleAuth.authorize;
  googleAuth.authorize = () => ({ fake: true });

  const activityContent = require(activityContentPath);

  return {
    activityContent,
    restore() {
      Module._load = originalLoad;
      googleAuth.authorize = originalAuthorize;
      delete require.cache[googleAuthPath];
      delete require.cache[activityContentPath];
    },
  };
}

test('loadActivitySourceLines uses stored local text when present', async () => {
  const { activityContent, restore } = loadActivityContent();

  try {
    const lines = await activityContent.loadActivitySourceLines({
      source_type: 'local',
      content_text: '\\title{Local}\n\\mode{group}',
      sheet_url: 'https://docs.google.com/document/d/unusedDocId123456789012345/edit',
    });

    assert.deepEqual(lines, ['\\title{Local}', '\\mode{group}']);
  } finally {
    restore();
  }
});

test('loadActivitySourceLines falls back to remote doc when local content is empty', async () => {
  const docId = 'fallbackDoc1234567890123456789';
  const { activityContent, restore } = loadActivityContent({
    docsById: {
      [docId]: ['\\title{Remote Fallback}', '\\mode{demo}'],
    },
  });

  try {
    const lines = await activityContent.loadActivitySourceLines({
      source_type: 'local',
      content_text: null,
      sheet_url: `https://docs.google.com/document/d/${docId}/edit`,
    });

    assert.deepEqual(lines, ['\\title{Remote Fallback}', '\\mode{demo}']);
  } finally {
    restore();
  }
});

test('sourceSyncStatus prefers matching markup over timestamps and otherwise identifies the newer copy', () => {
  const { activityContent, restore } = loadActivityContent();

  try {
    assert.equal(activityContent.sourceSyncStatus({
      localText: 'same\nmarkup',
      remoteText: 'same\nmarkup',
      localUpdatedAt: '2026-08-07T12:00:00.000Z',
      remoteUpdatedAt: '2026-08-07T13:00:00.000Z',
    }).state, 'in_sync');

    assert.equal(activityContent.sourceSyncStatus({
      localText: 'local copy',
      remoteText: 'remote copy',
      localUpdatedAt: '2026-08-07T14:00:00.000Z',
      remoteUpdatedAt: '2026-08-07T13:00:00.000Z',
    }).state, 'local_newer');

    assert.equal(activityContent.sourceSyncStatus({
      localText: 'local copy',
      remoteText: 'remote copy',
      localUpdatedAt: '2026-08-07T12:00:00.000Z',
      remoteUpdatedAt: '2026-08-07T13:00:00.000Z',
    }).state, 'remote_newer');
  } finally {
    restore();
  }
});
