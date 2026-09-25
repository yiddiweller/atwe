/* Route registry (public/atwe-routes.js) — Route Audit batch 0.
 *
 * The registry is the ONE declarative description of Atwe's addresses. During the
 * migration the app's own router (APP_ROUTES + parseDeepLink in public/index.html) is
 * still what runs, so the most important test here is the PARITY test: it executes
 * the app's REAL parseDeepLink — extracted from the shipped file, not re-implemented —
 * over a corpus of paths and fails if the registry's match() disagrees about any one
 * of them. That is what lets the registry exist without changing a single thing a
 * member sees.
 *
 * Needs no database, no server and no browser.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const R = require(path.join(ROOT, 'public', 'atwe-routes.js'));

/* Run the app's route tables + parseDeepLink in a sandbox with a fake `location`. */
function appRouter() {
  const i = html.indexOf('const APP_ROUTES = {');
  const j = html.indexOf('/* Turn a parsed route into the surface');
  assert.ok(i > -1 && j > i, 'could not find the router in public/index.html');
  const lw = html.match(/const LEGACY_WORLD_PATH = (\{[^}]+\});/);
  assert.ok(lw, 'could not find LEGACY_WORLD_PATH');
  const ctx = { location: { pathname: '/' }, requestAnimationFrame: () => 0, console };
  vm.createContext(ctx);
  vm.runInContext(html.slice(i, j) +
    '\nthis.__t = { parse: () => parseDeepLink(), reserved: [...RESERVED_PATHS], app: APP_ROUTES,' +
    ' settings: SETTINGS_ROUTES, sections: PROFILE_SECTIONS, auth: AUTH_ROUTES, entities: ENTITY_ROUTES };' +
    '\nthis.__legacy = ' + lw[1] + ';', ctx);
  const t = ctx.__t;
  return {
    parse(p) { ctx.location.pathname = p; return JSON.parse(JSON.stringify(t.parse() || null)); },
    reserved: JSON.parse(JSON.stringify(t.reserved)),
    app: t.app,
    settings: JSON.parse(JSON.stringify(t.settings)),
    sections: JSON.parse(JSON.stringify(t.sections)),
    auth: JSON.parse(JSON.stringify(t.auth)),
    entities: JSON.parse(JSON.stringify(t.entities)),
    legacyWorld: JSON.parse(JSON.stringify(ctx.__legacy)),
  };
}
const APP = appRouter();

/* Express the app parser's answer in registry vocabulary. */
function appName(d) {
  if (!d) return null;
  switch (d.type) {
    case 'route': return (d.key === '' || d.key === 'feed' || d.key === 'home') ? 'home' : d.key;
    case 'settings': return 'settings-page';
    case 'auth': return d.page;
    case 'profile': return d.section ? 'profile-section' : 'profile';
    default: return d.type; // post, job, listing, event, group, circle
  }
}
function appParams(d) {
  if (!d) return {};
  const out = {};
  // Handles are case-insensitive everywhere (lookups are lower()); the app keeps a
  // /company/<Name> alias's case and lower-cases later, the registry lower-cases now.
  if (d.username !== undefined) {
    if (d.type === 'group' || d.type === 'circle') out.slug = String(d.username);
    else out.username = String(d.username).toLowerCase();
  }
  if (d.id !== undefined) out.id = String(d.id);
  if (d.page !== undefined && d.type === 'settings') out.page = d.page;
  if (d.section !== undefined) out.section = d.section;
  return out;
}

const SAMPLE = { handle: 'john', int: '42', slug: 'acme', idslug: '42-oak-chair' };
const sampleParams = (route) => {
  const p = {};
  for (const [k, spec] of Object.entries(route.params)) p[k] = Array.isArray(spec) ? spec[0] : SAMPLE[spec];
  return p;
};
const norm = (pattern) => pattern.split('/').map((s) => (s.startsWith(':') ? ':' : s.toLowerCase())).join('/');
const live = R.ROUTES.filter((x) => x.status === 'live');

test('route names are unique', () => {
  const seen = new Set();
  for (const x of R.ROUTES) { assert.ok(!seen.has(x.name), 'duplicate route name ' + x.name); seen.add(x.name); }
});

