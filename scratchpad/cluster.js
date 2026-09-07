/* CAN ATWE RUN ON MORE THAN ONE SERVER?
 *
 * This is the question behind "can it hold a million people". One machine can only
 * take so many; past that you run several copies behind a load balancer. But Atwe
 * keeps who-is-connected in ONE process's memory, so with two servers a message sent
 * by somebody on server A would never reach somebody connected to server B — the app
 * would look fine and quietly lose half its realtime.
 *
 * CLUSTER_MODE=true is the groundwork for that: Postgres LISTEN/NOTIFY carries events
 * between instances and a shared table carries the rate-limit counters, using the
 * database that is already there rather than adding Redis. It had NEVER BEEN RUN with
 * two servers. Written but unproven is not the same as working.
 *
 * So this starts two real servers against one database and checks the thing that
 * matters: a message sent through one arrives at somebody listening on the other.
 *
 * IT SELF-TESTS. The whole scenario runs twice — once with cluster mode ON and once
 * OFF — and the OFF run must FAIL to deliver. A probe that passes either way would be
 * proving nothing, which is exactly the trap an untested feature invites.
 *
 *   DATABASE_URL=... JWT_SECRET=scoresecret node cluster.js
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));

const DB = process.env.DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore';
const SECRET = process.env.JWT_SECRET || 'scoresecret';
/* auth.js reads JWT_SECRET once, AT REQUIRE TIME. Requiring it before this line means
   the probe mints tokens with the insecure dev fallback while the servers it spawns
   are told to use SECRET — every request then comes back 401 and the run reports "the
   message was never accepted" on code that is fine. Set it first, then require. */
process.env.JWT_SECRET = SECRET;
const auth = require(path.join(ROOT, 'auth'));
const PORT_A = 3281, PORT_B = 3282;

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(port, cluster) {
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: DB, JWT_SECRET: SECRET,
           CLUSTER_MODE: cluster ? 'true' : 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
  return p;
}
/* /api/health answers BEFORE db.init() has finished — it is deliberately exempt from
   the "still setting up" gate so a platform healthcheck passes during a schema build.
   So waiting on health alone is not waiting for a usable server: against a big
   database every request the probe then makes comes back 503 {starting:true} and the
   whole run reports "the message was never accepted" on perfectly good code. Wait for
   a route that is BEHIND the gate instead. */
async function waitUp(port, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/api/config`);
      if (r.ok) { const j = await r.json().catch(() => ({})); if (!j.starting) return true; }
    } catch (e) {}
    await sleep(500);
  }
  return false;
}

/* Open the realtime stream and collect the events that arrive on it. */
async function listen(port, token, got) {
  const t = await (await fetch(`http://localhost:${port}/api/rt/token`,
    { headers: { Authorization: 'Bearer ' + token } })).json();
  const res = await fetch(`http://localhost:${port}/api/rt/stream?token=${encodeURIComponent(t.token)}`,
    { headers: { Accept: 'text/event-stream' } });
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', ev = null;
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:') && ev) { got.push(ev); ev = null; }
        }
      }
    } catch (e) { /* the stream is torn down at the end of the run */ }
  })();
  return () => { try { reader.cancel(); } catch (e) {} };
}

async function scenario(cluster) {
  const label = cluster ? 'cluster ON ' : 'cluster OFF';
  const a = start(PORT_A, cluster), b = start(PORT_B, cluster);
  const upA = await waitUp(PORT_A), upB = await waitUp(PORT_B);
  if (!upA || !upB) { a.kill(); b.kill(); return { delivered: false, started: false }; }
  await sleep(2500);                        // let the LISTEN connection settle

  const pool = new Pool({ connectionString: DB });
  const mk = async () => {
    const email = crypto.randomUUID().slice(0, 8) + '@cl.local';
    const hash = await auth.hashPassword('x'.repeat(12));
    const h = 'cl' + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
    const { rows } = await pool.query(
      `INSERT INTO users (name,email,password_hash,username,email_verified,onboarded)
       VALUES ('C',$1,$2,$3,true,true) RETURNING id`, [email, hash, h]);
    const tk = auth.signToken({ id: rows[0].id, email, is_admin: false });
    await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
      [crypto.createHash('sha256').update(tk).digest('hex'), rows[0].id]);
    return { id: rows[0].id, token: tk };
  };
  const receiver = await mk(), sender = await mk();

  const got = [];
  const stop = await listen(PORT_A, receiver.token, got);   // listening on server A
  await sleep(1200);

  // ...and the message is sent through server B.
  const send = await fetch(`http://localhost:${PORT_B}/api/atchat/with/${receiver.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sender.token },
    body: JSON.stringify({ body: 'hello from the other server', clientId: crypto.randomUUID() }),
  });
  const sendOk = send.ok;
  await sleep(2500);
  stop();
  const delivered = got.includes('msg');
  const dupes = got.filter((e) => e === 'msg').length;

  await pool.end(); a.kill(); b.kill(); await sleep(1200);
  return { started: true, sendOk, delivered, dupes, label, events: got.slice(0, 6) };
}

(async () => {
  console.log('  two servers, one database — does a message cross between them?\n');
  const on = await scenario(true);
  console.log('    ' + on.label + ' →', JSON.stringify({ sent: on.sendOk, arrived: on.delivered, copies: on.dupes }));
  const off = await scenario(false);
  console.log('    ' + off.label + ' →', JSON.stringify({ sent: off.sendOk, arrived: off.delivered, copies: off.dupes }));
  console.log('');

  ok(on.started && off.started, 'two servers start against one database');
  ok(on.sendOk && off.sendOk, 'the message is accepted by the second server either way');
  ok(on.delivered === true,
     'with cluster mode ON, a message sent through one server reaches somebody listening on the other',
     JSON.stringify(on.events));
  ok(on.dupes === 1,
     'and it arrives exactly ONCE — an instance must not re-deliver its own broadcast',
     'copies=' + on.dupes);
  /* The self-test. If this passes too, the probe proves nothing. */
  ok(off.delivered === false,
     'with cluster mode OFF it does NOT arrive — so this probe can actually fail',
     'it was delivered without cluster mode, which means something else carried it');

  console.log(fail ? `\n${fail} FAILED` : '\nAtwe can run on more than one server');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
