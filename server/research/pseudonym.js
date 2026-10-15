'use strict';

// Pseudonymous research IDs. One server secret (RESEARCH_ID_SECRET) for all
// exports, so the same student or group gets the same ID across activities and
// across exports, while the ID cannot be turned back into a database user ID
// without the secret. Names and emails are never exported.
const crypto = require('crypto');

function researchSecret() {
  const secret = String(process.env.RESEARCH_ID_SECRET || '');
  if (secret.length < 16) {
    throw new Error('RESEARCH_ID_SECRET must be set (16+ characters) to produce research exports.');
  }
  return secret;
}

/** e.g. pseudonym('student', 42) -> 'S-3f9a1c0b7d2e' */
function pseudonym(kind, id, secret = researchSecret()) {
  if (id == null) return null;
  const prefix = { student: 'S', group: 'G', instructor: 'I' }[kind] || 'X';
  const digest = crypto.createHmac('sha256', secret).update(`${kind}:${id}`).digest('hex');
  return `${prefix}-${digest.slice(0, 12)}`;
}

module.exports = { pseudonym, researchSecret };
