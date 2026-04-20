function extractGoogleFileId(rawUrl) {
  if (!rawUrl || rawUrl === 'undefined') {
    return null;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const allowedHosts = new Set(['docs.google.com', 'drive.google.com']);
  if (!allowedHosts.has(url.hostname)) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const idIndex = segments.findIndex(segment => segment === 'd' || segment === 'folders');
  const id = idIndex >= 0 ? segments[idIndex + 1] : null;

  return id && /^[-\w]{25,}$/.test(id) ? id : null;
}

module.exports = {
  extractGoogleFileId,
};
