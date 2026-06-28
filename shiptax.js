// shiptax.js — optional sales-tax + carrier-rate shipping integrations.
//
// Follows Atwe's graceful-degradation pattern (like mailer.js / billing.js / push.js):
// every function works with no configuration and simply returns the no-op result
// (zero tax / the seller's existing flat shipping fee), so checkout is unchanged when
// nothing is set up. Configuration is layered, cheapest-to-richest:
//   • Sales tax:  TAX_API_URL + TAX_API_KEY (a real tax service) → SALES_TAX_RATES
//                 (a JSON region→rate map) → SALES_TAX_RATE (a single flat rate) → none.
//   • Shipping:   SHIPPING_API_URL + SHIPPING_API_KEY (a real carrier-rate service) →
//                 SHIPPING_RATES (a JSON array of flat options) → the seller's flat fee.
// The real-API branches POST the ship-to + order to the provider; any failure falls
// through to the next tier, so a provider outage never blocks a sale.

const TAX_TIMEOUT_MS = 6000;

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function taxConfigured() {
  return !!((process.env.TAX_API_URL && process.env.TAX_API_KEY) || process.env.SALES_TAX_RATES || process.env.SALES_TAX_RATE);
}

// Estimate sales tax for a ship-to + taxable amount. Returns
// { taxCents, rate, source } — taxCents 0 (source 'none') when unconfigured.
async function estimateTax({ country, region, postal, taxableCents }) {
  const base = Math.max(0, Math.round(taxableCents || 0));
  if (base <= 0) return { taxCents: 0, rate: 0, source: 'none' };
  // 1) Real tax API (e.g. TaxJar-style). Expected JSON reply: { rate } or { taxCents }.
  if (process.env.TAX_API_URL && process.env.TAX_API_KEY) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), TAX_TIMEOUT_MS);
      const r = await fetch(process.env.TAX_API_URL, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TAX_API_KEY },
        body: JSON.stringify({ country, region, postal, amount_cents: base }),
      });
      clearTimeout(to);
      if (r.ok) {
        const j = await r.json();
        if (num(j.taxCents) != null) return { taxCents: Math.max(0, Math.round(j.taxCents)), rate: num(j.rate) || 0, source: 'api' };
        const rate = num(j.rate); if (rate != null && rate >= 0) return { taxCents: Math.round(base * rate), rate, source: 'api' };
      }
    } catch (e) { /* fall through to the configured tiers */ }
  }
  // 2) Region→rate map (keyed by region code, then country; e.g. {"CA":0.0725,"US":0.06}).
  if (process.env.SALES_TAX_RATES) {
    try {
      const m = JSON.parse(process.env.SALES_TAX_RATES);
      const rate = num(m[(region || '').toUpperCase()]) ?? num(m[(country || '').toUpperCase()]);
      if (rate != null && rate > 0) return { taxCents: Math.round(base * rate), rate, source: 'config' };
    } catch (e) { /* ignore malformed config */ }
  }
  // 3) Single flat rate.
  const flat = num(process.env.SALES_TAX_RATE);
  if (flat != null && flat > 0) return { taxCents: Math.round(base * flat), rate: flat, source: 'flat' };
  return { taxCents: 0, rate: 0, source: 'none' };
}

function ratesConfigured() {
  return !!((process.env.SHIPPING_API_URL && process.env.SHIPPING_API_KEY) || process.env.SHIPPING_RATES);
}

// Quote shipping options for a ship-to + items. Always returns at least one option;
// `flatCents` (the seller's existing flat fee) is the degraded default.
// Returns { options: [{ id, label, amountCents, days }], source }.
async function quoteRates({ country, region, postal, items, flatCents }) {
  const flat = Math.max(0, Math.round(flatCents || 0));
  // 1) Real carrier-rate API (e.g. EasyPost/Shippo-style). Expected: { rates:[{id,label,amountCents,days}] }.
  if (process.env.SHIPPING_API_URL && process.env.SHIPPING_API_KEY) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), TAX_TIMEOUT_MS);
      const r = await fetch(process.env.SHIPPING_API_URL, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.SHIPPING_API_KEY },
        body: JSON.stringify({ country, region, postal, items }),
      });
      clearTimeout(to);
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.rates) && j.rates.length) {
          const options = j.rates.slice(0, 8).map((o, i) => ({ id: String(o.id || 'r' + i), label: String(o.label || 'Shipping').slice(0, 60), amountCents: Math.max(0, Math.round(num(o.amountCents) || 0)), days: o.days != null ? String(o.days).slice(0, 20) : null }));
          return { options, source: 'api' };
        }
      }
    } catch (e) { /* fall through */ }
  }
  // 2) Configured flat options (a JSON array — lets sellers offer Standard/Express without a carrier API).
  if (process.env.SHIPPING_RATES) {
    try {
      const arr = JSON.parse(process.env.SHIPPING_RATES);
      if (Array.isArray(arr) && arr.length) {
        const options = arr.slice(0, 8).map((o, i) => ({ id: 'r' + i, label: String(o.label || 'Shipping').slice(0, 60), amountCents: Math.max(0, Math.round(num(o.amountCents) || 0)), days: o.days != null ? String(o.days).slice(0, 20) : null }));
        return { options, source: 'config' };
      }
    } catch (e) { /* ignore malformed config */ }
  }
  // 3) Degrade to the seller's flat fee as a single option.
  return { options: [{ id: 'flat', label: 'Standard shipping', amountCents: flat, days: null }], source: 'flat' };
}

module.exports = { taxConfigured, estimateTax, ratesConfigured, quoteRates };
