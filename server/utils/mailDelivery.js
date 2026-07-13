const crypto = require('node:crypto');
const nodemailer = require('nodemailer');

const DEFAULT_APP_NAME = 'coLearn-AI';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_EXPIRY_MINUTES = 10;
<<<<<<< emailRelay
const LOG_PREFIX = '[mail-delivery]';
=======
>>>>>>> main

function getMailDeliveryMode() {
  const raw = String(process.env.MAIL_DELIVERY_MODE || 'direct').trim().toLowerCase();
  return raw === 'remote' ? 'remote' : 'direct';
}

function hasDirectMailCreds() {
  return !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function createDirectTransporter() {
  if (!hasDirectMailCreds()) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

const directTransporter = createDirectTransporter();

async function sendCodeEmail({ recipientEmail, purpose, code, requestId }) {
<<<<<<< emailRelay
  const mode = getMailDeliveryMode();
  console.info(`${LOG_PREFIX} mode=${mode} purpose=${purpose} recipient=${maskEmail(recipientEmail)} requestId=${requestId || 'none'}`);

  if (mode === 'remote') {
=======
  if (getMailDeliveryMode() === 'remote') {
>>>>>>> main
    await sendRemoteCodeEmail({ recipientEmail, purpose, code, requestId });
    return;
  }

  await sendDirectCodeEmail({ recipientEmail, purpose, code });
}

async function sendDirectCodeEmail({ recipientEmail, purpose, code }) {
  if (!directTransporter) {
    const codeLabel = purpose === 'reset' ? 'reset code' : 'verification code';
    console.warn(`[auth] Mail disabled; ${codeLabel} for ${recipientEmail} is: ${code}`);
    return;
  }

<<<<<<< emailRelay
  console.info(`${LOG_PREFIX} direct-send start purpose=${purpose} recipient=${maskEmail(recipientEmail)}`);
=======
>>>>>>> main
  await directTransporter.sendMail({
    from: process.env.EMAIL_USER,
    to: recipientEmail,
    subject: purpose === 'reset' ? 'coLearn-AI Password Reset Code' : 'Your coLearn-AI Verification Code',
    text: purpose === 'reset' ? `Your reset code is: ${code}` : `Your confirmation code is: ${code}`,
  });
<<<<<<< emailRelay
  console.info(`${LOG_PREFIX} direct-send accepted purpose=${purpose} recipient=${maskEmail(recipientEmail)}`);
=======
>>>>>>> main
}

async function sendRemoteCodeEmail({ recipientEmail, purpose, code, requestId }) {
  const relayUrl = requireRemoteEnv('REMOTE_MAIL_URL');
  const relayId = requireRemoteEnv('REMOTE_MAIL_RELAY_ID');
  const relaySecret = requireRemoteEnv('REMOTE_MAIL_SECRET');
  const appName = String(process.env.REMOTE_MAIL_APP_NAME || DEFAULT_APP_NAME).trim() || DEFAULT_APP_NAME;
  const appUrl = String(process.env.CLIENT_ORIGIN || '').trim();
  const expiresInMinutes = Number(process.env.REMOTE_MAIL_EXPIRES_IN_MINUTES || DEFAULT_EXPIRY_MINUTES);
  const timeoutMs = Number(process.env.REMOTE_MAIL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  const body = {
    recipientEmail,
    purpose,
    code,
    appName,
    appUrl,
    relayId,
    locale: 'en',
    expiresInMinutes: Number.isFinite(expiresInMinutes) ? expiresInMinutes : DEFAULT_EXPIRY_MINUTES,
    requestId: requestId || `${purpose}-${Date.now()}`,
  };

  const json = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(12).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(json).digest('hex');
  const canonical = `${timestamp}.${nonce}.${bodyHash}`;
  const signature = crypto.createHmac('sha256', relaySecret).update(canonical).digest('hex');

<<<<<<< emailRelay
  const relayEndpoint = `${relayUrl.replace(/\/+$/, '')}/v1/send-code`;
  console.info(`${LOG_PREFIX} remote-send start purpose=${purpose} recipient=${maskEmail(recipientEmail)} relayId=${relayId} url=${relayEndpoint} requestId=${body.requestId}`);

  const relayFetch = globalThis.__colearnMailRelayFetch || fetch;
  const response = await relayFetch(relayEndpoint, {
=======
  const relayFetch = globalThis.__colearnMailRelayFetch || fetch;
  const response = await relayFetch(`${relayUrl.replace(/\/+$/, '')}/v1/send-code`, {
>>>>>>> main
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-relay-id': relayId,
      'x-relay-timestamp': timestamp,
      'x-relay-nonce': nonce,
      'x-relay-signature': signature,
    },
    body: json,
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const failure = await readJsonSafely(response);
    const message =
      failure?.error?.message ||
      failure?.message ||
      `remote mail relay request failed with status ${response.status}`;
<<<<<<< emailRelay
    console.error(`${LOG_PREFIX} remote-send failed purpose=${purpose} recipient=${maskEmail(recipientEmail)} status=${response.status} requestId=${body.requestId}`, failure || message);
    throw new Error(message);
  }

  console.info(`${LOG_PREFIX} remote-send accepted purpose=${purpose} recipient=${maskEmail(recipientEmail)} status=${response.status} requestId=${body.requestId}`);
=======
    throw new Error(message);
  }
>>>>>>> main
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

<<<<<<< emailRelay
function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 1) return value || 'unknown';
  return `${value.slice(0, 2)}***${value.slice(at)}`;
}

=======
>>>>>>> main
function requireRemoteEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required remote mail setting: ${name}`);
  }
  return value;
}

module.exports = {
  getMailDeliveryMode,
  sendCodeEmail,
};
