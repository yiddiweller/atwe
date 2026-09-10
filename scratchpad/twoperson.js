/* THE PATHS THAT NEED A SECOND PERSON, OR REAL MONEY.
 *
 * Every probe in this repo drives ONE browser as ONE account. That is most of the app
 * and it is not the part that matters most: a sale has a seller, a call has someone to
 * answer it, a photo is posted so that SOMEBODY ELSE can see it. Those are exactly the
 * paths where "it worked for me" and "it worked for them" can quietly diverge, and none
 * of them had a guard.
 *
 * So this seeds TWO real accounts and, where it matters, opens TWO real browsers.
 *
 *   1. A REAL SALE, BOTH SIDES. A lists, B buys with real wallet money, A ships it,
 *      B's OPEN browser learns it shipped without reloading, B marks it delivered.
 *      The pennies are conserved across all three parties (buyer, seller, Atwe's cut).
 *   2. ESCROW, BOTH SIDES. A protected buy must NOT pay the seller yet — that is the
 *      whole promise — and the buyer's confirm is what releases it.
 *   3. A REAL MESSAGE. A DM from A lands in B's live stream, not on a reload, and the
 *      order card really is in the thread for both of them.
 *   4. A REAL CALL. A rings B; B's stream receives the ring; B answers; A receives the
 *      answer. Two real browser contexts negotiate a real RTCPeerConnection and reach
 *      'connected' with the other side's track present. Plus the silenced-caller case,
 *      which is a promise made to the callee about a stranger.
 *   5. A REAL UPLOAD. A photo posted by A that B's browser can actually FETCH. Media is
 *      served by signed URL rather than inlined, so "the poster can see it" says nothing
 *      about whether anyone else can.
 *
 * SELF-TESTED THREE WAYS, and one of them found a check that was passing on broken code:
 *   · revert canContact/dmAllowed to the one-way block query → "the block holds in the
 *     other direction too" fails by name. That was a REAL fault this probe found: the
 *     blocker could keep messaging AND calling the person they had blocked.
 *   · comment out `rtPush(buyerId, 'order', { shipped: true })` in markOrderShipped →
 *     "the buyer's open tab is told, live" fails. IT DID NOT, at first: the check waited
 *     for any `order` event, and the BUY had already pushed one. Matching the event
 *     rather than its type is what makes it real.
 *   · break the two-browser negotiation and 4b goes red on "the two really connect".
 */
const { chromium } = require('playwright-core');
const path = require('path');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
const ROOT = path.join(__dirname, '..');

let pass = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fails.push(m + (x !== undefined ? ' :: ' + x : '')); console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };
const head = (s) => console.log('\n' + s);

