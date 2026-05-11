// server/utils/googleAuth.js
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'service-account.json');
const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
];

function authorize(scopes = DEFAULT_SCOPES) {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes
  });

  return auth;
}

module.exports = { authorize, DEFAULT_SCOPES };
