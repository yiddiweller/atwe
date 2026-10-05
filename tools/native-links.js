#!/usr/bin/env node
/* Route batch 10 — keep the phone app and atwe.com on ONE route table.
 *
 *   node tools/native-links.js          write both generated files
 *   node tools/native-links.js --check  exit 1 if either is out of date (used by the test)
 *
 * Writes:
 *   public/.well-known/apple-app-site-association   — GENERATED from the registry's
 *       appLinkComponents(): every address the iPhone app can render is handed to it,
 *       everything else is explicitly excluded so Safari keeps it.
 *   atwe-mobile/src/lib/atwe-routes.js               — a BYTE-FOR-BYTE copy of
 *       public/atwe-routes.js. Metro cannot import a file outside the app's own folder,
 *       so the app carries a copy; it is never edited by hand, and the test fails if it
 *       differs from the original by a single byte.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'atwe-routes.js');
const AASA = path.join(ROOT, 'public', '.well-known', 'apple-app-site-association');
const COPY = path.join(ROOT, 'atwe-mobile', 'src', 'lib', 'atwe-routes.js');
const APP_IDS = ['TH3FQ8FMKB.com.atwe.app'];

function expected() {
  delete require.cache[require.resolve(SRC)];
  const R = require(SRC);
  return {
    [AASA]: JSON.stringify(R.aasaDocument(APP_IDS), null, 2) + '\n',
    [COPY]: fs.readFileSync(SRC, 'utf8'),
  };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const want = expected();
  let stale = 0;
  for (const [file, body] of Object.entries(want)) {
    const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (have === body) continue;
    stale++;
    if (check) console.error('OUT OF DATE: ' + path.relative(ROOT, file));
    else { fs.writeFileSync(file, body); console.log('wrote ' + path.relative(ROOT, file)); }
  }
  if (check && stale) { console.error('Run: node tools/native-links.js'); process.exit(1); }
  if (!stale) console.log('native links up to date');
}
module.exports = { expected, APP_IDS, AASA, COPY, SRC };
