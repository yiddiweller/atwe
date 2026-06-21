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
const FROM = process.env.MAIL_FROM || 'Atwe AI <no-reply@atwe.com>';

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

async function sendMail({ to, subject, html, text, replyTo, from }) {
  if (!transport) {
    console.log(
      `\n✉️   [DEV EMAIL] to=${to}\n     subject: ${subject}\n     ${text || ''}\n`
    );
    return { delivered: false };
  }
  const msg = { from: from || FROM, to, subject, html, text };
  // Per-call Reply-To wins (e.g. the support form replies to the sender);
  // otherwise fall back to MAIL_REPLY_TO so replies to automated mail (sent from
  // a send-only address like alerts@) land in a real inbox (e.g. team@atwe.com).
  const rt = replyTo || process.env.MAIL_REPLY_TO;
  if (rt) msg.replyTo = rt;
  await transport.sendMail(msg);
  return { delivered: true };
}

// The base URL used to build action links in emails.
function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

// ── Branded HTML email template ──────────────────────────────────────────────
// A clean, email-client-safe layout (table-based, inline styles): a dark Atwe
// header with the logo, a white card with the message, an optional big code or
// accent button, and a footer. Renders nicely in Gmail / Apple Mail / Outlook.
const ACCENT = '#0ea5e9';
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function brand({ preheader = '', heading = '', intro = '', code = '', bodyHtml = '', button = null }) {
  const base = appUrl();
  const logo = base + '/logo-mark.png';
  const codeBlock = code ? `
    <tr><td style="padding:6px 0 12px;">
      <div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:34px;font-weight:800;letter-spacing:9px;
        color:#0b0b0c;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:14px;padding:18px 0;text-align:center;">${esc(code)}</div>
    </td></tr>` : '';
  const btn = button ? `
    <tr><td style="padding:10px 0 4px;">
      <a href="${button.url}" style="display:inline-block;background:${ACCENT};color:#ffffff !important;text-decoration:none;
        font-weight:700;font-size:15px;line-height:1;padding:14px 28px;border-radius:999px;">${esc(button.text)}</a>
    </td></tr>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f4f6;-webkit-font-smoothing:antialiased;">
  <span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:30px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:484px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #e7e7eb;">
        <tr><td style="background:#0b0b0c;padding:26px 0;text-align:center;">
          <img src="${logo}" width="36" height="36" alt="" style="display:inline-block;vertical-align:middle;border:0;"/>
          <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-.02em;vertical-align:middle;margin-left:9px;">Atwe</span>
        </td></tr>
        <tr><td style="padding:32px 32px 30px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${heading ? `<tr><td style="font-size:22px;font-weight:800;color:#0b0b0c;letter-spacing:-.02em;padding-bottom:12px;">${esc(heading)}</td></tr>` : ''}
            ${intro ? `<tr><td style="font-size:15px;line-height:1.62;color:#3f3f46;padding-bottom:10px;">${intro}</td></tr>` : ''}
            ${codeBlock}
            ${bodyHtml ? `<tr><td style="font-size:15px;line-height:1.62;color:#3f3f46;padding-bottom:8px;">${bodyHtml}</td></tr>` : ''}
            ${btn}
          </table>
        </td></tr>
        <tr><td style="padding:18px 32px 26px;border-top:1px solid #eeeef1;">
          <div style="font-size:12.5px;color:#a0a0a8;line-height:1.7;">
            <a href="${base}" style="color:#a0a0a8;text-decoration:none;">atwe.com</a> &nbsp;·&nbsp; The network built for business.<br/>
            © Atwe INC. You're receiving this because you have an Atwe account.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

module.exports = { isConfigured, sendMail, appUrl, brand };
