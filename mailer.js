/* ═══════════════════════════════════════════════
   MAILER  —  transactional email (verification, reset)
   ───────────────────────────────────────────────
   Uses SMTP (nodemailer) when SMTP_* env vars are set. When they are
   not, it degrades gracefully: the message (including any action link)
   is logged to the server console so flows are still testable in dev,
   and isConfigured() reports false so the UI can adapt.
═══════════════════════════════════════════════ */
const nodemailer = require('nodemailer');

const HOST = process.env.SMTP_HOST;
const PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM || 'Atwe AI <no-reply@atwe.ai>';

let transport = null;
if (HOST && USER && PASS) {
  transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: PORT === 465, // implicit TLS on 465, STARTTLS otherwise
    auth: { user: USER, pass: PASS },
  });
} else {
  console.warn(
    '⚠️  SMTP not configured — verification/reset emails will be logged to the console instead of sent.'
  );
}

function isConfigured() {
  return !!transport;
}

async function sendMail({ to, subject, html, text, replyTo }) {
  if (!transport) {
    console.log(
      `\n✉️   [DEV EMAIL] to=${to}\n     subject: ${subject}\n     ${text || ''}\n`
    );
    return { delivered: false };
  }
  const msg = { from: FROM, to, subject, html, text };
  if (replyTo) msg.replyTo = replyTo;
  await transport.sendMail(msg);
  return { delivered: true };
}

// The base URL used to build action links in emails.
function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

module.exports = { isConfigured, sendMail, appUrl };