const req = async (tok, method, p, body) => {
  const r = await fetch(BASE + p, { method,
    headers: Object.assign(tok ? { Authorization: 'Bearer ' + tok } : {}, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j || {} };
};

/* ── Two accounts of its own ────────────────────────────────────────────────
   Seeded straight into the database for the same reason lastseen.js does it: a probe
   that depends on somebody having exported a token will one day run against nothing
   and report that as a bug in the app. */
const crypto = require('crypto');
let pool, auth;
async function seed(name, extra) {
  const email = crypto.randomUUID().slice(0, 8) + '@t.local';
  const h = 'tp' + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
  const { rows } = await pool.query(`INSERT INTO users
    (name,email,password_hash,username,email_verified,onboarded,last_seen,balance_cents,account_type)
    VALUES ($4,$1,$2,$3,true,true,now(),$5,$6) RETURNING id`,
    [email, PWHASH, h, name, (extra && extra.balance) || 0, (extra && extra.biz) ? 'business' : 'personal']);
  const id = rows[0].id;
  const tok = auth.signToken({ id, email, is_admin: false });
  await pool.query(`INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'twoperson','1.1.1.1')`,
    [crypto.createHash('sha256').update(tok).digest('hex'), id]);
  return { id, tok, username: h, email };
}
let PWHASH = null;

const bal = async (id) => (await pool.query('SELECT balance_cents FROM users WHERE id=$1', [id])).rows[0].balance_cents;
const revenue = async () => (await pool.query('SELECT COALESCE(SUM(amount_cents),0)::int n FROM company_revenue')).rows[0].n;
const escrowHeld = async () => (await pool.query(
  `SELECT COALESCE(SUM(CASE WHEN kind='escrow_hold' THEN -delta_cents ELSE 0 END),0)::int
        - COALESCE(SUM(CASE WHEN kind IN ('escrow_release','escrow_refund') THEN delta_cents ELSE 0 END),0)::int AS n
     FROM wallet_tx`)).rows[0].n;

/* A live SSE stream, read from Node — the same wire an open browser tab is on.
   Returns a handle you can await events from. */
function openStream(streamTok) {
  const events = [];
  const waiters = [];
  const ctl = new AbortController();
  const done = fetch(BASE + '/api/rt/stream?token=' + encodeURIComponent(streamTok), { signal: ctl.signal })
    .then(async (r) => {
      const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done: d } = await rd.read(); if (d) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /(?:^|\n)event: (.+)/.exec(chunk); const da = /(?:^|\n)data: (.+)/.exec(chunk);
          if (!ev) continue;
          let parsed = null; try { parsed = da ? JSON.parse(da[1]) : null; } catch (_) {}
          const rec = { type: ev[1], data: parsed };
          events.push(rec);
          for (const w of waiters.slice()) if (w.match(rec)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(rec); }
        }
      }
    }).catch(() => {});
  return {
    events,
    close: () => { ctl.abort(); return done; },
    /* wait for the next event matching a predicate — checking what has ALREADY
       arrived first, or a fast server races the listener and the wait times out on
       an event that did land. */
    wait(match, ms = 6000) {
      const hit = events.find(match);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve) => {
        const w = { match, resolve };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, ms);
      });
    },
  };
}
const streamTok = async (tok) => (await req(tok, 'GET', '/api/rt/token')).body.token;

