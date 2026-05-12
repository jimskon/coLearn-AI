const { google } = require('googleapis');
const { authorize } = require('./googleAuth');

const DOCS_WRITE_SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
];

function buildStarterTemplate(title, mode = 'group') {
  const safeTitle = String(title || 'New Activity').trim() || 'New Activity';
  const safeMode = ['group', 'test', 'demo'].includes(mode) ? mode : 'group';

  return [
    `\\title{${safeTitle}}`,
    `\\mode{${safeMode}}`,
    '',
    '\\section{Introduction}',
    '',
    '\\questiongroup{Question Group 1}',
    '',
    '\\question{Replace this question with your own prompt.}',
    '\\textresponse{3}',
    '\\sampleresponses{',
    'Sample answer',
    '}',
    '\\feedbackprompt{',
    'Accept any reasonable response.',
    '}',
    '\\endquestion',
    '',
  ].join('\n');
}

async function createLocalActivityDoc({ title, folderId, mode = 'group' }) {
  const auth = await authorize(DOCS_WRITE_SCOPES);
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  const created = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
      parents: [folderId],
    },
    fields: 'id,name',
  });

  const documentId = created.data.id;
  const content = buildStarterTemplate(title, mode);

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: content,
          },
        },
      ],
    },
  });

  return {
    documentId,
    title: created.data.name || title,
    url: `https://docs.google.com/document/d/${documentId}/edit`,
  };
}

module.exports = {
  buildStarterTemplate,
  createLocalActivityDoc,
};
