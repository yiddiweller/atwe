#!/usr/bin/env node
/**
 * Does the app know what every notification MEANS?
 *
 * `notifText` falls back to "interacted with you" for anything it does not
 * recognise, which is the worst kind of failure: it renders, it looks
 * deliberate, and it tells the reader nothing. The client knew 21 verbs while
 * the server could send 106, so a job application, a split request, an accepted
 * quote and a shipped order all came out as "interacted with you" — and nobody
 * noticed for months because nothing errored.
 *
 * The server's `PUSH_VERBS` is the canonical list. This reads it, reads the
 * client's map, and fails on anything the server can send that the client
 * cannot name.
 *
 *   node tools/check-notif-verbs.js [path/to/server.js]
 */
const fs = require('fs');
const path = require('path');

const SERVER = process.argv[2] || path.join(__dirname, '..', '..', 'server.js');
const CLIENT = path.join(__dirname, '..', 'src', 'api', 'notifications.ts');

if (!fs.existsSync(SERVER)) {
  console.log('· server.js not found — skipped (pass its path as an argument)');
  process.exit(0);
}

/** `key: 'value'` pairs at any depth inside one object literal, comments dropped. */
function pairs(body) {
  const clean = body.replace(/^\s*\/\/.*$/gm, '');
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(['"])((?:[^\\]|\\.)*?)\2/g;
  const out = {};
  let m;
  while ((m = re.exec(clean))) out[m[1]] = m[3];
  return out;
}

const srv = /const PUSH_VERBS = \{([\s\S]*?)\n\};/.exec(fs.readFileSync(SERVER, 'utf8'));
if (!srv) {
  console.error('✗ could not find PUSH_VERBS in the server — has it been renamed?');
  process.exit(1);
}
const serverVerbs = pairs(srv[1]);

const cli = /const map: Record<string, string> = \{([\s\S]*?)\n  \};/.exec(fs.readFileSync(CLIENT, 'utf8'));
if (!cli) {
  console.error('✗ could not find notifText\'s map in the client');
  process.exit(1);
}
const clientVerbs = pairs(cli[1]);

const missing = Object.keys(serverVerbs).filter((k) => !(k in clientVerbs));
const total = Object.keys(serverVerbs).length;

if (missing.length) {
  console.error(`✗ ${missing.length} notification verbs the server sends and the app cannot name:\n`);
  for (const k of missing) console.error(`  ${k}  — server says "${serverVerbs[k]}"`);
  console.error('\nEach one renders as "interacted with you". Add them to notifText.');
  process.exit(1);
}
console.log(`✓ notification verbs: all ${total} the server sends are named in the app`);