/* ═══ 1. A REAL SALE, BOTH SIDES ═══════════════════════════════════════════ */
async function sale(A, B) {
  head('1. a real sale, both sides');
  const pr = await req(A.tok, 'POST', '/api/products',
    { name: 'Two-person test widget', priceCents: 2500, kind: 'physical', shipFree: true, stock: 5 });
  ok(pr.status === 201 || pr.status === 200, 'the seller can list something', pr.status + ' ' + (pr.body.error || ''));
  const pid = pr.body.product && pr.body.product.id;
  if (!pid) return;

  const ad = await req(B.tok, 'POST', '/api/addresses',
    { fullName: 'TP Buyer', line1: '1 Test Street', city: 'Testville', region: 'CA', postal: '90000', country: 'US' });
  ok(ad.status === 201, 'the buyer can save somewhere to ship it', ad.status + ' ' + (ad.body.error || ''));
  const addrId = ad.body.address && ad.body.address.id;

  const b0 = await bal(B.id), s0 = await bal(A.id), r0 = await revenue();
  const stream = openStream(await streamTok(B.tok));       // the buyer's OPEN tab
  const sstream = openStream(await streamTok(A.tok));      // the seller's
  await new Promise((r) => setTimeout(r, 400));

  const buy = await req(B.tok, 'POST', '/api/orders/buy',
    { productId: pid, qty: 1, payWith: 'balance', addressId: addrId, clientId: 'tp-' + crypto.randomUUID() });
  ok(buy.status === 200 && buy.body.paid, 'the buyer can buy it with real wallet money',
    buy.status + ' ' + JSON.stringify(buy.body).slice(0, 120));
  const oid = buy.body.orderId;

  /* THE PENNIES. The only rule that matters is that money is never created: what left
     the buyer must equal what reached the seller plus what Atwe took.

     ATWE'S OWN CUT IS TAKEN FIRE-AND-FORGET — `chargePlatformFee(...).catch(...)`, not
     awaited — so the route answers BEFORE the fee has left the seller's balance. Read
     the three numbers the instant it returns and they are 2500 out, 2475 in and nothing
     for Atwe: 25 cents apparently vaporised, on a perfectly working sale. That is the
     first thing this probe reported, and it was the probe. Settle for it. */
  const settled = async () => {
    for (let i = 0; i < 40; i++) {
      const b = await bal(B.id), s = await bal(A.id), r = await revenue();
      if ((s - s0) + (r - r0) === (b0 - b)) return { b, s, r };
      await new Promise((x) => setTimeout(x, 50));
    }
    return { b: await bal(B.id), s: await bal(A.id), r: await revenue() };
  };
  const sv = await settled();
  const b1 = sv.b, s1 = sv.s, r1 = sv.r;
  const paid = b0 - b1, got = s1 - s0, fee = r1 - r0;
  ok(paid === 2500, 'exactly the price left the buyer', paid);
  ok(got + fee === paid, 'and every penny of it is accounted for', `seller +${got} · Atwe +${fee} · buyer -${paid}`);
  ok(got > 0, 'the seller was actually paid', got);

  /* THE SECOND PERSON'S HALF — the seller's Orders screen. */
  const sOrders = await req(A.tok, 'GET', '/api/orders?scope=seller');
  ok(sOrders.body.orders && sOrders.body.orders.some((o) => o.id === oid), 'it is on the seller’s Orders screen');
  const bOrders = await req(B.tok, 'GET', '/api/orders?scope=buyer');
  ok(bOrders.body.orders && bOrders.body.orders.some((o) => o.id === oid), 'and on the buyer’s');
  ok((await req(A.tok, 'GET', '/api/orders?scope=buyer')).body.orders.every((o) => o.id !== oid),
    'the seller does not see their own sale as a purchase');

  /* THE SELLER ACTS, AND THE BUYER'S OPEN TAB LEARNS ABOUT IT.
     This is the thing one browser can never test: an order screen that only updates on
     a reload is a different product from one that updates while you watch. */
  const ship = await req(A.tok, 'POST', '/api/orders/' + oid + '/ship', { carrier: 'USPS', tracking: 'TP123456789' });
  ok(ship.status === 200, 'the seller can mark it shipped', ship.status + ' ' + (ship.body.error || ''));
  /* MATCH THE SHIP EVENT ITSELF, NOT "an order event".
     `wait` deliberately checks what has ALREADY arrived (a fast server beats a
     listener), and the BUY pushed an `order` event of its own moments earlier — so a
     bare `e.type === 'order'` was satisfied by that one and passed with the ship push
     commented out. Proved by doing exactly that. */
  const shipEv = await stream.wait((e) => e.type === 'order' && e.data && e.data.shipped === true);
  ok(!!shipEv, 'the buyer’s open tab is told, live, without reloading',
    stream.events.filter((e) => e.type === 'order').length + ' order events, none of them the ship');
  const bOrd = (await req(B.tok, 'GET', '/api/orders/' + oid)).body.order || {};
  ok(bOrd.tracking === 'TP123456789' && bOrd.carrier === 'USPS', 'and the tracking number really reached them', bOrd.tracking);

  const del = await req(B.tok, 'POST', '/api/orders/' + oid + '/deliver');
  ok(del.status === 200 && del.body.delivered, 'the buyer can say it arrived', JSON.stringify(del.body).slice(0, 80));
  ok(!!(await sstream.wait((e) => e.type === 'order' && e.data && e.data.delivered === true)),
    'and the seller’s open tab is told, live');

  /* The order card in the conversation — a sale opens a thread between two strangers. */
  const th = await req(B.tok, 'GET', '/api/atchat/with/' + A.id);
  const cards = (th.body.messages || []).filter((m) => m.meta && m.meta.t === 'order');
  ok(cards.length >= 1, 'the order card is in the buyer’s conversation with the seller', (th.body.messages || []).length + ' msgs');
  const thA = await req(A.tok, 'GET', '/api/atchat/with/' + B.id);
  ok((thA.body.messages || []).some((m) => m.meta && m.meta.t === 'order'), 'and in the seller’s side of the same conversation');

  await stream.close(); await sstream.close();
  return { pid, oid, addrId };
}

