/* ═══════════════════════════════════════════════
   SMS  —  text messages, for the two things worth a text
   ───────────────────────────────────────────────
   Deliberately narrow. Email and push already carry everything social; a text
   is intrusive and it costs money, so this is reserved for security alerts and
   money events, and it is OFF unless a member turns it on and verifies a number.

   Optional, like every other integration here: with no provider configured,
   isConfigured() is false, nothing is sent, and the message is written to the
   console so the flow is still testable — exactly how mailer.js behaves.

   Provider: Twilio's REST API over plain fetch (no SDK, no new dependency).
   Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM. A generic HTTP
   provider works too via SMS_API_URL + SMS_API_KEY.
═══════════════════════════════════════════════ */

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;
const API_URL = process.env.SMS_API_URL;
const API_KEY = process.env.SMS_API_KEY;

const provider = (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) ? 'twilio'
  : (API_URL && API_KEY) ? 'http' : null;

if (!provider) {
  console.warn('⚠️  SMS not configured — security/money texts will be logged to the console instead of sent.');
}

function isConfigured() { return !!provider; }
function providerName() { return provider; }

/* E.164 or nothing. A number we can't be sure about is a number we won't text:
   a wrong digit sends someone else's security alert to a stranger. */
function normalizePhone(raw) {
  let s = String(raw || '').trim().replace(/[\s()\-.]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) return null;         // require the country code, explicitly
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  return s;
}
// What a member should see — never the whole number, in case a screen is shared.
function maskPhone(e164) {
  const s = String(e164 || '');
  if (s.length < 5) return s;
  return s.slice(0, 3) + '•'.repeat(Math.max(0, s.length - 5)) + s.slice(-2);
}

async function send(to, body) {
  const phone = normalizePhone(to);
  if (!phone) return { delivered: false, error: 'invalid number' };
  const text = String(body || '').slice(0, 320);
  if (!provider) {
    console.log(`\n📱  [DEV SMS] to=${maskPhone(phone)}\n     ${text}\n`);
    return { delivered: false, dev: true };
  }
  try {
    if (provider === 'twilio') {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_SID)}/Messages.json`;
      const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: phone, From: TWILIO_FROM, Body: text }).toString(),
      });
      if (!r.ok) return { delivered: false, error: 'provider returned ' + r.status };
      return { delivered: true };
    }
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, text }),
    });
    if (!r.ok) return { delivered: false, error: 'provider returned ' + r.status };
    return { delivered: true };
  } catch (e) {
    // A texting failure must never break the thing that triggered it.
    return { delivered: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}

module.exports = { isConfigured, providerName, send, normalizePhone, maskPhone };
