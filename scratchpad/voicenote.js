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
  await p.locator('#acListScreen .ac-item[data-uid]').first().click();
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
  await p.locator('#acListScreen .ac-item[data-uid]').first().click().catch(() => {});
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
  /* THE THREE FAILURE SCENARIOS EACH GET THEIR OWN FRESH NOTE, and that is the whole
     repair. They used to mutate the LIVE note in the thread and re-run the binder on
     it, which broke them in two different ways:

       • the note had just been PLAYED, so the previous binding's rAF clock was still
         running on the same element — and the moment markDead wrote "Can't play" that
         clock painted "0:00" straight back over it. Measured: class vn-dead correctly
         added, label "0:00". The product was right; the probe was reading a label two
         bindings were fighting over.
       • the network scenario took `all[1] || all[0]`, i.e. the SAME note the previous
         scenario had just poisoned when the thread holds only one. Its audio.error was
         already 4, so re-binding re-marked it dead and the synthetic error event proved
         nothing. How many notes the thread happens to hold depends on how many times
         this probe has run before, which is why it passed in some runs and not others.

     So: take a PRISTINE clone before anything is touched, and stamp a fresh copy for
     each scenario into an off-screen lab. A fresh element carries no old closure, and
     the live note is never disturbed. */
  const lab = await p.evaluate(() => {
    const live = [...document.querySelectorAll('#acThread .msg-voice')].pop();
    if (!live) return false;
    const host = document.createElement('div');
    host.id = 'vnLab';
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:300px;';
    document.body.appendChild(host);
    window.__vnProto = live.cloneNode(true);   // pristine: nothing has mutated it yet
    return true;
  });

  /* A note this device CANNOT DECODE must say so on its own, before anyone taps it.
     Notes recorded before the conversion shipped are Opus, and an iPhone has no Opus
     decoder at all — they cannot be rescued on the device, so the only honest thing is
     to stop them looking identical to a working note (a play button and 0:00, which is
     what "some voice notes still don't work" felt like). */
  const dead = !lab ? { skip: true } : await p.evaluate(async () => {
    const host = document.getElementById('vnLab');
    const vn = window.__vnProto.cloneNode(true); host.appendChild(vn);
    const a = vn.querySelector('.vn-audio');
    a.src = 'data:audio/webm;base64,' + btoa('not actually audio at all');
    a.dataset.dur = '';
    _bindVoiceNotes(host);
    a.load();
    await new Promise(r => setTimeout(r, 1400));
    return { dead: vn.classList.contains('vn-dead'), label: vn.querySelector('.vn-time').textContent,
             code: a.error && a.error.code };
  });
  say(dead.skip || dead.dead, `an undecodable note marks itself unplayable on load (error ${dead.code})`);
  say(dead.skip || /can.t play/i.test(dead.label), `and says so instead of showing 0:00 ("${dead.label}")`);

  const toast = !lab ? null : await p.evaluate(async () => {
    document.querySelectorAll('.notif').forEach(n => n.remove());
    const btn = document.querySelector('#vnLab .msg-voice.vn-dead .vn-play'); if (!btn) return null;
    btn.click();
    await new Promise(r => setTimeout(r, 400));
    const n = document.querySelector('.notif');
    return n ? n.textContent.trim() : null;
  });
  say(!!toast && /format/i.test(toast), 'tapping it explains why, rather than doing nothing');

  /* …but a NETWORK error is a flaky connection, not a broken file, and must stay
     retryable. Only MEDIA_ERR_SRC_NOT_SUPPORTED / DECODE may mark a note dead. */
  const net = !lab ? { skip: true } : await p.evaluate(async () => {
    const host = document.getElementById('vnLab');
    const vn = window.__vnProto.cloneNode(true); host.appendChild(vn);
    _bindVoiceNotes(host);
    await new Promise(r => setTimeout(r, 900));
    const a = vn.querySelector('.vn-audio');
    // The premise: this note is FINE. If it already carries a decode error the check
    // would be measuring the previous scenario, not a network blip.
    const preErr = a.error && a.error.code;
    a.dispatchEvent(new Event('error'));                // no audio.error set
    return { preErr, dead: vn.classList.contains('vn-dead') };
  });
  say(net.skip || net.preErr == null, `the network scenario starts from a HEALTHY note (error ${net.preErr === undefined ? '-' : net.preErr})`);
  say(net.skip || net.dead === false, 'a network error leaves the note retryable — only an undecodable file is marked dead');

  say(errs.length === 0, `no JS errors${errs.length ? ' — ' + errs[0] : ''}`);

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nrecord -> send -> reload -> play works, in a format iOS can decode');
  process.exit(bad ? 1 : 0);
})();