/* ═══ 2. ESCROW, BOTH SIDES ════════════════════════════════════════════════
   Buyer protection is a promise made to two people at once: the buyer's money leaves
   them and the seller does NOT get it — that gap is the entire product. A one-browser
   test can watch the money leave and call it a pass. */
async function escrow(A, B, pid, addrId) {
  head('2. buyer protection — the money is HELD, not paid');
  const b0 = await bal(B.id), s0 = await bal(A.id), h0 = await escrowHeld();
  const sstream = openStream(await streamTok(A.tok));
  await new Promise((r) => setTimeout(r, 300));

  const buy = await req(B.tok, 'POST', '/api/orders/buy',
    { productId: pid, qty: 1, payWith: 'balance', protected: true, addressId: addrId, clientId: 'tpe-' + crypto.randomUUID() });
  ok(buy.status === 200 && buy.body.escrow, 'the buyer can buy with protection', JSON.stringify(buy.body).slice(0, 110));
  const oid = buy.body.orderId;
  if (!oid) { await sstream.close(); return; }

  const bHeld = b0 - (await bal(B.id));
  ok(bHeld === 2500, 'the money left the buyer', bHeld);
  ok((await bal(A.id)) === s0, 'AND THE SELLER HAS NOT BEEN PAID — the whole promise', (await bal(A.id)) - s0);
  ok((await escrowHeld()) - h0 === 2500, 'it is being held', (await escrowHeld()) - h0);
  ok(!!(await sstream.wait((e) => e.type === 'order' || e.type === 'notif')), 'the seller is told there is a sale to fulfil');

  const cancel = await req(B.tok, 'POST', '/api/orders/' + oid + '/cancel');
  ok(cancel.status >= 400, 'a protected order cannot simply be cancelled out from under it', cancel.status);

  const conf = await req(B.tok, 'POST', '/api/orders/' + oid + '/confirm');
  ok(conf.status === 200 && conf.body.status === 'released', 'the buyer confirming is what releases it',
    conf.status + ' ' + JSON.stringify(conf.body).slice(0, 80));
  /* same fire-and-forget fee, same settle */
  let paid = 0, fee0 = await revenue(), fee = 0;
  for (let i = 0; i < 40; i++) {
    paid = (await bal(A.id)) - s0; fee = (await revenue()) - fee0;
    if (paid + fee === 2500 - 0 && paid > 0) break;
    await new Promise((x) => setTimeout(x, 50));
  }
  ok(paid > 0, 'and only then is the seller paid', paid);
  ok((await escrowHeld()) - h0 === 0, 'nothing is left held', (await escrowHeld()) - h0);
  const after = await req(B.tok, 'GET', '/api/orders/' + oid);
  ok((after.body.order || {}).status === 'released', 'the order says released on the buyer’s side', (after.body.order || {}).status);

  /* And the other exit: a dispute reaches the person on the other side of it. */
  const buy2 = await req(B.tok, 'POST', '/api/orders/buy',
    { productId: pid, qty: 1, payWith: 'balance', protected: true, addressId: addrId, clientId: 'tpd-' + crypto.randomUUID() });
  const oid2 = buy2.body.orderId;
  const dis = await req(B.tok, 'POST', '/api/orders/' + oid2 + '/dispute', { reason: 'It never turned up.' });
  ok(dis.status === 200, 'the buyer can open a dispute on a held order', dis.status + ' ' + (dis.body.error || ''));
  ok(!!(await sstream.wait((e) => e.type === 'order' && e.data && e.data.status === 'disputed')),
    'and the SELLER’s open tab hears about it — a dispute nobody is told about is not a dispute');
  const sSee = await req(A.tok, 'GET', '/api/orders/' + oid2);
  ok((sSee.body.order || {}).status === 'disputed', 'the seller’s own order says disputed', (sSee.body.order || {}).status);
  ok((await escrowHeld()) - h0 === 2500, 'the disputed money stays held while it is argued about', (await escrowHeld()) - h0);
  await sstream.close();
}

