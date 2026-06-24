/* ═══════════════════════════════════════════════
   GEOIP  —  best-effort IP → "City, Country" for the Devices list
   + login-alert emails.

   Optional and degrades cleanly (like mailer/billing): a lookup that fails,
   times out, or hits a private/unknown IP just returns null, and callers fall
   back to showing the raw IP. Uses a free, no-key HTTPS provider by default
   (overridable via GEOIP_URL); set GEOIP_DISABLED=true to turn it off entirely.
═══════════════════════════════════════════════ */

// {ip} is substituted with the address. Default: ipwho.is (free, no key, HTTPS).
const ENDPOINT = process.env.GEOIP_URL || 'https://ipwho.is/{ip}';
const DISABLED = process.env.GEOIP_DISABLED === 'true';
const TIMEOUT_MS = 3000;

function isConfigured() { return !DISABLED; }

// Only public IPs are worth resolving — localhost / LAN / link-local never geolocate.
function isPublicIp(ip) {
  if (!ip) return false;
  const s = String(ip).trim().toLowerCase();
  if (!s || s === 'localhost' || s === '::1' || s === '::') return false;
  if (s.startsWith('127.') || s.startsWith('10.') || s.startsWith('192.168.') || s.startsWith('169.254.')) return false;
  // 172.16.0.0 – 172.31.255.255
  const m = /^172\.(\d{1,3})\./.exec(s);
  if (m) { const o = +m[1]; if (o >= 16 && o <= 31) return false; }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')) return false;
  return true;
}

// Compose "City, Country" from whatever fields the provider returned (tolerant of
// the common shapes: ipwho.is, ip-api, ipapi.co). Returns null if nothing usable.
function format(d) {
  if (!d || typeof d !== 'object') return null;
  if (d.success === false || d.status === 'fail') return null;
  const city = d.city || d.region || d.region_name || '';
  const country = d.country || d.country_name || d.countryCode || '';
  const out = [city, country].map((x) => String(x || '').trim()).filter(Boolean);
  return out.length ? out.join(', ') : null;
}

// Resolve an IP to a place string, or null. Never throws.
async function lookup(ip) {
  if (DISABLED || !isPublicIp(ip)) return null;
  const url = ENDPOINT.replace('{ip}', encodeURIComponent(String(ip).trim()));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return format(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { lookup, isConfigured };
