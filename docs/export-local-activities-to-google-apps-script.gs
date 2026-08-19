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
 *    activity. Existing Google links are not used or overwritten.
 * 5. Download colearn-google-export-mapping.json from the new folder. Back in
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

  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmmss');
  const folder = DriveApp.createFolder(`${DESTINATION_FOLDER_NAME} ${timestamp}`);
  const mapping = {
    format: 'colearn-google-export-mapping/v1',
    class_id: Number(bundle.class_id),
    created_at: new Date().toISOString(),
    folder_url: folder.getUrl(),
    activities: [],
  };

  bundle.activities.forEach((activity, index) => {
    const markup = String(activity.content_text || '');
    if (!markup.trim()) {
      throw new Error(`Activity ${activity.title || activity.name || `#${index + 1}`} has no local markup.`);
    }

    const title = String(activity.title || activity.name || `Activity ${index + 1}`).trim();
    const document = DocumentApp.create(title);
    document.getBody().setText(markup);
    document.saveAndClose();

    const documentFile = DriveApp.getFileById(document.getId());
    folder.addFile(documentFile);
    // New files start in My Drive root. Move each one to the new course folder.
    DriveApp.getRootFolder().removeFile(documentFile);

    mapping.activities.push({
      activity_id: Number(activity.id),
      name: String(activity.name || ''),
      title,
      content_hash: sha256Hex(markup),
      google_doc_url: document.getUrl(),
    });
  });

  const mappingFile = folder.createFile(
    'colearn-google-export-mapping.json',
    JSON.stringify(mapping, null, 2),
    MimeType.PLAIN_TEXT
  );
  Logger.log(`Created ${mapping.activities.length} Google Docs in: ${folder.getUrl()}`);
  Logger.log(`Download this mapping file and upload it in coLearn: ${mappingFile.getUrl()}`);
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
