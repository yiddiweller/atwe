/* HIDE MY LAST SEEN FROM ONE PERSON.
 *
 * The owner's idea: the global "Active status" setting is all-or-nothing, so hiding from
 * one awkward person means disappearing from everybody. This is the per-conversation
 * exception, set from that chat's ⋯ menu.
 *
 * It is RECIPROCAL by the owner's decision — hiding from someone hides them from you too —
 * so the checks below are all in PAIRS. What they are really guarding is that presence is
 * withheld at every door it can leave by, and that a third person is never affected: a
 * privacy setting that only works on one of three surfaces is worse than none, because the
 * member believes they are hidden.
 *
 * Pure HTTP: presence has three server-side gates and the point is to prove the wire, not
 * the pixels. The menu row and the manage list are covered by the browser pass below it.
 */
const BASE = process.env.BASE || 'http://localhost:3262';
const A = process.env.TOK_A, B = process.env.TOK_B, C = process.env.TOK_C;
const IDA = +process.env.ID_A, IDB = +process.env.ID_B, IDC = +process.env.ID_C;

let bad = 0;
const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };
const req = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method,
    headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
};
/* "Can this token see that person's last seen?" — the poll withholds it by returning a
   null last_seen and offline, rather than by omitting the key. */
const sees = async (tok, id) => {
  const r = await req(tok, 'GET', '/api/atchat/presence?ids=' + id);
  const p = r.body && r.body.presence && r.body.presence[id];
  return !!(p && p.last_seen);
};

