/*
 * coLearn: create a new Google Doc for every locally stored activity
 *
 * This script runs in the instructor's own Google account. It never gives
 * coLearn permission to write to Google Drive.
 *
 * HOW TO USE
 * 1. In coLearn: Manage Activities -> Download. Select two or more activities
 *    (normally all activities in the course) so the browser downloads
 *    class_<id>_activities.json.
 * 2. Upload that JSON file to your Google Drive.
 * 3. Open https://script.google.com, create a project, paste this file, and
 *    set EXPORT_BUNDLE_FILE_ID to the ID from the uploaded file's Drive URL.
 * 4. Run exportActivitiesToGoogleDocs and grant Google the requested Drive
 *    permissions. It makes one brand-new folder and one brand-new Doc per
 *    activity. Large courses export eight Docs per run: run the same function
 *    again until the log says the export is complete. Existing Google links
 *    are not used or overwritten.
 * 5. Download colearn-google-export-mapping.json from the completed folder. Back in
 *    coLearn choose Manage Activities -> Attach Google Export and upload it.
 *
 * The mapping contains hashes. coLearn refuses to attach a document if the
 * local markup changed after the bundle was downloaded, preventing accidental
 * attachment of stale exports.
 */

// Paste the ID of the class_<id>_activities.json file uploaded to Google Drive.
const EXPORT_BUNDLE_FILE_ID = 'PASTE_DRIVE_FILE_ID_HERE';

// Change this if desired. The actual date/time is appended automatically.
const DESTINATION_FOLDER_NAME = 'coLearn activities export';

// Smaller batches avoid Google Apps Script / Google Docs service timeouts on
// a full course. Run exportActivitiesToGoogleDocs again to continue the same
// folder automatically.
const EXPORT_BATCH_SIZE = 8;
const EXPORT_STATE_KEY = 'colearn_google_export_state_v1';

