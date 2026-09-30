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
    ' settings: SETTINGS_ROUTES, leaves: Object.keys(SETTINGS_LEAVES), sections: PROFILE_SECTIONS, auth: AUTH_ROUTES, entities: ENTITY_ROUTES,' +
    ' acctSections: ACCOUNT_SECTION_IDS, acctTools: ACCOUNT_TOOL_KEYS };' +
    '\nthis.__legacy = ' + lw[1] + ';', ctx);
  const t = ctx.__t;
  return {
    parse(p) { ctx.location.pathname = p; return JSON.parse(JSON.stringify(t.parse() || null)); },
    reserved: JSON.parse(JSON.stringify(t.reserved)),
    app: t.app,
    settings: JSON.parse(JSON.stringify(t.settings)),
    leaves: JSON.parse(JSON.stringify(t.leaves)),
    sections: JSON.parse(JSON.stringify(t.sections)),
    auth: JSON.parse(JSON.stringify(t.auth)),
    entities: JSON.parse(JSON.stringify(t.entities)),
    acctSections: JSON.parse(JSON.stringify(t.acctSections)),
    acctTools: JSON.parse(JSON.stringify(t.acctTools)),
    legacyWorld: JSON.parse(JSON.stringify(ctx.__legacy)),
  };
}
const APP = appRouter();