(async () => {
  /* Needs THREE accounts, so it skips cleanly rather than failing the suite when only the
     usual single TOK is exported — the same way npm test no-ops without a database. */
  if (!A || !B || !C) {
    console.log('  skipped — needs three accounts: export TOK_A/TOK_B/TOK_C and ID_A/ID_B/ID_C');
    process.exit(0);
  }
  await req(A, 'DELETE', '/api/atchat/presence-hidden/' + IDB);   // start clean
  await req(A, 'DELETE', '/api/atchat/presence-hidden/' + IDC);

  /* 1. Baseline — everybody can see everybody. */
  say(await sees(A, IDB), 'to begin with, A can see B’s last seen');
  say(await sees(B, IDA), 'and B can see A’s');
  say(await sees(A, IDC), 'and A can see C’s');

  /* 2. A hides from B, from that one conversation. */
  const on = await req(A, 'POST', '/api/atchat/presence-hidden/' + IDB);
  say(on.status === 200 && on.body.hidden === true, 'A hides their last seen from B');
  say(!(await sees(B, IDA)), 'B can no longer see A’s last seen — which is the whole point');
  say(!(await sees(A, IDB)), 'and it goes BOTH ways: A can no longer see B’s either');

  /* 3. …and nobody else is touched. This is the half that makes it worth building at all:
        the global setting already hides you from everyone. */
  say(await sees(A, IDC), 'C is unaffected — A still sees C');
  say(await sees(C, IDA), 'and C still sees A');
  say(await sees(B, IDC) && await sees(C, IDB), 'B and C still see each other');

  /* 4. The conversation knows, so the ⋯ menu can show a tick. */
  const th = await req(A, 'GET', '/api/atchat/with/' + IDB);
  say(th.body && th.body.presenceHidden === true, 'A’s chat with B reports it hidden, so the menu can tick it');
  const th2 = await req(A, 'GET', '/api/atchat/with/' + IDC);
  say(th2.body && th2.body.presenceHidden === false, 'A’s chat with C reports it is not');

  /* 5. IT MUST NOT LEAK. B is never told that A hid from them — that would hand back the
        exact fact the setting exists to conceal, and it is the one way this feature could
        do real harm. */
  const bList = await req(B, 'GET', '/api/atchat/presence-hidden');
  say(bList.status === 200 && !(bList.body.people || []).some((u) => u.id === IDA),
    'B is NEVER told that A hid from them');
  const bTh = await req(B, 'GET', '/api/atchat/with/' + IDA);
  say(bTh.body && bTh.body.presenceHidden === false,
    'and B’s own chat with A reports only B’s own choice, not A’s');

  /* 6. It can always be found and undone, even if the conversation is gone. */
  const aList = await req(A, 'GET', '/api/atchat/presence-hidden');
  say((aList.body.people || []).some((u) => u.id === IDB), 'A’s "Hidden from" list has B in it');

  /* 7. Undo puts everything back. */
  const off = await req(A, 'DELETE', '/api/atchat/presence-hidden/' + IDB);
  say(off.status === 200, 'A shows their last seen to B again');
  say(await sees(B, IDA) && await sees(A, IDB), 'and both sides can see each other again');

  /* 8. Guards. */
  const self = await req(A, 'POST', '/api/atchat/presence-hidden/' + IDA);
  say(self.status === 400, 'you cannot hide from yourself');
  const ghost = await req(A, 'POST', '/api/atchat/presence-hidden/99999999');
  say(ghost.status === 404, 'and not from an account that does not exist');
  const twice = await req(A, 'POST', '/api/atchat/presence-hidden/' + IDB);
  const again = await req(A, 'POST', '/api/atchat/presence-hidden/' + IDB);
  say(twice.status === 200 && again.status === 200, 'hiding twice is harmless (a double tap must not error)');
  await req(A, 'DELETE', '/api/atchat/presence-hidden/' + IDB);
  const undoTwice = await req(A, 'DELETE', '/api/atchat/presence-hidden/' + IDB);
  say(undoTwice.status === 200, 'and so is unhiding twice');

  /* 9. THE LIVE PUSH, which is the door that actually leaks in real time. The poll passing
        proves nothing about it: presence also goes out over the SSE stream the moment
        someone connects, and an earlier design that only filtered the poll would have shown
        B a green dot for A within a second of A opening the app. Both halves are checked —
        the `presence-init` snapshot handed out on connect, and the live `presence` event
        broadcast to everyone else. */
  const stream = async (tok, ms) => {
    const t = (await req(tok, 'GET', '/api/rt/token')).body.token;
    const ctrl = new AbortController();
    const res = await fetch(BASE + '/api/rt/stream?token=' + encodeURIComponent(t), { signal: ctrl.signal });
    const events = []; let buf = '';
    const reader = res.body.getReader(); const dec = new TextDecoder();
    (async () => { try {
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (chunk.match(/^event: (.+)$/m) || [])[1];
          const data = (chunk.match(/^data: (.+)$/m) || [])[1];
          if (ev) { try { events.push({ ev, data: JSON.parse(data) }); } catch { events.push({ ev, data: null }); } }
        } }
    } catch (_) {} })();
    await new Promise((r) => setTimeout(r, ms));
    return { events, stop: () => ctrl.abort() };
  };

  await req(A, 'POST', '/api/atchat/presence-hidden/' + IDB);
  const bStream = await stream(B, 700);            // B is listening…
  const cStream = await stream(C, 700);            // …and so is C, who must be unaffected
  const aStream = await stream(A, 1400);           // …then A comes online
  await new Promise((r) => setTimeout(r, 900));

  const gotA = (s) => s.events.some((e) => e.ev === 'presence' && e.data && e.data.userId === IDA);
  const initHasA = (s) => s.events.some((e) => e.ev === 'presence-init' && e.data && (e.data.online || []).includes(IDA));
  say(!gotA(bStream), 'while hidden, B is never pushed A’s presence live either');
  say(gotA(cStream), 'but C is — the block is per-person, not a broadcast being switched off');
  bStream.stop(); cStream.stop();
  /* The other half of the same door: A is ALREADY online, and B connects fresh. The
     snapshot handed out on connect must leave A out — A's stream is deliberately still
     open here, since closing it first would make C's snapshot empty too and the check
     would pass for the wrong reason (it did, on the first run). */
  const bLater = await stream(B, 900);
  const cLater = await stream(C, 900);
  say(!initHasA(bLater), 'and A is left out of the snapshot B is handed on connect');
  say(initHasA(cLater), 'while C’s snapshot still has A in it');
  bLater.stop(); cLater.stop(); aStream.stop();
  await req(A, 'DELETE', '/api/atchat/presence-hidden/' + IDB);

  console.log(bad ? `\n${bad} FAILED` : '\nhidden from one person, seen by everyone else — and it goes both ways');
  process.exit(bad ? 1 : 0);
})();
