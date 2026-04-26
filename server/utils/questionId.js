function isValidQuestionId(value) {
  const qid = String(value || '').trim();
  if (!qid) return false;

  // Core response ids such as 1a, 2b, 10c
  if (/^\d+[A-Za-z]+$/.test(qid)) return true;

  // Per-question derived keys such as:
  // 1aS, 1aF1, 1aFM, 1aAF, 1aCodeFeedback, 1aCodeAccepted, 1aCodeCanContinue,
  // 1aCodeRetryCount, 1aCodeRetriesRequired, 1aCodeSubmissionString,
  // 1acode1, 1aoutput, 1aattempts
  if (/^\d+[A-Za-z]+[A-Za-z0-9_]*$/.test(qid)) return true;

  // Table cell keys such as 1atable1cell0_0
  if (/^\d+[A-Za-z]+table\d+cell\d+_\d+$/.test(qid)) return true;

  // Group state / retry bookkeeping keys
  if (/^\d+state$/i.test(qid)) return true;
  if (/^attempt:\d+$/i.test(qid)) return true;
  if (/^R(?:cnt|max|hash):\d+$/i.test(qid)) return true;

  return false;
}

module.exports = { isValidQuestionId };