/* A real photo, big enough to be served by URL. Media under 2KB deliberately stays
   inline, so a tiny test image would test the branch that ISN'T the interesting one. */
function bigPhoto() {
  const zlib = require('zlib');
  const W = 120, H = 120;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0, o = 0; y < H; y++) { raw[o++] = 0;
    for (let x = 0; x < W; x++) { raw[o++] = (x * 7 + y) & 255; raw[o++] = (y * 5) & 255; raw[o++] = (x ^ y) & 255; } }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}
let _crcT = null;
function crc32(buf) {
  if (!_crcT) { _crcT = []; for (let n = 0; n < 256; n++) { let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; _crcT[n] = c; } }
  let c = 0xFFFFFFFF; for (const b of buf) c = _crcT[(c ^ b) & 255] ^ (c >>> 8); return c ^ 0xFFFFFFFF;
}

/* ═══ 3. A REAL MESSAGE, ARRIVING WHILE THEY WATCH ═════════════════════════ */
async function messaging(A, B) {
  head('3. a message reaches the other person, live');
  const bs = openStream(await streamTok(B.tok));
  const as = openStream(await streamTok(A.tok));
  await new Promise((r) => setTimeout(r, 300));

  const cid = 'tpm-' + crypto.randomUUID();
  const sent = await req(A.tok, 'POST', '/api/atchat/with/' + B.id, { body: 'Two-person hello', clientId: cid });
  ok(sent.status === 200 || sent.status === 201, 'one person can send the other a message', sent.status + ' ' + (sent.body.error || ''));
  const got = await bs.wait((e) => e.type === 'msg' && e.data && /Two-person hello/.test(JSON.stringify(e.data)));
  ok(!!got, 'and it lands in their open app without a reload');

  /* Idempotency across two people: the SAME clientId must not deliver twice. */
  const again = await req(A.tok, 'POST', '/api/atchat/with/' + B.id, { body: 'Two-person hello', clientId: cid });
  const th = await req(B.tok, 'GET', '/api/atchat/with/' + A.id);
  const dupes = (th.body.messages || []).filter((m) => m.body === 'Two-person hello').length;
  ok(dupes === 1, 'a retry of the same send does not deliver it twice', dupes + ' copies');

  await req(A.tok, 'POST', '/api/rt/typing', { to: B.id, typing: true });
  ok(!!(await bs.wait((e) => e.type === 'typing')), 'they can see the other person typing');

  await req(B.tok, 'POST', '/api/atchat/with/' + A.id + '/read');
  ok(!!(await as.wait((e) => e.type === 'read')), 'and the sender is told when it was read');

  /* A BLOCK IS A PROMISE MADE TO ONE PERSON ABOUT ANOTHER, so it can only be tested
     with two. It has to hold in BOTH directions. */
  await req(B.tok, 'POST', '/api/social/block/' + A.id).catch(() => {});
  const blocked = await req(A.tok, 'POST', '/api/atchat/with/' + B.id, { body: 'still here', clientId: 'tpb-' + crypto.randomUUID() });
  ok(blocked.status >= 400, 'once blocked, the other person cannot message them', blocked.status);
  const back = await req(B.tok, 'POST', '/api/atchat/with/' + A.id, { body: 'nor the other way', clientId: 'tpb2-' + crypto.randomUUID() });
  ok(back.status >= 400, 'and the block holds in the other direction too', back.status);
  await req(B.tok, 'DELETE', '/api/social/block/' + A.id).catch(() => {});
  const unb = await req(A.tok, 'POST', '/api/atchat/with/' + B.id, { body: 'unblocked', clientId: 'tpu-' + crypto.randomUUID() });
  ok(unb.status === 200 || unb.status === 201, 'unblocking really lets them talk again', unb.status);

  await bs.close(); await as.close();
}

/* ═══ 5. A REAL UPLOAD THE OTHER PERSON CAN ACTUALLY SEE ═══════════════════
   Media is stored as a data URL and served to readers as a SIGNED URL — the whole
   iOS-memory design. That means the poster's own copy proves nothing: what matters is
   whether the address a second person is handed returns the bytes. */
