/* The routing architecture has ONE rule that cannot be allowed to rot:
 * a word that is a real address on atwe.com must never be registrable as a
 * username, or that member would shadow a whole page of the platform.
 *
 * There is no build step, so the client (public/index.html → RESERVED_PATHS,
 * built from its APP_ROUTES table) and the server (routes.js → SYSTEM_ROUTES,
 * which seeds the reserved_usernames table) each hold their own copy. This test
 * is the thing that keeps them honest: add a route in one place and forget the
 * other, and it fails here rather than silently in production.
 *
 * Needs no database and no server — it reads the two files.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const { SYSTEM_ROUTES } = require(path.join(ROOT, 'routes.js'));

// Pull the client's route tables out of the single-file frontend and run just
// those declarations — no DOM needed, since the open: handlers are never called.
function clientTables() {
  const slice = (start, end) => {
    const i = html.indexOf(start);
    assert.ok(i > -1, 'could not find "' + start + '" in public/index.html');
    const j = html.indexOf(end, i);
    assert.ok(j > -1, 'could not find "' + end + '" after it');
    return html.slice(i, j);
  };
  const app = slice('const APP_ROUTES = {', 'const SETTINGS_ROUTES')
    .replace(/open:\s*\(\)\s*=>[^,}]+,?/g, '');   // drop handler bodies
  const mid = slice('const SETTINGS_ROUTES', 'const RESERVED_PATHS');
  const res = slice('const RESERVED_PATHS', '/* Read the address bar');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(app + '\n' + mid + '\n' + res + '\n' +
    'RESULT = JSON.stringify({ reserved: [...RESERVED_PATHS], routes: Object.keys(APP_ROUTES), ' +
    'settings: SETTINGS_ROUTES, sections: PROFILE_SECTIONS, auth: AUTH_ROUTES, entities: ENTITY_ROUTES });', ctx);
  // Cross the realm boundary as JSON: arrays built inside the vm carry the vm's
  // own Array prototype, and deepStrictEqual compares prototypes — so even two
  // empty arrays would "differ" without this.
  return JSON.parse(ctx.RESULT);
}

test('the client and server reserved-word lists are identical', () => {
  const { reserved } = clientTables();
  const a = [...new Set(reserved)].sort();
  const b = [...new Set(SYSTEM_ROUTES)].sort();
  const onlyClient = a.filter((x) => !b.includes(x));
  const onlyServer = b.filter((x) => !a.includes(x));
  assert.deepStrictEqual(onlyClient, [],
    'in public/index.html but missing from routes.js — signup would ALLOW these, and the member would shadow that page: ' + onlyClient.join(', '));
  assert.deepStrictEqual(onlyServer, [],
    'in routes.js but missing from public/index.html — the router would treat these as a username: ' + onlyServer.join(', '));
});

test('every app route reserves its own name', () => {
  const { routes, reserved } = clientTables();
  const set = new Set(reserved);
  const unguarded = routes.filter((r) => r && !set.has(r));
  assert.deepStrictEqual(unguarded, [],
    'these paths exist but their name is not reserved, so a member could take it: ' + unguarded.join(', '));
});

test('auth and entity prefixes are reserved too', () => {
  const { reserved, auth, entities } = clientTables();
  const set = new Set(reserved);
  const missing = [...auth, ...entities].filter((r) => !set.has(r));
  assert.deepStrictEqual(missing, [], 'unreserved: ' + missing.join(', '));
});

test('every route name is a clean, shareable URL segment', () => {
  const { routes, settings, sections, auth, entities } = clientTables();
  const all = [...routes.filter(Boolean), ...settings, ...sections, ...auth, ...entities];
  for (const r of all) {
    assert.match(r, /^[a-z0-9-]+$/,
      '"' + r + '" is not a clean URL segment — lowercase letters, digits and hyphens only (no underscores, no camelCase)');
    assert.ok(!r.startsWith('-') && !r.endsWith('-'), '"' + r + '" starts or ends with a hyphen');
    assert.ok(r.length <= 24, '"' + r + '" is too long to be memorable — keep routes short');
  }
});

test('no route is nested deeper than it needs to be', () => {
  const { settings } = clientTables();
  // /settings/security, never /account/settings/user/security
  for (const p of settings) assert.ok(!p.includes('/'), 'settings page "' + p + '" adds another level of nesting');
});
