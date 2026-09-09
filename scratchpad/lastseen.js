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
let A = process.env.TOK_A, B = process.env.TOK_B, C = process.env.TOK_C;
let IDA = +process.env.ID_A, IDB = +process.env.ID_B, IDC = +process.env.ID_C;

/* IT SEEDS ITS OWN THREE ACCOUNTS, and that is the whole reason it now runs at all.
   It used to demand TOK_A/TOK_B/TOK_C + ID_A/ID_B/ID_C from the environment and skip
   cleanly when they were absent — which they always were, because run-all.sh only ever
   exports the single shared TOK. So it printed "skipped", exited 0, and was counted as a
   pass for months: the feature it guards (hide my last seen from ONE person, reciprocally,
   at all three doors presence leaves by) had no working coverage at all.
   A skip that nobody can turn into a run is not a test — it is a note.
   The env vars still win if they are set, so an existing three-account setup is unchanged. */
async function seedThree() {
  const crypto = require('crypto');
  const { Pool } = require('/home/user/atwe/node_modules/pg');
  const auth = require('/home/user/atwe/auth');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL
    || 'postgres://atwe:atwe@localhost:5432/atwescore' });
  const hash = await auth.hashPassword('x'.repeat(12));
  const mk = async (n) => {
    const email = crypto.randomUUID().slice(0, 8) + '@t.local';
    const h = 'ls' + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
    /* users.last_seen must be STAMPED. The presence poll reports exactly that column, so
       a brand-new account honestly has nothing to show and every baseline check ("to begin
       with, A can see B's last seen") fails on a perfectly working feature — which is what
       the first run of this seeder did, 7 red on green code. */
    const { rows } = await pool.query(`INSERT INTO users
      (name,email,password_hash,username,email_verified,onboarded,last_seen)
      VALUES ($4,$1,$2,$3,true,true,now()) RETURNING id`, [email, hash, h, n]);
    const id = rows[0].id;
    const tok = auth.signToken({ id, email, is_admin: false });
    await pool.query(`INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip)
      VALUES ($1,$2,'lastseen','1.1.1.1')`,
      [crypto.createHash('sha256').update(tok).digest('hex'), id]);
    return { id, tok };
  };
  const a = await mk('LS A'), b = await mk('LS B'), c = await mk('LS C');
  /* presence is only reported for people you can plausibly see — give each pair a real
     DM so the poll has a reason to answer about them at all */
  for (const [x, y] of [[a, b], [a, c], [b, c]])
    await pool.query(`INSERT INTO at_messages (sender_id,recipient_id,body) VALUES ($1,$2,'hi'),($2,$1,'hi')`,
      [x.id, y.id]);
  await pool.end();
  return { a, b, c };
}

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
  if (!A || !B || !C) {
    try {
      const s = await seedThree();
      A = s.a.tok; B = s.b.tok; C = s.c.tok;
      IDA = s.a.id; IDB = s.b.id; IDC = s.c.id;
      console.log('  (seeded three accounts of its own: ' + IDA + ' / ' + IDB + ' / ' + IDC + ')');
    } catch (e) {
      /* no database reachable — skip rather than fail, the way npm test no-ops. This is
         now the ONLY reason it can skip, and it says which one it is. */
      console.log('  skipped — no database to seed against (' + String(e.message).slice(0, 80) + ')');
      process.exit(0);
    }
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