async function upload(A, B) {
  head('5. a real photo, and the other person can fetch it');
  const photo = bigPhoto();
  ok(photo.length > 4000, 'the test photo is past the inline-it-anyway threshold', photo.length + ' chars');
  const post = await req(A.tok, 'POST', '/api/social/posts', { body: 'two-person photo', image: photo });
  ok(post.status === 201 || post.status === 200, 'one person can post a photo', post.status + ' ' + (post.body.error || ''));
  const pid = post.body.post && post.body.post.id;
  if (!pid) return;

  const seen = await req(B.tok, 'GET', '/api/social/posts/' + pid);
  const img = seen.body.post && seen.body.post.image;
  ok(typeof img === 'string' && img.startsWith('/api/media/'),
    'the OTHER person is handed a URL, not the bytes inline', String(img).slice(0, 40));
  const r = await fetch(BASE + img);
  const buf = Buffer.from(await r.arrayBuffer());
  ok(r.status === 200, 'and that URL answers', r.status);
  ok(buf.length > 3000 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG',
    'with a real picture at the end of it', r.headers.get('content-type') + ' ' + buf.length + 'B');
  /* THE SIGNATURE IS NOT AT THE END OF THE STRING — the URL carries a `?v=` cache
     stamp after it, so an anchored /[0-9a-f]{20}$/ matches nothing, "tampers" with
     nothing, and reports a 200 as a security hole. Target the path SEGMENT. */
  const tampered = img.replace(/\/[0-9a-f]{20}(?=$|\?)/, '/deadbeefdeadbeefdead');
  ok(tampered !== img, 'the tamper actually changed the signature');
  const tr = await fetch(BASE + tampered);
  ok(tr.status === 403, 'a made-up address is refused', tr.status + ' ' + tampered);

  /* THE SAME QUESTION IN A CONVERSATION, which is a different code path (mediaRefMsg,
     with its own known trap about single-image messages). */
  const dm = await req(A.tok, 'POST', '/api/atchat/with/' + B.id,
    { body: '', image: photo, clientId: 'tpi-' + crypto.randomUUID() });
  ok(dm.status === 200 || dm.status === 201, 'one person can send the other a photo', dm.status + ' ' + (dm.body.error || ''));
  const thread = await req(B.tok, 'GET', '/api/atchat/with/' + A.id);
  const m = (thread.body.messages || []).slice().reverse().find((x) => x.image);
  ok(m && String(m.image).startsWith('/api/media/'), 'the recipient is handed a URL for it too', m && String(m.image).slice(0, 40));
  if (m) {
    const rr = await fetch(BASE + m.image);
    const bb = Buffer.from(await rr.arrayBuffer());
    ok(rr.status === 200 && bb.length > 3000, 'and it really downloads for them', rr.status + ' ' + bb.length + 'B');
  }
}

/* ═══ 4. A REAL CALL ═══════════════════════════════════════════════════════
   Calling had NO probe at all — the note in CLAUDE.md saying a two-peer call reaches
   'connected' with the remote track present was true, and was done by hand, once.
   Two halves: the signalling (does it RING for the other person) and the media (do
   two real browsers actually negotiate a connection through it). */
