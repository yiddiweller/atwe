/* A VOICE NOTE HAS TO PLAY ON THE RECIPIENT'S PHONE.
 *
 * It "almost didn't work at all" for the founder, on an iPhone, and the cause was format,
 * twice over:
 *   1. the recorder preferred audio/webm, which iOS Safari has NO decoder for — so every
 *      note recorded on Chrome or Android was silent on an iPhone;
 *   2. preferring audio/mp4 then LOOKED right and was worse: Chrome answers TRUE to
 *      isTypeSupported('audio/mp4') and records OPUS INSIDE it. An iPhone opens the
 *      container and still decodes nothing — and a conversion guard that tested the type
 *      for "mp4" skipped exactly the case it existed to catch. THE CONTAINER IS NOT THE
 *      CODEC.
 * So anything Opus/Vorbis/WebM/Ogg is re-encoded to WAV before sending, and this drives
 * the real flow with a FAKE MICROPHONE — record, send, reload, play — because a
 * hand-made blob would never have exposed either bug.
 *
 * Needs Chromium's fake media flags (set below) and TOK.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
           '--autoplay-policy=no-user-gesture-required'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, permissions: ['microphone'] })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => localStorage.setItem('atwe_token', t), process.env.TOK);
  await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
    if (s && typeof introDismiss === 'function') introDismiss(); });
  await p.waitForTimeout(400);
  await p.locator('#acListScreen .ac-item').first().click();
  await p.waitForTimeout(2500);

  /* The guard itself: a container that says mp4 but carries Opus must NOT pass. */
  const guard = await p.evaluate(() => ({
    opusInMp4: _vnUniversal('audio/mp4;codecs=opus'),
    webm: _vnUniversal('audio/webm;codecs=opus'),
    safariAac: _vnUniversal('audio/mp4'),
    wav: _vnUniversal('audio/wav'),
    unknown: _vnUniversal('audio/weird'),
  }));
  say(guard.opusInMp4 === false, 'Opus inside an MP4 is NOT treated as universal');
  say(guard.webm === false, 'WebM/Opus is not treated as universal');
  say(guard.safariAac === true, "Safari's own audio/mp4 (real AAC) passes through");
  say(guard.wav === true, 'WAV passes through');
  say(guard.unknown === false, 'an unknown type converts rather than gambling');

  /* The real flow. */
  await p.evaluate(() => acVoiceStart(false));
  await p.waitForTimeout(2400);
  const att = await p.evaluate(async () => {
    if (window.acRec && acRec.state !== 'inactive') acRec.stop();
    await new Promise(r => setTimeout(r, 1800));
    const a = AC.att;
    return a ? { kind: a.kind, dur: a.durationSec, head: String(a.data).slice(0, 26) } : null;
  });
  say(!!att, `a recording attaches (${att ? att.head : 'nothing attached'})`);
  if (att) say(/^data:audio\/(wav|mp4)[;,]/.test(att.head) && !/opus/.test(att.head),
    'it is sent in a format an iPhone can decode');

  await p.evaluate(() => acSend());
  await p.waitForTimeout(3500);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.locator('#acListScreen .ac-item').first().click().catch(() => {});
  await p.waitForTimeout(3000);

  const play = await p.evaluate(async () => {
    const els = [...document.querySelectorAll('#acThread .msg-voice')];
    const vn = els[els.length - 1]; if (!vn) return null;
    const audio = vn.querySelector('.vn-audio');
    vn.querySelector('.vn-play').click();
    await new Promise(r => setTimeout(r, 1600));
    return { err: audio.error ? audio.error.code : null, t: +audio.currentTime.toFixed(2), paused: audio.paused };
  });
  say(play && !play.err && play.t > 0.2 && !play.paused,
    `it actually plays after a reload (${JSON.stringify(play)})`);
  say(errs.length === 0, `no JS errors${errs.length ? ' — ' + errs[0] : ''}`);

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nrecord -> send -> reload -> play works, in a format iOS can decode');
  process.exit(bad ? 1 : 0);
})();