test('every route is well-formed', () => {
  const enums = {
    status: ['live', 'planned'], auth: ['public', 'peek', 'account'], privacy: ['public', 'private'],
    seo: ['index', 'noindex', 'private'], family: ['root', 'hierarchy', 'modal'],
    world: ['home', 'beam', 'engine', 'notifications', 'account', 'settings', 'ai', 'auth', 'global'],
  };
  for (const x of R.ROUTES) {
    for (const [k, vals] of Object.entries(enums)) assert.ok(vals.includes(x[k]), x.name + ': bad ' + k + ' ' + x[k]);
    assert.match(x.pattern, /^\/([a-z0-9-]+|:[a-z]+)?(\/([a-z0-9-]+|:[a-z]+))*$/, x.name + ': malformed pattern ' + x.pattern);
    for (const seg of x.pattern.split('/').filter((s) => s.startsWith(':'))) {
      assert.ok(x.params[seg.slice(1)], x.name + ': param ' + seg + ' has no type');
    }
    if (x.parent && x.parent !== 'history') assert.ok(R.get(x.parent), x.name + ': parent ' + x.parent + ' is not a route');
    if (x.family === 'root') assert.strictEqual(x.parent, null, x.name + ': a root has no parent');
  }
});

test('canonical patterns are unique, current and future alike', () => {
  const seen = new Map();
  for (const x of R.ROUTES) {
    for (const p of [x.pattern, x.next].filter(Boolean)) {
      const k = norm(p);
      assert.ok(!seen.has(k) || seen.get(k) === x.name, p + ' is canonical for both ' + seen.get(k) + ' and ' + x.name);
      seen.set(k, x.name);
    }
  }
});

test('aliases never collide with a canonical pattern or another alias', () => {
  const canon = new Map(live.map((x) => [norm(x.pattern), x.name]));
  const seen = new Map();
  for (const x of live) {
    for (const a of x.aliases) {
      const k = norm(a);
      assert.ok(!canon.has(k), a + ' (alias of ' + x.name + ') is also the canonical of ' + canon.get(k));
      assert.ok(!seen.has(k), a + ' is an alias of both ' + seen.get(k) + ' and ' + x.name);
      seen.set(k, x.name);
    }
  }
});

test('no two live routes render the same overlay (one destination, one canonical)', () => {
  const seen = new Map();
  for (const x of live) {
    if (!x.view || x.name === 'settings-page') continue; // a Settings page IS the Settings overlay on a page
    assert.ok(!seen.has(x.view), x.view + ' is rendered by both ' + seen.get(x.view) + ' and ' + x.name);
    seen.set(x.view, x.name);
  }
});

test('builders produce valid paths that parse straight back (round trip)', () => {
  for (const x of live) {
    const params = sampleParams(x);
    const p = R.build(x.name, params);
    assert.match(p, /^\/[A-Za-z0-9._~@%\-/]*$/, x.name + ' built an invalid path: ' + p);
    assert.ok(!/undefined|null|\/\//.test(p), x.name + ' built ' + p);
    const m = R.match(p);
    assert.ok(m, x.name + ': ' + p + ' does not match anything');
    assert.strictEqual(m.name, x.name, p + ' built for ' + x.name + ' matched ' + m.name);
    assert.deepStrictEqual(m.params, params, x.name + ' params did not round-trip');
  }
});

test('a builder refuses planned routes and bad parameters instead of inventing a URL', () => {
  assert.throws(() => R.build('beam-dm', { username: 'john' }), /planned/);
  assert.throws(() => R.build('listing', {}), /missing id/);
  assert.throws(() => R.build('listing', { id: 'abc' }), /invalid id/);
  assert.throws(() => R.build('settings-page', { page: 'nope' }), /invalid page/);
  assert.throws(() => R.build('nope'), /unknown route/);
});

test('malformed paths reject cleanly (no throw, no wrong destination)', () => {
  const cases = ['/job/abc', '/listing/', '/wallet/x', '/login/extra', '/api', '/admin', '/index.html',
    '/%E0%A4%A', '/a b/c', '/' + 'x'.repeat(41), '/john!', '/company'];
  for (const p of cases) {
    let m; assert.doesNotThrow(() => { m = R.match(p); }, p);
    const a = appName(APP.parse(p));
    assert.strictEqual(m ? m.name : null, a, p + ': registry ' + (m && m.name) + ' vs app ' + a);
  }
  assert.strictEqual(R.match('/job/abc'), null);
  assert.strictEqual(R.match('/wallet/x'), null);
});

/* THE PARITY TEST. The registry must say exactly what the running app says. */
function corpus() {
  const out = new Set(['/', '/settings', '/settings/security', '/settings/SECURITY', '/settings/unknown',
    '/settings/security/devices', '/job/5', '/job/5/extra', '/listing/15', '/event/3', '/post/12', '/post/x',
    '/john', '/John', '/@john', '/john/post/7', '/john/post/x', '/john/post/7/photo/1', '/john/media',
    '/john/MEDIA/x', '/john/nothing', '/company/Acme', '/company/acme/x', '/group/Foo', '/group/@foo',
    '/circle/accounting', '/circle/a/b', '/login', '/signup', '/verify-email', '/reset-password',
    '/forgot-password', '/login/x', '/go', '/s', '/catalog', '/a.b', '/a..b', '/.x', '/-x', '/x_', '/admin.html',
    '/%40john', '/jo%20hn', '/%E0%A4%A']);
  for (const x of live) {
    out.add(R.build(x.name, sampleParams(x)));
    for (const a of x.aliases) out.add(a.replace(/:[a-z]+/g, (m) => SAMPLE[x.params[m.slice(1)]] || '1'));
  }
  for (const w of APP.reserved) { out.add('/' + w); out.add('/' + w + '/1'); out.add('/' + w + '/post/1'); }
  // deterministic fuzz: a seeded PRNG over plausible segments
  let s = 1874;
  const rnd = (n) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >>> 16) % n; };
  const pieces = ['post', 'job', 'listing', 'event', 'group', 'circle', 'company', 'settings', 'security',
    'media', 'about', 'john', 'Jane.Doe', '@bob', '12', 'x', '0', 'wallet', 'login', 'photo', 'MEDIA', '-a', 'a-'];
  for (let k = 0; k < 900; k++) {
    const n = 1 + rnd(4);
    out.add('/' + Array.from({ length: n }, () => pieces[rnd(pieces.length)]).join('/'));
  }
  return [...out];
}

