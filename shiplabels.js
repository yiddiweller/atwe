// shiplabels.js — optional real shipping-label purchasing via Shippo.
//
// Follows Atwe's graceful-degradation pattern (like mailer.js / billing.js / push.js /
// shiptax.js): every function is a no-op / returns a clear "not configured" result when
// SHIPPO_API_KEY isn't set, so a seller without it keeps using the existing manual
// carrier + tracking-number entry on /api/orders/:id/ship. With a key set, a seller can
// get real multi-carrier rates (USPS/UPS/FedEx/DHL/etc.) for an order and buy an actual
// label (PDF) + tracking number in one flow.
//
// Shippo's REST API needs no SDK — a bearer-style "ShippoToken" header, JSON in/out.
// Docs: https://goshippo.com/docs/reference

const API_BASE = 'https://api.goshippo.com';
const TIMEOUT_MS = 10000;

function isConfigured() {
  return !!process.env.SHIPPO_API_KEY;
}

function headers() {
  return { 'Content-Type': 'application/json', Authorization: 'ShippoToken ' + process.env.SHIPPO_API_KEY };
}

async function req(method, path, body) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(API_BASE + path, { method, signal: ctrl.signal, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    return { status: r.status, ok: r.ok, body: j };
  } finally { clearTimeout(to); }
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
// Shippo quotes dollars as a string ("5.50"); the app's money is integer cents everywhere.
function toCents(dollarsStr) { const n = num(dollarsStr); return n == null ? null : Math.round(n * 100); }

function addrPayload(a) {
  return {
    name: a.name, street1: a.line1, street2: a.line2 || '', city: a.city,
    state: a.region || '', zip: a.postal || '', country: a.country || 'US',
    phone: a.phone || undefined, email: a.email || undefined,
  };
}

// Create a shipment (address_from + address_to + one parcel) and return its rate
// options. Returns { ok, rates:[{id,carrier,service,amountCents,days}] } | { ok:false, error }.
async function getRates({ addressFrom, addressTo, parcel }) {
  if (!isConfigured()) return { ok: false, error: 'Shipping labels aren’t configured.' };
  try {
    const r = await req('POST', '/shipments/', {
      address_from: addrPayload(addressFrom),
      address_to: addrPayload(addressTo),
      parcels: [{
        length: String(parcel.lengthIn), width: String(parcel.widthIn), height: String(parcel.heightIn), distance_unit: 'in',
        weight: String(parcel.weightLb), mass_unit: 'lb',
      }],
      async: false,
    });
    if (!r.ok || !r.body) return { ok: false, error: (r.body && r.body.detail) || 'Could not get shipping rates.' };
    const rates = (r.body.rates || [])
      .filter((x) => x.amount)
      .map((x) => ({
        id: x.object_id,
        carrier: String(x.provider || 'Carrier').slice(0, 40),
        service: String((x.servicelevel && x.servicelevel.name) || '').slice(0, 60),
        amountCents: toCents(x.amount) || 0,
        days: x.estimated_days != null ? String(x.estimated_days) : null,
      }))
      .sort((a, b) => a.amountCents - b.amountCents);
    if (!rates.length) return { ok: false, error: 'No shipping rates are available for this address.' };
    return { ok: true, rates, shipmentId: r.body.object_id };
  } catch (e) { return { ok: false, error: 'Could not reach the shipping provider.' }; }
}

// Re-fetch a single rate's authoritative amount right before charging for it — never
// trust a client-supplied cents figure for what to debit the seller.
async function getRate(rateId) {
  if (!isConfigured()) return { ok: false, error: 'Shipping labels aren’t configured.' };
  try {
    const r = await req('GET', '/rates/' + encodeURIComponent(rateId) + '/');
    if (!r.ok || !r.body || !r.body.amount) return { ok: false, error: 'That rate is no longer available.' };
    return {
      ok: true,
      amountCents: toCents(r.body.amount) || 0,
      carrier: String(r.body.provider || 'Carrier').slice(0, 40),
      service: String((r.body.servicelevel && r.body.servicelevel.name) || '').slice(0, 60),
    };
  } catch (e) { return { ok: false, error: 'Could not reach the shipping provider.' }; }
}

// Purchase the label for a given rate. Returns { ok, trackingNumber, labelUrl,
// transactionId, carrier } | { ok:false, error }.
async function buyLabel(rateId) {
  if (!isConfigured()) return { ok: false, error: 'Shipping labels aren’t configured.' };
  try {
    const r = await req('POST', '/transactions/', { rate: rateId, label_file_type: 'PDF', async: false });
    if (!r.ok || !r.body) return { ok: false, error: 'Could not purchase the shipping label.' };
    if (r.body.status !== 'SUCCESS') {
      const msg = (r.body.messages && r.body.messages[0] && r.body.messages[0].text) || 'The shipping provider rejected this label.';
      return { ok: false, error: msg };
    }
    return {
      ok: true,
      trackingNumber: r.body.tracking_number || null,
      labelUrl: r.body.label_url || null,
      transactionId: r.body.object_id || null,
    };
  } catch (e) { return { ok: false, error: 'Could not reach the shipping provider.' }; }
}

// Map a carrier/provider name Shippo returns (e.g. "usps", "UPS", "fedex") onto the
// app's fixed CARRIERS list so the same tracking-link lookup used for manually-entered
// tracking numbers also works for label-purchased ones. Falls back to 'Other'.
function normalizeCarrier(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('usps')) return 'USPS';
  if (s.includes('ups')) return 'UPS';
  if (s.includes('fedex')) return 'FedEx';
  if (s.includes('dhl')) return 'DHL';
  return 'Other';
}

module.exports = { isConfigured, getRates, getRate, buyLabel, normalizeCarrier };