function exportActivitiesToGoogleDocs() {
  if (!EXPORT_BUNDLE_FILE_ID || EXPORT_BUNDLE_FILE_ID === 'PASTE_DRIVE_FILE_ID_HERE') {
    throw new Error('Set EXPORT_BUNDLE_FILE_ID before running this script.');
  }

  const raw = DriveApp.getFileById(EXPORT_BUNDLE_FILE_ID)
    .getBlob()
    .getDataAsString('UTF-8');
  const bundle = JSON.parse(raw);
  if (!Array.isArray(bundle.activities) || bundle.activities.length === 0) {
    throw new Error('The uploaded JSON bundle does not contain activities. Download two or more activities from coLearn.');
  }

  const bundleHash = sha256Hex(raw);
  const state = getOrCreateExportState(bundle, bundleHash);
  const folder = DriveApp.getFolderById(state.folder_id);
  const endIndex = Math.min(state.next_index + EXPORT_BATCH_SIZE, bundle.activities.length);

  for (let index = state.next_index; index < endIndex; index += 1) {
    const activity = bundle.activities[index];
    const markup = String(activity.content_text || '');
    if (!markup.trim()) {
      throw new Error(`Activity ${activity.title || activity.name || `#${index + 1}`} has no local markup.`);
    }

    const activityName = String(activity.name || '').trim();
    const title = String(activity.title || activityName || `Activity ${index + 1}`).trim();
    // Keep the stable coLearn name in Drive. Names such as 01_introduction...
    // sort naturally, while the title remains readable to instructors.
    const documentTitle = activityName && activityName !== title
      ? `${activityName} — ${title}`
      : title;
    const documentInfo = createDocumentWithMarkup(documentTitle, markup);

    const documentFile = DriveApp.getFileById(documentInfo.id);
    documentFile.moveTo(folder);

    state.mapping.activities.push({
      activity_id: Number(activity.id),
      name: String(activity.name || ''),
      title,
      content_hash: sha256Hex(markup),
      google_doc_url: documentInfo.url,
    });
    state.next_index = index + 1;
    saveExportState(state);

    // Google Documents can briefly be unavailable during a large batch. A
    // small pause prevents the next creation from immediately hitting it.
    Utilities.sleep(300);
  }

  if (state.next_index < bundle.activities.length) {
    Logger.log(
      `Created ${state.next_index}/${bundle.activities.length} Docs in: ${folder.getUrl()}`
    );
    Logger.log('Run exportActivitiesToGoogleDocs again to continue this same folder.');
    return;
  }

  const mappingFile = folder.createFile(
    'colearn-google-export-mapping.json',
    JSON.stringify(state.mapping, null, 2),
    MimeType.PLAIN_TEXT
  );
  PropertiesService.getScriptProperties().deleteProperty(EXPORT_STATE_KEY);
  Logger.log(`Created ${state.mapping.activities.length} Google Docs in: ${folder.getUrl()}`);
  Logger.log(`Download this mapping file and upload it in coLearn: ${mappingFile.getUrl()}`);
}

function getOrCreateExportState(bundle, bundleHash) {
  const properties = PropertiesService.getScriptProperties();
  const stored = properties.getProperty(EXPORT_STATE_KEY);
  if (stored) {
    const state = JSON.parse(stored);
    if (state.bundle_file_id !== EXPORT_BUNDLE_FILE_ID || state.bundle_hash !== bundleHash) {
      throw new Error(
        'An unfinished export belongs to a different bundle. Run resetIncompleteExport() before starting a different bundle.'
      );
    }
    return state;
  }

  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmmss');
  const folder = DriveApp.createFolder(`${DESTINATION_FOLDER_NAME} ${timestamp}`);
  const state = {
    bundle_file_id: EXPORT_BUNDLE_FILE_ID,
    bundle_hash: bundleHash,
    folder_id: folder.getId(),
    next_index: 0,
    mapping: {
      format: 'colearn-google-export-mapping/v1',
      class_id: Number(bundle.class_id),
      created_at: new Date().toISOString(),
      folder_url: folder.getUrl(),
      activities: [],
    },
  };
  saveExportState(state);
  return state;
}

function saveExportState(state) {
  PropertiesService.getScriptProperties().setProperty(EXPORT_STATE_KEY, JSON.stringify(state));
}

// Use this only if you intentionally want to abandon an incomplete export and
// start over with another bundle. It does not delete the already-created folder.
function resetIncompleteExport() {
  PropertiesService.getScriptProperties().deleteProperty(EXPORT_STATE_KEY);
  Logger.log('Cleared the incomplete coLearn Google export state.');
}

function createDocumentWithMarkup(documentTitle, markup) {
  const document = DocumentApp.create(documentTitle);
  const documentId = document.getId();
  // Create the empty document with DocumentApp, then write the source through
  // the Docs REST API. DocumentApp.setText() can turn a long activity into
  // thousands of internal edits and eventually rejects the save.
  document.saveAndClose();
  let lastError = null;

  // Retry the same newly-created document rather than creating duplicates.
  // The REST batch update inserts the exact markup in one request, including
  // newlines, and avoids the DocumentApp "too many changes" limit.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      writeDocumentTextWithDocsApi(documentId, markup);
      return {
        id: documentId,
        url: `https://docs.google.com/document/d/${documentId}/edit`,
      };
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        Utilities.sleep(attempt * 1500);
      }
    }
  }

  throw new Error(`Could not save “${documentTitle}” after 3 attempts: ${lastError}`);
}

function writeDocumentTextWithDocsApi(documentId, markup) {
  const response = UrlFetchApp.fetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
      payload: JSON.stringify({
        requests: [{
          insertText: {
            location: { index: 1 },
            text: markup,
          },
        }],
      }),
      muteHttpExceptions: true,
    }
  );
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    const detail = response.getContentText().slice(0, 500);
    throw new Error(`Google Docs API returned ${code}: ${detail}`);
  }
}

function sha256Hex(value) {
  const normalized = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    normalized,
    Utilities.Charset.UTF_8
  );
  return digest.map((byte) => {
    const unsigned = (byte + 256) % 256;
    return unsigned.toString(16).padStart(2, '0');
  }).join('');
}