test('PARITY: the registry resolves every path exactly as the app\'s parseDeepLink does', () => {
  const legacyWorld = new Set(Object.keys(APP.legacyWorld)); // /beam /engine /home /profile /ai (handled at boot)
  let checked = 0;
  for (const p of corpus()) {
    const d = APP.parse(p);
    const m = R.match(p);
    if (p === '/' || legacyWorld.has(p.toLowerCase())) {
      // The app's parser returns null for these on purpose: the bare domain is Home, and
      // the old world paths are rewritten at boot (handleUrlParams). The registry names
      // the world they land on.
      assert.ok(m && m.name, p + ' should name a world');
      continue;
    }
    const a = appName(d);
    assert.strictEqual(m ? m.name : null, a, 'path ' + p + ': registry says ' + (m && m.name) + ', app says ' + a);
    if (m) assert.deepStrictEqual(m.params, appParams(d), 'path ' + p + ': params differ');
    checked++;
  }
  assert.ok(checked > 500, 'the corpus is too small to prove anything (' + checked + ')');
});

test('the old world paths land on the same world the app sends them to', () => {
  const WORLD_OF = { chat: 'messages', search: 'search', home: 'home', profile: 'me', ai: 'ai' };
  for (const [p, tab] of Object.entries(APP.legacyWorld)) {
    const m = R.match(p);
    assert.ok(m, p + ' unmatched');
    assert.strictEqual(m.name, WORLD_OF[tab], p + ' → ' + m.name + ', app → ' + tab);
  }
});

test('every APP_ROUTES entry is represented, with the same view and auth class', () => {
  for (const [key, def] of Object.entries(APP.app)) {
    const m = R.match('/' + key);
    assert.ok(m, '/' + key + ' is an app route but the registry does not know it');
    const route = R.get(m.name);
    if (def.view) assert.strictEqual(route.view, def.view, key + ': view differs');
    // A world's own gate lives in appTab() (every world needs an account), so its
    // APP_ROUTES line carries no auth flag; the registry states the product truth.
    if (String(def.open).includes('appTab(')) { assert.strictEqual(route.auth, 'account', key + ': a world needs an account'); continue; }
    assert.strictEqual(route.auth === 'account', !!def.auth, key + ': auth class differs');
  }
});

test('the registry and the app agree on Settings pages and profile sections', () => {
  assert.deepStrictEqual([...R.SETTINGS_PAGES].sort(), [...APP.settings].sort());
  assert.deepStrictEqual([...R.PROFILE_SECTIONS].sort(), [...APP.sections].sort());
  for (const a of APP.auth) assert.ok(R.get(a), 'auth page ' + a + ' missing');
  for (const e of APP.entities) assert.ok(R.parseReserved().includes(e), 'entity prefix ' + e + ' not reserved');
});