async function calling(A, B) {
  head('4a. the call rings the other person');
  const bs = openStream(await streamTok(B.tok));
  const as = openStream(await streamTok(A.tok));
  await new Promise((r) => setTimeout(r, 300));
  const cid = 'tpc-' + crypto.randomUUID();

  const offer = await req(A.tok, 'POST', '/api/rt/call',
    { to: B.id, kind: 'offer', media: 'audio', callId: cid, sdp: JSON.stringify({ type: 'offer', sdp: 'v=0' }) });
  ok(offer.status === 200 && !offer.body.silenced, 'one person can ring the other', JSON.stringify(offer.body).slice(0, 80));
  const ring = await bs.wait((e) => e.type === 'call' && e.data && e.data.kind === 'offer');
  ok(!!ring, 'and the other person’s app actually rings');
  ok(ring && ring.data.from && ring.data.from.id === A.id, 'it says who is calling', ring && JSON.stringify(ring.data.from).slice(0, 60));

  const ans = await req(B.tok, 'POST', '/api/rt/call',
    { to: A.id, kind: 'answer', callId: cid, sdp: JSON.stringify({ type: 'answer', sdp: 'v=0' }) });
  ok(ans.status === 200, 'they can answer', ans.status);
  ok(!!(await as.wait((e) => e.type === 'call' && e.data && e.data.kind === 'answer')), 'and the caller hears the answer');
  await req(A.tok, 'POST', '/api/rt/call', { to: B.id, kind: 'ice', callId: cid, candidate: JSON.stringify({ candidate: 'x' }) });
  ok(!!(await bs.wait((e) => e.type === 'call' && e.data && e.data.kind === 'ice')), 'network details reach the other side');
  await req(B.tok, 'POST', '/api/rt/call', { to: A.id, kind: 'end', callId: cid });
  ok(!!(await as.wait((e) => e.type === 'call' && e.data && e.data.kind === 'end')), 'and hanging up reaches them too');

  /* SILENCE UNKNOWN CALLERS is a promise made to the callee about a STRANGER, so it
     needs a third account with no history. It must not ring — and must still leave a
     record, or a quiet call becomes a lost one. */
  const C = await seed('TP Stranger');
  await req(B.tok, 'PUT', '/api/account-privacy', { silenceUnknownCallers: true });
  const sil = await req(C.tok, 'POST', '/api/rt/call',
    { to: B.id, kind: 'offer', media: 'audio', callId: 'tps-' + crypto.randomUUID(), sdp: JSON.stringify({ type: 'offer', sdp: 'v=0' }) });
  ok(sil.status === 200 && sil.body.silenced === true, 'a stranger’s call is silenced when they asked for that',
    JSON.stringify(sil.body).slice(0, 80));
  ok(!(await bs.wait((e) => e.type === 'call' && e.data && e.data.kind === 'offer' && e.data.from && e.data.from.id === C.id, 1200)),
    'their phone genuinely does not ring');
  const logged = await pool.query("SELECT silenced FROM calls WHERE user_id = $1 AND peer_id = $2 ORDER BY id DESC LIMIT 1", [B.id, C.id]);
  ok(logged.rows[0] && logged.rows[0].silenced === true, 'but it is still in their Recent, marked Silenced');
  /* And the person they DO know still gets through with the setting on. */
  const known = await req(A.tok, 'POST', '/api/rt/call',
    { to: B.id, kind: 'offer', media: 'audio', callId: 'tpk-' + crypto.randomUUID(), sdp: JSON.stringify({ type: 'offer', sdp: 'v=0' }) });
  ok(known.status === 200 && !known.body.silenced, 'someone they have talked to before still rings through',
    JSON.stringify(known.body).slice(0, 80));
  await req(B.tok, 'PUT', '/api/account-privacy', { silenceUnknownCallers: false });
  await bs.close(); await as.close();
}

/* 4b. TWO REAL BROWSERS, ONE REAL CONNECTION.
   Everything above is the wire. This is the part that decides whether anybody can
   hear anybody: two Chromium contexts with fake microphones run the app's OWN
   startCall/callAccept through the app's OWN signalling, and have to reach
   'connected' with the other side's track really present. */