/* Express the app parser's answer in registry vocabulary. */
function appName(d) {
  if (!d) return null;
  switch (d.type) {
    case 'route': return (d.key === '' || d.key === 'feed' || d.key === 'home' || d.key === 'go') ? 'home' : d.key;
    // Route batch 4: the Settings tree is explicit routes; an unknown node matches nothing.
    case 'settings': return d.unknown ? null : d.page === 'hub' ? 'settings' : 'settings-' + d.page + (d.leaf ? '-' + d.leaf : '');
    case 'auth': return d.page;
    // Route batch 5: an Account section is its own route; an unknown /account/… matches nothing.
    case 'account': return d.unknown ? null : 'account-' + d.section;
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
  // A profile's /<username>/<section> is a parameter; an Account section is its own route.
  if (d.section !== undefined && d.type === 'profile') out.section = d.section;
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
    if (!x.view || x.view === 'settingsOverlay') continue; // the hub and every page ARE the Settings overlay, on a page
    // A route that BORROWS an overlay names the route that owns it (route batch 5:
    // /account/store/orders is the Orders overlay on its Seller tab).
    if (x.sharedView) { assert.strictEqual(R.get(x.sharedView).view, x.view, x.name + ' borrows ' + x.view + ' from a route that does not own it'); continue; }
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
  assert.throws(() => R.build('profile-section', { username: 'john', section: 'nope' }), /invalid section/);
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
    '/settings/security/devices', '/settings/security/devices/x', '/settings/security/nope', '/settings/nope/devices',
    '/Settings/Privacy/Muted-Words', '/settings/about/whats-new', '/devices', '/DEVICES', '/devices/x', '/settings/', '/job/5', '/job/5/extra', '/listing/15', '/event/3', '/post/12', '/post/x',
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
    // An Account tool with no flat address (flat:false) is represented at /account/<acct>.
    const at = def.flat === false ? '/account/' + def.acct : '/' + key;
    const m = R.match(at);
    assert.ok(m, at + ' is an app route but the registry does not know it');
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
    '/settings': 'settings', '/settings/security': 'settings-security', '/devices': 'settings-security-devices', '/wallet': 'wallet',
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
  for (const p of ['/account/orders/5', '/account/store/orders/5', '/account/wallet/tx/5', '/account/store/pause', '/account/certified']) {
    assert.strictEqual(R.match(p), null, p + ' is planned and must not match yet');
  }
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

/* ── Route batch 4 — Settings is a real URL hierarchy ─────────────────────────── */
const SET_PAGES = ['account', 'privacy', 'security', 'notifications', 'premium', 'display', 'assistant', 'data', 'about'];
const SET_LEAVES = ['account/delete', 'privacy/contact', 'privacy/blocked', 'privacy/muted', 'privacy/muted-words',
  'privacy/last-seen', 'security/devices', 'security/2fa', 'security/passkeys', 'security/locks', 'notifications/phone',
  'premium/creator', 'display/language', 'display/currency', 'data/history', 'about/whats-new'];

test('batch 4: the approved Settings tree, exactly — every node build→parse round-trips, in the app too', () => {
  const settingsRoutes = live.filter((x) => x.world === 'settings').map((x) => x.name).sort();
  const want = ['settings'].concat(SET_PAGES.map((p) => 'settings-' + p), SET_LEAVES.map((l) => 'settings-' + l.replace('/', '-'))).sort();
  assert.deepStrictEqual(settingsRoutes, want, 'the live Settings routes are not the approved tree');
  for (const name of want) {
    const p = R.build(name);
    assert.strictEqual(R.match(p).name, name, p);
    assert.strictEqual(appName(APP.parse(p)), name, 'app parses ' + p + ' as ' + appName(APP.parse(p)));
    const r = R.get(name);
    assert.strictEqual(r.auth, 'account', name + ' needs an account');
    assert.strictEqual(r.privacy, 'private', name + ' is private');
    assert.strictEqual(r.seo, 'private', name + ' is not indexed');
    assert.strictEqual(r.family, 'hierarchy', name);
    assert.ok(r.title, name + ' declares a title');
    assert.ok(r.view, name + ' declares the surface that renders it');
  }
});

test('batch 4: every Settings parent is a real route one level up', () => {
  for (const p of SET_PAGES) assert.strictEqual(R.get('settings-' + p).parent, 'settings');
  for (const l of SET_LEAVES) {
    const [page] = l.split('/');
    const r = R.get('settings-' + l.replace('/', '-'));
    assert.strictEqual(r.parent, 'settings-' + page, l + ' parent');
    assert.ok(R.get(r.parent), l + ' parent exists');
    assert.strictEqual(R.build(r.parent), '/settings/' + page);
  }
});

test('batch 4: the app binds an opener to exactly the registry\'s leaves (no second route table)', () => {
  assert.deepStrictEqual([...APP.leaves].sort(), [...SET_LEAVES].sort());
  assert.deepStrictEqual(R.SETTINGS_LEAVES.map(([p, l]) => p + '/' + l).sort(), [...SET_LEAVES].sort());
  const views = R.SETTINGS_LEAVES.map((x) => x[2]);
  assert.strictEqual(new Set(views).size, views.length, 'two leaves share a sheet');
  for (const v of views) assert.ok(html.includes('id="' + v + '"') || html.includes("id = '" + v + "'"), v + ' is not a sheet in the app');
});

test('batch 4: /devices is an alias of settings-security-devices, and stays reserved', () => {
  const m = R.match('/devices');
  assert.strictEqual(m.name, 'settings-security-devices');
  assert.strictEqual(m.alias, true);
  assert.deepStrictEqual(APP.parse('/devices'), { type: 'settings', page: 'security', leaf: 'devices', alias: true });
  assert.ok(R.parseReserved().includes('devices'));
  assert.ok(APP.reserved.includes('devices'));
  assert.strictEqual(R.NOTIF_TARGETS.devices, 'settings-security-devices');
  assert.strictEqual(R.get('devices'), null, 'the old standalone devices route is gone');
});

test('batch 4: transient Settings flows have NO address', () => {
  const TRANSIENT = ['change-email', 'email', 'change-username', 'username', 'change-password', 'password', 'pause',
    'deactivate', 'link', 'link-device', 'qr', 'feedback', 'report', 'theme', 'appearance', 'wallet', 'plan', 'store'];
  for (const page of SET_PAGES) for (const t of TRANSIENT) {
    const p = '/settings/' + page + '/' + t;
    assert.strictEqual(R.match(p), null, p + ' became a route');
    assert.strictEqual(appName(APP.parse(p)), null, p + ' is a route in the app');
  }
  for (const t of TRANSIENT) assert.ok(!R.ROUTES.some((x) => x.world === 'settings' && x.pattern.endsWith('/' + t)), t);
  assert.strictEqual(R.match('/settings/assistant/ask'), null, 'Assistant has no leaves');
});

test('batch 4: malformed or unknown Settings paths never become another page or a profile', () => {
  const cases = ['/settings/nope', '/settings/security/nope', '/settings/security/devices/x', '/settings/nope/devices',
    '/settings/privacy/muted/words', '/settings//security', '/settings/%2e%2e', '/settings/security/devices%2Fx'];
  for (const p of cases) {
    const m = R.match(p), d = APP.parse(p);
    const a = appName(d);
    assert.strictEqual(m ? m.name : null, a, p + ': registry ' + (m && m.name) + ' vs app ' + a);
    assert.ok(!m || m.name.startsWith('settings'), p + ' left the Settings namespace: ' + (m && m.name));
    assert.ok(!d || d.type === 'settings', p + ' parsed as ' + (d && d.type));
  }
  assert.strictEqual(APP.parse('/settings/nope').unknown, true);
  assert.strictEqual(APP.parse('/settings/security/nope').unknown, true);
  assert.strictEqual(APP.parse('/settings/security/devices/x').unknown, true);
});

test('batch 4: no history.state Settings routing is left in the app', () => {
  assert.ok(!/history\.state[^;\n]*setPage/.test(html), 'something still reads setPage out of history.state');
  assert.ok(!/_setHistWrite|_histEntry\(|writeState\(/.test(html), 'a legacy Settings history writer survived');
  assert.ok(!/\{\s*land:\s*true\s*\}|\{\s*deep:\s*true\s*\}/.test(html), 'a land/deep Settings entry survived');
  assert.ok(/'prev', 'setPage', 'via'\]\.includes\(k\)/.test(html), 'legacyOf must strip setPage/via so nothing can write them');
});

/* ── Route batch 5 — Account sections and tools are canonical URLs ────────────────── */
const ACCT_SECTIONS = ['profile', 'money', 'selling', 'customers', 'marketing', 'jobs', 'library', 'planning', 'creating', 'ai', 'help'];

test('batch 5: the Account root is still /me, and /account is only its FUTURE canonical', () => {
  const me = R.get('me');
  assert.strictEqual(me.pattern, '/me');
  assert.strictEqual(me.next, '/account', 'the batch-8 flip is recorded, not performed');
  assert.strictEqual(me.family, 'root');
  assert.strictEqual(me.parent, null);
  assert.strictEqual(R.match('/me').name, 'me');
  assert.strictEqual(R.match('/account'), null, 'the bare /account is not live before batch 8');
  assert.strictEqual(APP.parse('/account'), null);
  assert.strictEqual(R.ROUTES.filter((x) => x.world === 'account' && x.family === 'root').length, 1, 'ONE Account root');
});

test('batch 5: all eleven sections are live, private, and children of the Account root', () => {
  assert.deepStrictEqual(R.ACCOUNT_SECTIONS.map((x) => x[0]), ACCT_SECTIONS);
  assert.deepStrictEqual(Object.keys(APP.acctSections).sort(), [...ACCT_SECTIONS].sort(), 'the app binds exactly the registry sections');
  for (const k of ACCT_SECTIONS) {
    const r = R.get('account-' + k);
    assert.ok(r && r.status === 'live', k);
    assert.strictEqual(r.pattern, '/account/' + k);
    assert.strictEqual(r.world, 'account');
    assert.strictEqual(r.auth, 'account');
    assert.strictEqual(r.privacy, 'private');
    assert.strictEqual(r.seo, 'private');
    assert.strictEqual(r.family, 'hierarchy');
    assert.strictEqual(r.parent, 'me');
    assert.ok(r.title, k + ' title');
    assert.strictEqual(R.build('account-' + k), '/account/' + k);
    assert.deepStrictEqual(APP.parse('/account/' + k), { type: 'account', section: k });
    assert.deepStrictEqual(APP.parse('/ACCOUNT/' + k.toUpperCase()), { type: 'account', section: k }, 'case-insensitive');
  }
});

test('batch 5: every Account tool is canonical under /account, parented by a real section', () => {
  const tools = R.liveRoutes().filter((x) => x.world === 'account' && x.family === 'hierarchy' && !x.name.startsWith('account-'));
  assert.strictEqual(tools.length, R.ACCOUNT_TOOLS.length);
  for (const x of tools) {
    assert.ok(x.pattern.startsWith('/account/'), x.name + ' ' + x.pattern);
    assert.ok(x.parent.startsWith('account-') && R.get(x.parent), x.name + ' parent ' + x.parent);
    assert.strictEqual(x.auth, 'account', x.name);
    assert.strictEqual(x.privacy, 'private', x.name);
    assert.ok(x.view, x.name + ' view');
    assert.ok(x.title, x.name + ' title');
    const sub = x.pattern.slice('/account/'.length);
    assert.strictEqual(APP.acctTools[sub], x.name, 'app binds /account/' + sub + ' to ' + APP.acctTools[sub]);
    assert.strictEqual(appName(APP.parse(x.pattern)), x.name);
    assert.strictEqual(APP.app[x.name].acct, sub, x.name + ' acct column');
    assert.strictEqual(APP.app[x.name].view, x.view, x.name + ' view differs');
  }
  assert.deepStrictEqual(Object.keys(APP.acctTools).sort(), tools.map((x) => x.pattern.slice(9)).sort(), 'no app-only Account tool');
});

test('batch 5: every flat Account URL ever issued is a permanent alias of its /account canonical', () => {
  const FLAT = ['wallet', 'money-requests', 'invoices', 'quotes', 'payment-links', 'gift-cards', 'rewards', 'referrals',
    'store', 'listings', 'analytics', 'ads', 'dashboard', 'team', 'affiliate', 'orders', 'saved', 'subscriptions',
    'addresses', 'bookings', 'calendar', 'appointments', 'network', 'resumes', 'job-alerts'];
  for (const f of FLAT) {
    const m = R.match('/' + f);
    assert.ok(m && m.alias, '/' + f + ' must stay an alias');
    assert.ok(R.build(m.name).startsWith('/account/'), '/' + f + ' canonical is ' + R.build(m.name));
    const d = APP.parse('/' + f);
    assert.strictEqual(d.type, 'route'); assert.strictEqual(d.key, m.name); assert.strictEqual(d.alias, true);
    assert.ok(APP.reserved.includes(f), f + ' must stay reserved');
  }
  // Tools that never had a flat address did not gain one, nor a reserved word.
  for (const k of ['card', 'coupons', 'bundles', 'till', 'delivery', 'phone', 'verification', 'pro', 'store-orders']) {
    assert.strictEqual(APP.app[k].flat, false, k);
    assert.ok(!APP.reserved.includes(k) || R.PARSE_DEFENSIVE.includes(k), k + ' became a new reserved root');
  }
});

test('batch 5: malformed /account paths never fall through to a profile or another page', () => {
  const cases = ['/account/nope', '/account/wallet/x', '/account/money/wallet', '/account/store/nope', '/account//money',
    '/account/%2e%2e', '/account/wallet%2Fx', '/account/orders/5', '/account/wallet/tx/1', '/account/store/pause', '/account/certified'];
  for (const p of cases) {
    const m = R.match(p), d = APP.parse(p);
    assert.strictEqual(m ? m.name : null, appName(d), p + ': registry vs app');
    assert.ok(!m || R.get(m.name).world === 'account', p + ' left the Account namespace: ' + (m && m.name));
    assert.ok(!d || d.type === 'account' || (d.type === 'route' && APP.app[d.key].acct), p + ' parsed as ' + JSON.stringify(d));
  }
  assert.strictEqual(APP.parse('/account/nope').unknown, true);
});

test('batch 5: private details stay unrouted (no sequential ids made addressable)', () => {
  for (const n of ['order-detail', 'store-order-detail', 'wallet-tx']) {
    assert.strictEqual(R.get(n).status, 'planned', n);
    assert.throws(() => R.build(n, { ref: 'x' }), /planned/);
  }
  for (const x of R.liveRoutes().filter((y) => y.world === 'account')) assert.ok(!/:/.test(x.pattern), x.name + ' takes a parameter');
  assert.ok(!/\/account\/(orders|store\/orders|wallet\/tx|invoices|quotes)\/'\s*\+/.test(html), 'the app builds a private detail URL');
});

test('batch 5: the Account root flip stays for batch 8 — nothing in the app routes /me to /account', () => {
  assert.ok(/WORLD_PATH = \{[^}]*profile: '\/me'/.test(html), 'the Account world still lives at /me');
  assert.ok(!/acSetPath\('\/account'[,)]/.test(html), 'something writes the bare /account');
});
