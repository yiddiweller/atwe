/* HOW FAST DOES ATWE OPEN?
 *
 * The shell is one ~4.9MB file (1.27MB over the wire), so a phone spends most of a
 * second downloading, decompressing and PARSING it before a single line of the app
 * has run — and until then the app cannot ask the server for anything. Measured at a
 * 4x CPU throttle the server answered at 135ms and the first API call went out at
 * 2020ms: nearly two seconds in which the network did nothing at all.
 *
 * The boot preflight (a tiny script at the top of index.html) fires the three requests
 * every boot certainly makes, so they overlap the parse instead of queueing behind it.
 *
 * This probe A/Bs it in ONE process against the SAME server, by stripping the preflight
 * out of the HTML for the control run — the alternative (stash the file, re-run) also
 * changes the server's cached shell and the OS page cache, and gave numbers that moved
 * 800ms between identical runs. It reports MEDIANS over several loads: a single boot
 * measurement here is worthless.
 */
const { chromium } = require(__dirname + '/node_modules/playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
const CPU = Number(process.env.CPU || 4);
const N = Number(process.env.N || 3);   // enough for a median; raise it when investigating
const LAT = Number(process.env.LAT || 0);   // one-way ms added to every request
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function boot(b, strip) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  /* Seed the token on a THROWAWAY page and throw it away. Seeding on the page we are
     about to measure meant that page's FIRST boot was still in flight when the clock
     started, and its API calls were counted as the measured load's — the control
     appeared to reach the server at 14ms, which is impossible with no preflight. */
  const seed = await ctx.newPage();
  await seed.goto(BASE + '/', { waitUntil: 'commit' });
  await seed.evaluate((t) => localStorage.setItem('atwe_token', t), process.env.TOK);
  await seed.close();

  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  /* Latency is the whole point on a real phone: the server is not on this machine.
     With LAT=0 (a local server, ~30ms round trip) the saving is small, because what
     the preflight removes is WAITING, and there is barely any to remove. Set LAT to a
     realistic mobile round trip to see what it is actually worth. */
  if (LAT) await cdp.send('Network.emulateNetworkConditions',
    { offline: false, latency: LAT, downloadThroughput: 4 * 1024 * 1024 / 8, uploadThroughput: 1024 * 1024 / 8 });
  if (strip) {
    /* Remove ONLY the preflight, byte for byte, so the control is this exact build
       minus the one change — not an older build with other differences in it. */
    await p.route(BASE + '/', async (route) => {
      const r = await route.fetch();
      let html = await r.text();
      const i = html.indexOf('window.__pre = (function');
      if (i > 0) {
        const s = html.lastIndexOf('<script>', i), e = html.indexOf('</script>', i) + 9;
        html = html.slice(0, s) + html.slice(e);
      }
      await route.fulfill({ response: r, body: html });
    });
  }
  const marks = [];
  p.on('request', (r) => { const u = r.url().replace(BASE, ''); if (u.startsWith('/api/')) marks.push([Date.now(), u.split('?')[0]]); });
  const t0 = Date.now();
  await p.goto(BASE + '/', { waitUntil: 'commit' });
  let firstPost = null;
  for (let i = 0; i < 300; i++) {
    const n = await p.evaluate(() => document.querySelectorAll('#acFeed .ac-post').length).catch(() => 0);
    if (n > 0) { firstPost = Date.now() - t0; break; }
    await p.waitForTimeout(40);
  }
  const firstApi = marks.length ? marks[0][0] - t0 : null;
  const feedReq = (marks.find((m) => m[1] === '/api/social/feed') || [])[0];
  await ctx.close();
  return { firstApi, feedReq: feedReq ? feedReq - t0 : null, firstPost };
}

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  const runs = { off: [], on: [] };
  for (let i = 0; i < N; i++) {
    runs.off.push(await boot(b, true));
    runs.on.push(await boot(b, false));
  }
  await b.close();
  const pick = (k, w) => median(runs[w].map((r) => r[k]).filter((x) => x != null));
  const off = { api: pick('firstApi', 'off'), feed: pick('feedReq', 'off'), post: pick('firstPost', 'off') };
  const on  = { api: pick('firstApi', 'on'),  feed: pick('feedReq', 'on'),  post: pick('firstPost', 'on') };
  console.log(`\n  CPU x${CPU}${LAT ? ', ' + LAT + 'ms network latency' : ', local server'}, ${N} loads each, medians (ms)`);
  console.log('                       without   with   saved');
  const row = (l, a, c) => console.log('  ' + l.padEnd(20) + String(a).padStart(7) + String(c).padStart(7) + String(a - c).padStart(8));
  row('first request out', off.api, on.api);
  row('feed requested', off.feed, on.feed);
  row('first post on screen', off.post, on.post);
  console.log('');
  ok(on.api < off.api - 300, 'the app asks the server for something far sooner', off.api + ' -> ' + on.api);
  ok(on.feed < off.feed - 300, 'and the feed specifically', off.feed + ' -> ' + on.feed);
  ok(on.post < off.post, 'so a post is on screen sooner', off.post + ' -> ' + on.post);
  ok(on.api < 700, 'the first request goes out while the file is still parsing', String(on.api));
  console.log(fail ? `\n${fail} FAILED` : '\nThe network no longer waits for the parse');
  process.exit(fail ? 1 : 0);
})();
