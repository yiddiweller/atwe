/* The two fixture rules, checked mechanically, so neither can come back quietly.
 *
 * RULE 1 - ONE ADDRESS. Fifty-nine probes used to hardcode the development database's
 * connection string and ignore DATABASE_URL, so they seeded an account into one database
 * while the server they were driving ran against another. The token then resolved to no
 * session, the app booted signed out, and every gated surface measured empty - reported
 * in the language of a product bug. They only ever passed because whoever ran them
 * happened to have the server on that same address. The literal now lives in exactly one
 * place, qa-fixture.js, and everything else reads DATABASE_URL.
 *
 * RULE 2 - PROVE IT. Honouring DATABASE_URL is not the same as being on the right
 * database: a probe can read the variable and still be pointed somewhere the server is
 * not. So a probe that mints a session must ask the SERVER whether it can see it before
 * it measures anything. That one question is what turns a misconfiguration into a named
 * failure instead of a screenful of false reds.
 *
 * Deliberately a plain file scan: no framework, no parsing, nothing to maintain.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const HOME = 'qa-fixture.js';           // the one documented home of the fallback address
const LITERAL = require('./' + HOME).DEFAULT_DB;

/* A probe that runs its OWN server cannot ask the shared one about its session - it is
   not the server under test. Each of these waits for its own port and checks its own
   answers, so the question rule 2 asks is already answered locally. */
const OWN_SERVER = {
  'cluster.js':    'spawns two servers of its own on 3281/3282 and waits for both',
  'nodash.js':     'spawns its own server on a computed port with a scripted model behind it',
  'aiagent.js':    'spawns its own server on a computed port with a scripted model behind it',
  'mint-token.js': 'a command-line helper that prints a token for a human; there may be no server yet',
};

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '\n         ' + String(x).slice(0, 400) : '')); } };

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'qadsn.js')
  .filter((f) => fs.statSync(path.join(DIR, f)).isFile());
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

/* ── rule 1 ── */
const strays = files.filter((f) => f !== HOME && read(f).includes(LITERAL));
ok(strays.length === 0,
   'the database address is written in one place only (' + HOME + '), across ' + files.length + ' files',
   strays.length ? 'also in: ' + strays.join(', ') : undefined);

/* A connection string that is a LITERAL rather than a variable is the same defect wearing
   a different address - it cannot follow DATABASE_URL wherever it points. */
const literalConn = [];
for (const f of files) {
  if (f === HOME) continue;
  const m = read(f).match(/connectionString\s*:\s*['"`]([^'"`]+)['"`]/);
  if (m) literalConn.push(f + ' -> ' + m[1]);
}
ok(literalConn.length === 0, 'no probe pins its connection string to a literal address', literalConn.join(', '));

/* ── rule 2 ── */
const minters = files.filter((f) => /INSERT INTO auth_sessions/i.test(read(f)));
const unproven = minters.filter((f) => f !== HOME && !OWN_SERVER[f]
  && !/assertServerSees|QA\.signIn|serverSees/.test(read(f)));
ok(unproven.length === 0,
   'all ' + minters.length + ' probes that mint a session prove the server can see it',
   unproven.length ? 'not proven: ' + unproven.join(', ') : undefined);

/* AN EXCEPTION THAT NO LONGER APPLIES IS WORSE THAN NO EXCEPTION, because it silently
   excuses a probe nobody is watching. One is dead if its file is gone, if it no longer
   mints a session at all, or if it has since started proving it properly. */
const dead = Object.keys(OWN_SERVER).filter((f) =>
  !files.includes(f)
  || (f !== 'mint-token.js' && !minters.includes(f))
  || /assertServerSees|QA\.signIn/.test(files.includes(f) ? read(f) : ''));
ok(dead.length === 0, 'every one of the ' + Object.keys(OWN_SERVER).length + ' named exceptions is still needed',
   dead.join(', '));

/* ── the check must be able to fail ── */
const sample = files.find((f) => f !== HOME && /assertServerSees/.test(read(f)));
ok(sample && read(sample).includes(LITERAL) === false && read(HOME).includes(LITERAL),
   'self-test: the address really is present in ' + HOME + ' and absent from ' + sample);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
