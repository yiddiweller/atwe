// finance.js — optional market-data for $cashtags (graceful degradation, exactly
// like mailer/billing/geoip/stt). With NOTHING configured it uses a free, no-key
// provider (Yahoo Finance's public chart endpoint) on a best-effort basis; set
// FINANCE_PROVIDER=off to disable, or point it at a keyed provider. Any failure
// (blocked network, bad symbol, rate limit) resolves to null so the caller falls
// back to the in-app post stream — the price/chart is never load-bearing.
'use strict';

const PROVIDER = (process.env.FINANCE_PROVIDER || 'yahoo').toLowerCase();
// Optional keyed providers (Finnhub / Twelve Data) — used if a key is present.
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';
const TWELVE_KEY = process.env.TWELVEDATA_API_KEY || '';

function isConfigured() { return PROVIDER !== 'off'; }

// Range → Yahoo (range, interval). Kept small + whitelisted.
const YRANGE = {
  '1D': ['1d', '5m'], '1W': ['5d', '15m'], '1M': ['1mo', '1d'],
  '1Y': ['1y', '1wk'], 'ALL': ['max', '1mo'],
};

async function _getJson(url, headers) {
  // Node 18+ global fetch. Uses HTTPS_PROXY automatically when set.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { headers: headers || {}, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) { return null; } finally { clearTimeout(t); }
}

// Yahoo public chart endpoint. Returns {symbol,name,price,prevClose,changePct,currency,series:[{t,c}]}.
async function _yahoo(symbol, range) {
  const [r, i] = YRANGE[range] || YRANGE['1D'];
  const tryOne = async (sym) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${r}&interval=${i}&includePrePost=false`;
    const j = await _getJson(url, { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' });
    const res = j && j.chart && j.chart.result && j.chart.result[0];
    if (!res || !res.meta) return null;
    const ts = res.timestamp || [];
    const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
    const series = [];
    for (let k = 0; k < ts.length; k++) { const c = closes[k]; if (c != null && isFinite(c)) series.push({ t: ts[k] * 1000, c }); }
    const m = res.meta;
    const price = m.regularMarketPrice != null ? m.regularMarketPrice : (series.length ? series[series.length - 1].c : null);
    const prevClose = m.chartPreviousClose != null ? m.chartPreviousClose : (m.previousClose != null ? m.previousClose : (series.length ? series[0].c : null));
    if (price == null) return null;
    const changePct = (prevClose != null && prevClose !== 0) ? ((price - prevClose) / prevClose) * 100 : null;
    return { symbol: (m.symbol || sym).toUpperCase(), name: m.longName || m.shortName || null, price, prevClose, changePct, currency: m.currency || 'USD', series };
  };
  // Plain ticker first (stocks); then crypto convention SYM-USD.
  return (await tryOne(symbol)) || (/^[A-Z]{2,6}$/.test(symbol) ? await tryOne(symbol + '-USD') : null);
}

// Finnhub (keyed) — quote only (no intraday series on the free tier here); we still
// return a flat series from prev→current so the card renders a line.
async function _finnhub(symbol) {
  const j = await _getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`);
  if (!j || j.c == null || j.c === 0) return null;
  const price = j.c, prevClose = j.pc != null ? j.pc : j.c;
  return { symbol: symbol.toUpperCase(), name: null, price, prevClose, changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : null, currency: 'USD', series: [{ t: Date.now() - 86400000, c: prevClose }, { t: Date.now(), c: price }] };
}

// Main entry. Returns the quote object or null (→ caller shows the post stream only).
async function quote(symbol, range) {
  if (!isConfigured()) return null;
  symbol = String(symbol || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
  if (!symbol) return null;
  range = YRANGE[range] ? range : '1D';
  try {
    if (PROVIDER === 'finnhub' && FINNHUB_KEY) return await _finnhub(symbol);
    // default: yahoo (no key). Keyed providers can be forced via FINANCE_PROVIDER.
    return await _yahoo(symbol, range);
  } catch (_) { return null; }
}

module.exports = { isConfigured, quote, RANGES: Object.keys(YRANGE) };
