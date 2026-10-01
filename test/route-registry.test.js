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
    // Route batch 7: an unknown /engine/<x> matches nothing; an issue is its own route.
    case 'engine': return null;
    case 'nlissue': return 'newsletter-issue';
    default: return d.type; // post, job, listing, event, service, course, newsletter, community, group, circle
  }
}
const TYPED = ['listing', 'job', 'event', 'service', 'course', 'newsletter'];
function appParams(d) {
  if (!d) return {};
  const out = {};
  // Handles are case-insensitive everywhere (lookups are lower()); the app keeps a
  // /company/<Name> alias's case and lower-cases later, the registry lower-cases now.
  if (d.username !== undefined) {
    if (d.type === 'group' || d.type === 'circle') out.slug = String(d.username);
    else out.username = String(d.username).toLowerCase();
  }
  // Route batch 7: a typed entity's segment is `{id}-{slug}`; an issue names its newsletter.
  if (d.type === 'nlissue') return { id: String(d.nl), issue: String(d.id) };
  if (TYPED.includes(d.type)) return { idslug: String(d.id) + (d.slug === null || d.slug === undefined ? '' : '-' + String(d.slug).toLowerCase()) };
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
  assert.throws(() => R.build('listing', { idslug: 'abc' }), /invalid idslug/);
  assert.throws(() => R.build('listing', { idslug: 'oak-chair' }), /invalid idslug/);
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
    'engine', 'marketplace', 'service', 'course', 'newsletter', 'issue', 'communities', 'showcase', '12-oak', '7-Café-&-co', '0-', 'search', 'workers',
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

/* ── Route batch 7 — Engine browse under /engine, typed public entity permalinks ───────── */
const ENGINE_BROWSE = ['marketplace', 'services', 'jobs', 'events', 'businesses', 'courses', 'newsletters', 'communities', 'showcase'];
const ENTITY_PARENT = { listing: 'marketplace', service: 'services', job: 'jobs', event: 'events', course: 'courses', newsletter: 'newsletters' };

test('batch 7: every Engine browse destination is canonical at /engine/<key>, its flat URL a permanent alias', () => {
  for (const k of ENGINE_BROWSE) {
    const r = R.get(k);
    assert.ok(r && r.status === 'live', k);
    assert.strictEqual(r.pattern, '/engine/' + k, k + ' canonical');
    assert.deepStrictEqual(r.aliases, ['/' + k], k + ' keeps its flat alias');
    assert.strictEqual(r.next, null, k + ' has arrived');
    assert.strictEqual(r.world, 'engine');
    assert.strictEqual(r.parent, 'search', k + ' climbs to the Engine root');
    assert.strictEqual(R.build(k), '/engine/' + k);
    assert.deepStrictEqual(R.match('/engine/' + k), { name: k, params: {}, alias: false });
    assert.deepStrictEqual(R.match('/' + k), { name: k, params: {}, alias: true });
    assert.deepStrictEqual(APP.parse('/engine/' + k), { type: 'route', key: k });
    assert.deepStrictEqual(APP.parse('/ENGINE/' + k.toUpperCase()), { type: 'route', key: k }, 'case-insensitive');
    assert.deepStrictEqual(APP.parse('/' + k), { type: 'route', key: k }, 'the flat alias still opens it');
    assert.strictEqual(APP.app[k].engine, true, k + ' carries engine:true in APP_ROUTES');
    assert.ok(APP.reserved.includes(k), k + ' stays reserved');
  }
  assert.ok(APP.reserved.includes('engine'));
});

test('batch 7: the Engine ROOT is still /search — batch 8 owns that flip', () => {
  const s = R.get('search');
  assert.strictEqual(s.pattern, '/search');
  assert.strictEqual(s.next, '/engine', 'the flip is recorded, not performed');
  assert.deepStrictEqual(s.aliases, ['/engine']);
  assert.ok(/WORLD_PATH = \{[^}]*search: '\/search'/.test(html), 'the Engine world still lives at /search');
  assert.ok(!/acSetPath\('\/engine'[,)]/.test(html), 'something writes the bare /engine');
});

test('batch 7: what stayed planned is not reachable, and never becomes a profile', () => {
  for (const n of ['engine-search', 'engine-workers']) {
    assert.strictEqual(R.get(n).status, 'planned', n);
    assert.throws(() => R.build(n), /planned/);
  }
  for (const p of ['/engine/search', '/engine/workers', '/engine/nope', '/engine/marketplace/x']) {
    assert.strictEqual(R.match(p), null, p + ' must not match');
    const d = APP.parse(p);
    assert.ok(!d || (d.type === 'engine' && d.unknown), p + ' parsed as ' + JSON.stringify(d));
  }
  // Showcase DETAIL: the approved audit gives two shapes; nothing here picks one.
  assert.ok(!R.ROUTES.some((x) => /^\/showcase\/:/.test(x.pattern)), 'a Showcase detail route was invented');
  for (const p of ['/showcase/3', '/showcase/3-sunset']) { assert.strictEqual(R.match(p), null, p); assert.strictEqual(APP.parse(p), null, p); }
});

test('batch 7: typed public entities are short, live, public, and parented by their browse surface', () => {
  for (const [t, parent] of Object.entries(ENTITY_PARENT)) {
    const r = R.get(t);
    assert.ok(r && r.status === 'live', t);
    assert.strictEqual(r.pattern, '/' + t + '/:idslug', t + ' is a short typed permalink, not nested under /engine');
    assert.strictEqual(r.parent, parent, t + ' direct-entry parent');
    assert.strictEqual(r.privacy, 'public'); assert.strictEqual(r.seo, 'index');
    assert.strictEqual(R.build(t, { idslug: R.idSlug(12, 'Oak Chair') }), '/' + t + '/12-oak-chair');
    assert.strictEqual(R.match('/' + t + '/12-oak-chair').name, t);
    assert.deepStrictEqual(APP.parse('/' + t + '/12-oak-chair'), { type: t, id: 12, slug: 'oak-chair' });
    assert.deepStrictEqual(APP.parse('/' + t + '/12'), { type: t, id: 12, slug: null }, t + ' bare id');
    assert.ok(APP.reserved.includes(t), t + ' prefix reserved');
  }
  const issue = R.get('newsletter-issue');
  assert.strictEqual(issue.pattern, '/newsletter/:id/issue/:issue');
  assert.strictEqual(issue.parent, 'newsletter');
  assert.deepStrictEqual(APP.parse('/newsletter/5/issue/9'), { type: 'nlissue', id: 9, nl: 5 });
  const comm = R.get('community');
  assert.strictEqual(comm.status, 'live'); assert.strictEqual(comm.pattern, '/communities/:id'); assert.strictEqual(comm.parent, 'communities');
  assert.deepStrictEqual(APP.parse('/communities/4'), { type: 'community', id: 4 });
  // no /engine/<type>/<id> nesting, ever
  assert.ok(!R.ROUTES.some((x) => /^\/engine\/[a-z-]+\/:/.test(x.pattern)), 'an entity was nested under /engine');
});

test('batch 7: the id is authoritative and the slug decorative — wrong, missing and odd slugs all resolve', () => {
  const same = ['/listing/12', '/listing/12-oak-chair', '/listing/12-WRONG-old-name', '/listing/012-x', '/listing/12-',
    '/listing/12-caf%C3%A9', '/listing/12/extra'];
  for (const p of same) {
    assert.strictEqual(R.match(p).name, 'listing', p);
    assert.strictEqual(APP.parse(p).id, 12, p + ' id');
  }
  for (const p of ['/service/12/x', '/course/12/x', '/newsletter/12/x']) {
    assert.strictEqual(R.match(p), null, p + ': only the legacy three tolerate a trailing segment');
    assert.strictEqual(APP.parse(p), null, p);
  }
});

test('batch 7: ONE slug rule (in the registry) — punctuation, whitespace, accents, non-Latin, length, rename', () => {
  assert.strictEqual(R.slugify('Oak Chair'), 'oak-chair');
  assert.strictEqual(R.slugify('  Oak    Chair  '), 'oak-chair', 'repeated whitespace');
  assert.strictEqual(R.slugify('Oak, chair! (2026) -- "New"?'), 'oak-chair-2026-new', 'punctuation');
  assert.strictEqual(R.slugify("Bob's Café & Bar"), 'bobs-cafe-and-bar', 'apostrophes, accents, ampersand');
  assert.strictEqual(R.slugify('שלום עולם'), '', 'a non-Latin title has no slug');
  assert.strictEqual(R.idSlug(7, 'שלום'), '7', '…and the canonical is the bare id');
  assert.strictEqual(R.idSlug(7, ''), '7');
  assert.strictEqual(R.idSlug(7, null), '7');
  const long = R.slugify('word '.repeat(40));
  assert.ok(long.length <= 60 && !long.endsWith('-') && !/-$/.test(long), 'long titles cut at a word: ' + long);
  assert.strictEqual(R.idSlug(9, 'Old name'), '9-old-name');
  assert.strictEqual(R.idSlug(9, 'New name'), '9-new-name', 'a rename keeps the id, changes the slug');
  assert.deepStrictEqual(R.parseIdSlug('9-new-name'), { id: 9, slug: 'new-name' });
  assert.deepStrictEqual(R.parseIdSlug('9'), { id: 9, slug: null });
  assert.strictEqual(R.parseIdSlug('new-name'), null);
  assert.throws(() => R.idSlug('x', 'a'), /invalid id/);
  // The app builds entity addresses through the registry rule only.
  assert.ok(/ATWE_ROUTES\.idSlug\(/.test(html), 'the app does not use the registry slug rule');
  assert.ok(!/function\s+(slugify|acSlug|_slug)\s*\(/.test(html), 'the app grew its own slug function');
  for (const t of ['listing', 'job', 'event', 'service', 'course', 'newsletter']) {
    assert.ok(new RegExp("acEntityPath\\('" + t + "'").test(html), t + ' is not addressed through acEntityPath');
  }
});

test('batch 7: malformed typed paths reject cleanly and never become a username', () => {
  const cases = ['/service', '/service/abc', '/service/-5', '/course/', '/newsletter/x', '/newsletter/5/issue', '/newsletter/5/issue/x',
    '/newsletter/5-slug/issue/9', '/newsletter/5/issues/9', '/communities/x', '/communities/5-x', '/communities/5/x', '/listing/abc-12',
    '/job/' + '9'.repeat(13), '/listing/12-' + 'x'.repeat(201)];
  for (const p of cases) {
    const m = R.match(p), d = APP.parse(p);
    assert.strictEqual(m ? m.name : null, appName(d), p + ': registry ' + (m && m.name) + ' vs app ' + appName(d));
    assert.ok(!d || d.type !== 'profile', p + ' fell through to a profile');
    assert.ok(!m || !['profile', 'profile-section', 'post'].includes(m.name), p + ' matched ' + (m && m.name));
  }
});

test('batch 7: a business stays at its username; cart stays a modal; no checkout or Engine-AI route', () => {
  assert.strictEqual(R.match('/someshop').name, 'profile');
  for (const n of ['business', 'engine-business', 'checkout', 'engine-ai', 'shop-ai']) assert.strictEqual(R.get(n), null, n);
  assert.strictEqual(R.match('/business/5'), null);
  assert.strictEqual(R.match('/engine/business/5'), null);
  assert.strictEqual(R.match('/engine/ai'), null);
  const cart = R.get('cart');
  assert.strictEqual(cart.pattern, '/cart'); assert.strictEqual(cart.family, 'modal');
  assert.ok(!R.ROUTES.some((x) => /checkout/.test(x.pattern)), 'a checkout stage got an address');
});

test('batch 7: no Engine-specific parent memories; Back stays the batch-6 model', () => {
  assert.ok(!/_engineFrom|_listingFrom|_serviceFrom|_jobFrom|_eventFrom|_courseFrom|_nlFrom|_commFrom/.test(html), 'a private browse-parent memory was introduced');
  assert.ok(!/history\.state[^;\n]*(slug|engine|entity)/i.test(html), 'routing reads entity state out of history.state');
});
