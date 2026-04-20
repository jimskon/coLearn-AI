const assert = require('node:assert/strict');
const test = require('node:test');

const { extractGoogleFileId } = require('../utils/googleIds');

test('extracts a Google Docs document id from an edit URL', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890';
  const url = `https://docs.google.com/document/d/${id}/edit?tab=t.0`;

  assert.equal(extractGoogleFileId(url), id);
});

test('extracts a Google Sheets document id from a sheet URL', () => {
  const id = '1BcdEfGhIjKlMnOpQrStUvWxYz1234567890A';
  const url = `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`;

  assert.equal(extractGoogleFileId(url), id);
});

test('extracts a Google Drive folder id from a folder URL', () => {
  const id = '1FolderGhIjKlMnOpQrStUvWxYz1234567890';
  const url = `https://drive.google.com/drive/folders/${id}?usp=sharing`;

  assert.equal(extractGoogleFileId(url), id);
});

test('rejects missing and invalid URLs', () => {
  assert.equal(extractGoogleFileId(), null);
  assert.equal(extractGoogleFileId('undefined'), null);
  assert.equal(extractGoogleFileId('not a url'), null);
});

test('rejects non-Google URLs', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890';

  assert.equal(extractGoogleFileId(`https://example.com/document/d/${id}/edit`), null);
});

test('rejects malformed Google URLs without a valid id', () => {
  assert.equal(extractGoogleFileId('https://docs.google.com/document/d/short/edit'), null);
  assert.equal(extractGoogleFileId('https://docs.google.com/document/u/0/'), null);
});
