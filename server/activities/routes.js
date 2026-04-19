const express = require('express');
const router = express.Router();
const controller = require('./controller');
const { google } = require('googleapis');
const { authorize } = require('../utils/googleAuth');

// ==========================
// Activity CRUD Endpoints
// ==========================

// GET /activities
router.get('/', controller.getAllActivities);

// POST /activities
router.post('/', controller.createActivity);


// ==========================
// Google Sheets Preview
// ==========================

// GET /activities/preview?sheetUrl=...
router.get('/preview', async (req, res) => {
  const { sheetUrl } = req.query;
  try {
    const auth = await authorize();
    const sheets = google.sheets({ version: 'v4', auth });

    const sheetId = new URL(sheetUrl).pathname.split('/')[3];
    const range = 'Sheet1'; // or auto-detect

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    res.json({ data: result.data.values });
  } catch (err) {
    console.error("Error fetching sheet data:", err);
    res.status(500).send('Error fetching sheet data');
  }
});

// ==========================
// Google Docs Preview
// ==========================

// ==========================
// Google Docs Preview
// ==========================

// GET /activities/preview-doc?docUrl=...
router.get('/preview-doc', async (req, res) => {
  const rawUrl = req.query.docUrl;
  //console.log("Previewing doc:", rawUrl);

  if (!rawUrl || rawUrl === 'undefined') {
    console.warn("📛 Missing or invalid docUrl:", rawUrl);
    return res.status(400).json({ error: 'Missing or invalid docUrl' });
  }

  let docId;
  try {
    const url = new URL(rawUrl);
    docId = url.pathname.split('/')[3];   // ✅ extract docId correctly
    if (!docId) {
      throw new Error("Could not extract documentId from URL");
    }
    //console.log("✅ Extracted docId:", docId);
  } catch (err) {
    console.error("📛 Invalid docUrl format:", rawUrl, err.message);
    return res.status(400).json({ error: 'Invalid docUrl format' });
  }

  try {
    const auth = await authorize();
    const docs = google.docs({ version: 'v1', auth });

    const doc = await docs.documents.get({ documentId: docId });

    const lines = doc.data.body.content
      .flatMap(item => item.paragraph?.elements || [])
      .map(e => e.textRun?.content?.replace(/\r?\n$/, ''))  // strip trailing newlines
      .filter(Boolean); // remove undefined

    res.json({ lines });
  } catch (err) {
    console.error("Google Doc read error:", err.message);
    res.status(500).json({ error: 'Failed to read Google Doc', details: err.message });
  }
});

// DELETE /activities/:name
router.delete('/:name', controller.deleteActivity);

router.get('/check-access', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({ access: true });

  try {
    const auth = await authorize();
    const docId = new URL(url).pathname.split('/')[3];
    const docs = google.docs({ version: 'v1', auth });
    await docs.documents.get({ documentId: docId });
    res.json({ access: true });
  } catch (err) {
    console.error("Access check failed:", err.message);
    res.json({ access: false });
  }
});

// GET /activities/:name
router.get('/:id', controller.getActivity);

// POST /activities/:name/launch
router.post('/:name/launch', controller.launchActivityInstance);

router.patch('/:id/is-test', controller.setIsTest);



module.exports = router;