test('reserved roots are derived from the registry and equal the router\'s set exactly', () => {
  assert.deepStrictEqual(R.parseReserved(), [...new Set(APP.reserved)].sort(),
    'public/index.html RESERVED_PATHS and the registry\'s parseReserved() have drifted');
});

test('first path segments are derivable, and every live one is reserved', () => {
  const reserved = new Set(R.parseReserved());
  for (const x of live) {
    for (const p of [x.pattern].concat(x.aliases)) {
      const f = R.firstLiteral(p);
      if (f) assert.ok(reserved.has(f), f + ' (' + x.name + ') is a route root but not reserved');
    }
  }
  const alloc = new Set(R.allocationReserved());
  for (const f of R.routeRoots()) assert.ok(alloc.has(f), 'route root ' + f + ' is not reserved for new usernames');
});

test('the public identity root stays protected', () => {
  const profile = R.get('profile');
  assert.strictEqual(profile.pattern, '/:username', 'people and businesses live at atwe.com/{username}');
  assert.strictEqual(profile.status, 'live');
  assert.strictEqual(R.match('/someone').name, 'profile');
  assert.strictEqual(R.match('/someone/post/9').name, 'post');
  // No live or planned route may put a parameter anywhere but the identity routes' first slot.
  for (const x of R.ROUTES) {
    if (R.firstLiteral(x.pattern) === null) assert.ok(['profile', 'profile-section', 'post', 'media', 'home'].includes(x.name) || x.pattern === '/', x.name + ' claims the root namespace');
  }
});

test('the critical URLs of today are all still represented', () => {
  const must = {
    '/': 'home', '/messages': 'messages', '/search': 'search', '/me': 'me', '/notifications': 'notifications',
    '/settings': 'settings', '/settings/security': 'settings-page', '/devices': 'devices', '/wallet': 'wallet',
    '/marketplace': 'marketplace', '/listing/1': 'listing', '/job/1': 'job', '/event/1': 'event',
    '/post/1': 'post', '/john/post/1': 'post', '/john': 'profile', '/john/media': 'profile-section',
    '/company/john': 'profile', '/group/x': 'group', '/circle/x': 'circle', '/login': 'login',
    '/signup': 'signup', '/ai': 'ai', '/collections': 'collections', '/orders': 'orders', '/store': 'store',
  };
  for (const [p, n] of Object.entries(must)) assert.strictEqual((R.match(p) || {}).name, n, p);
});

test('approved future addresses are data only: never matched, always reserved', () => {
  const alloc = new Set(R.allocationReserved());
  for (const x of R.ROUTES.filter((y) => y.status === 'planned')) {
    const f = R.firstLiteral(x.pattern);
    if (f) assert.ok(alloc.has(f), x.name + ': ' + f + ' is not reserved ahead of launch');
  }
  for (const x of live) if (x.next) { const f = R.firstLiteral(x.next); if (f) assert.ok(alloc.has(f), x.name + ' next ' + x.next); }
  // Nothing planned is reachable yet.
  assert.notStrictEqual((R.match('/beam/u/john') || {}).name, 'beam-dm');
  assert.notStrictEqual((R.match('/account/money') || {}).name, 'account-section');
});

test('notification destinations map onto real registry routes', () => {
  for (const [kind, name] of Object.entries(R.NOTIF_TARGETS)) assert.ok(R.get(name), kind + ' → ' + name + ' is not a route');
});

test('the page loads the registry at the build it was shipped with', () => {
  const build = (html.match(/const ATWE_BUILD = '(\d+)'/) || html.match(/ATWE_BUILD\s*=\s*'(\d+)'/) || [])[1];
  const tag = html.match(/<script src="\/atwe-routes\.js\?v=(\d+)"><\/script>/);
  assert.ok(build, 'ATWE_BUILD not found');
  assert.ok(tag, 'index.html does not load /atwe-routes.js?v=<build>');
  assert.strictEqual(tag[1], build, 'atwe-routes.js?v= must equal ATWE_BUILD, or the service worker can serve a stale registry');
  assert.ok(tag.index < html.indexOf('const APP_ROUTES = {'), 'the registry must load before the app script');
});