async function realCall(A, B) {
  head('4b. two real browsers reach a connected call');
  const br = await chromium.launch({ executablePath: EXE, args: [
    '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required'] });
  const mkPage = async (tok) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone', 'camera'] });
    const p = await ctx.newPage();
    await p.addInitScript((t) => { localStorage.setItem('atwe_token', t);
      localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, tok);
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4500);
    return p;
  };
  try {
    const pa = await mkPage(A.tok), pb = await mkPage(B.tok);
    /* The stream has to be live on both, or the ring goes nowhere.
       `rtSource` IS A TOP-LEVEL `let`, NOT a window property — the same trap `S` and
       `_caps` have already sprung in this repo. `window.rtSource` is undefined on a
       page whose stream is perfectly connected, which is what it reported first. */
    const up = async (p) => p.waitForFunction(() => typeof rtSource !== 'undefined' && rtSource && rtSource.readyState !== 2,
      null, { timeout: 10000 }).then(() => true).catch(() => false);
    const upA = await up(pa), upB = await up(pb);
    ok(upA && upB, 'both browsers are listening for live events', upA + '/' + upB);

    await pa.evaluate((id) => startCall('audio', { id, name: 'TP Buyer' }), B.id);
    const rang = await pb.waitForFunction(() => typeof CALL !== 'undefined' && CALL && CALL.state === 'incoming', null,
      { timeout: 15000 }).then(() => true).catch(() => false);
    ok(rang, 'the second browser really rings');
    if (!rang) { await br.close(); return; }
    ok(await pb.evaluate(() => !document.getElementById('callOverlay').classList.contains('hidden')).catch(() => false),
      'and shows the incoming-call screen');

    await pb.evaluate(() => callAccept());
    const connA = await pa.waitForFunction(() => CALL && CALL.pc && CALL.pc.connectionState === 'connected', null,
      { timeout: 25000 }).then(() => true).catch(() => false);
    const connB = await pb.waitForFunction(() => CALL && CALL.pc && CALL.pc.connectionState === 'connected', null,
      { timeout: 25000 }).then(() => true).catch(() => false);
    ok(connA && connB, 'the two really connect to each other', 'caller ' + connA + ' · callee ' + connB);

    const trackA = await pa.evaluate(() => !!(CALL && CALL.pc && CALL.pc.getReceivers().some((r) => r.track && r.track.readyState === 'live')));
    const trackB = await pb.evaluate(() => !!(CALL && CALL.pc && CALL.pc.getReceivers().some((r) => r.track && r.track.readyState === 'live')));
    ok(trackA && trackB, 'and each has the other person’s sound', 'caller ' + trackA + ' · callee ' + trackB);
    ok(await pa.evaluate(() => { const v = document.getElementById('callRemoteVid'); return !!(v && v.srcObject); }),
      'the caller’s player is actually fed the incoming stream');

    await pa.evaluate(() => callHangup());
    const goneB = await pb.waitForFunction(() => typeof CALL === 'undefined' || !CALL, null, { timeout: 12000 })
      .then(() => true).catch(() => false);
    ok(goneB, 'hanging up ends it for the other person too');
    /* The call screen SHRINKS AWAY over .36s (callCloseOverlay animates into the nav
       icon before hiding it), so reading `.hidden` in the same tick reports a screen
       that is on its way out as one that never left. */
    ok(await pa.waitForFunction(() => document.getElementById('callOverlay').classList.contains('hidden'),
      null, { timeout: 5000 }).then(() => true).catch(() => false), 'and the call screen is put away');
    await br.close();
  } catch (e) { ok(false, 'the two-browser call ran at all', String(e.message).slice(0, 130)); await br.close().catch(() => {}); }
}

(async () => {
  try { pool = new (require(path.join(ROOT, 'node_modules/pg')).Pool)({
      connectionString: process.env.DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore' });
    auth = require(path.join(ROOT, 'auth'));
    PWHASH = await auth.hashPassword('x'.repeat(12));
    await pool.query('SELECT 1');
  } catch (e) {
    console.log('  skipped — no database to seed against (' + String(e.message).slice(0, 70) + ')');
    process.exit(0);
  }
  const cfg = await req(null, 'GET', '/api/config');
  if (cfg.status !== 200) { console.log('  skipped — no server on ' + BASE); process.exit(0); }

  const A = await seed('TP Seller', { biz: true });          // sells
  const B = await seed('TP Buyer', { balance: 50000 });      // buys, $500
  console.log(`  (seller ${A.id} @${A.username} · buyer ${B.id} @${B.username})`);

  const sold = await sale(A, B);
  if (sold) await escrow(A, B, sold.pid, sold.addrId);
  await messaging(A, B);
  await upload(A, B);
  await calling(A, B);
  await realCall(A, B);

  await pool.end();
  console.log(`\n${pass} passed, ${fails.length} FAILED`);
  if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
})();
