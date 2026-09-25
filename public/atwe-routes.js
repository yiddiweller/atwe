/* ═══════════════════════════════════════════════════════════════════════════
   ATWE ROUTE REGISTRY — the ONE declarative description of every Atwe address.
   ═══════════════════════════════════════════════════════════════════════════

   Loaded by BOTH halves of the product, which is the point of it:
     · the browser, as a classic <script> before the app's own script
       (window.ATWE_ROUTES), and
     · the server and the test suite, via require() (module.exports).
   There is no build step, so a file that is valid in both worlds is the only way to
   have a single source that the client, the server, the tests — and later the native
   app — all read instead of each keeping a copy.

   WHAT IS AUTHORITATIVE DURING THE MIGRATION (Route Audit batch 0)
   ----------------------------------------------------------------
   · This file is authoritative for route DATA: names, current patterns, aliases, the
     approved future pattern (`next`), world, auth class, privacy, SEO class, motion
     family, logical parent, and every reserved-name set.
   · public/index.html's APP_ROUTES / parseDeepLink / RESERVED_PATHS are still
     authoritative for RUNTIME behaviour (what a URL opens). Nothing at runtime is
     routed through this file yet, deliberately: a big-bang router swap is exactly
     what the audit ruled out.
   · test/route-registry.test.js keeps the two in lock-step: it runs the app's real
     parseDeepLink over a corpus of paths and fails if this registry's match()
     disagrees about ANY of them, and it requires RESERVED_PATHS to equal
     parseReserved() here exactly.
   Retirement path: once the runtime reads routes from here (Route batch 3+), the
   APP_ROUTES data columns, SETTINGS_ROUTES/PROFILE_SECTIONS/AUTH_ROUTES/ENTITY_ROUTES
   and the literal RESERVED_PATHS set are deleted, leaving APP_ROUTES as a map of
   route name → open() only; routes.js then re-exports from here.

   THE RULES THIS FILE ENCODES
   · status 'live'    — the address works today. match()/build() only ever see these.
   · status 'planned' — an APPROVED future address (Route Audit §44). Data only: it is
     never matched or built at runtime, but its first segment is already reserved so
     no new member can take it before it ships.
   · `next`           — the approved future canonical for a live route (e.g. /messages
     → /beam). Data only; nothing redirects yet.
   · A builder owns every URL: code must call build(name, params), never concatenate.
   · history.state may carry a route NAME from here for bookkeeping, never destination
     state (the URL alone says what is shown).

   Keep this file dependency-free ES2017 and side-effect free (no DOM, no fetch).
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ATWE_ROUTES = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  /* ── Parameter types ── `test` validates a decoded segment, `norm` canonicalises it. */
  const PARAM_TYPES = {
    int:    { test: (s) => /^\d+$/.test(s), norm: (s) => String(parseInt(s, 10)) },
    // A public handle as the ROUTER accepts it today (grandfathered shapes included).
    handle: { test: (s) => /^@?[a-z0-9._-]{1,40}$/i.test(s), norm: (s) => s.replace(/^@/, '').toLowerCase() },
    // group / circle slugs: the router takes any segment and strips a leading @.
    slug:   { test: (s) => s.length > 0 && s.length <= 80, norm: (s) => s.replace(/^@/, '') },
    // approved future `{id}-{slug}` entity form; the id is authoritative.
    idslug: { test: (s) => /^\d{1,12}(-[a-z0-9-]{1,80})?$/.test(s), norm: (s) => s },
  };

  const SETTINGS_PAGES = ['account', 'privacy', 'security', 'notifications',
    'premium', 'display', 'assistant', 'data', 'about'];
  const PROFILE_SECTIONS = ['posts', 'replies', 'media', 'likes', 'about', 'connections'];

  /* ── The routes ────────────────────────────────────────────────────────────
     name     unique id. The route NAME, not the URL, is what code refers to.
     pattern  '/literal/:param' — params typed in `params`.
     tail     extra trailing segments are tolerated (mirrors today's parser).
     world    home | beam | engine | notifications | account | settings | ai | auth | global
     view     the overlay id that renders it (for routed overlays).
     auth     public | peek | account   (peek = the logged-out profile preview)
     privacy  public | private
     seo      index | noindex | private
     family   root | hierarchy | modal  — the motion family entering it
     parent   a route name, 'history' (the real previous entry decides), or null (a root)
     aliases  other live patterns that land here (and canonicalise to `pattern`)
     next     the approved FUTURE canonical pattern (data only)
     native   the atwe-mobile route this should open (data only, not yet enforced) */
  const L = 'live', P = 'planned';
  const r = (name, pattern, o) => Object.assign({ name, pattern, status: L, tail: false,
    world: 'global', view: null, auth: 'account', privacy: 'private', seo: 'private',
    family: 'hierarchy', parent: 'history', aliases: [], next: null, native: null, params: {} }, o || {});
  const pub = { auth: 'public', privacy: 'public', seo: 'index' };
  const acct = (view, next, o) => Object.assign({ world: 'account', view, next, parent: 'me' }, o || {});

  const ROUTES = [
    /* The five worlds (+ the AI inside page). Today's world URLs keep working; the
       approved canonical roots are recorded in `next` and are NOT switched on yet. */
    r('home',      '/',          { world: 'home', family: 'root', parent: null, aliases: ['/feed', '/home'], native: '/' }),
    r('messages',  '/messages',  { world: 'beam', family: 'root', parent: null, aliases: ['/beam'], next: '/beam' }),
    r('search',    '/search',    { world: 'engine', family: 'root', parent: null, aliases: ['/engine'], next: '/engine', seo: 'noindex' }),
    r('me',        '/me',        { world: 'account', family: 'root', parent: null, aliases: ['/profile'], next: '/account' }),
    r('notifications', '/notifications', { world: 'notifications', family: 'root', parent: null, view: 'notifOverlay', native: '/notifications' }),
    r('ai',        '/ai',        { world: 'ai', parent: 'history' }),

    /* Settings — its own global namespace (Route Audit §19, option B). */
    /* settings-page is listed BEFORE settings on purpose: both match /settings/security,
       and the page is the more specific answer. /settings/<unknown> falls through to
       plain `settings` (tail), exactly as the app's parser does today. */
    r('settings-page',  '/settings/:page', { world: 'settings', view: 'settingsOverlay', tail: true, parent: 'settings',
                                             params: { page: SETTINGS_PAGES } }),
    r('settings',       '/settings',       { world: 'settings', view: 'settingsOverlay', tail: true, native: '/settings' }),
    r('devices',        '/devices',        { world: 'settings', view: 'devicesOverlay', parent: 'settings-page', next: '/settings/security/devices' }),
    r('help',           '/help',           Object.assign({ view: 'helpOverlay', world: 'global' }, pub)),

    /* Network & work */
    r('network',     '/network',     acct('connList', '/account/network')),
    r('jobs',        '/jobs',        { world: 'engine', next: '/engine/jobs', parent: 'search' }),
    r('job-alerts',  '/job-alerts',  acct('savedSearches', '/account/job-alerts')),
    r('resumes',     '/resumes',     acct('resumesList', '/account/resumes')),
    r('businesses',  '/businesses',  Object.assign({ world: 'engine', view: 'bizDirectory', next: '/engine/businesses', parent: 'search' }, pub)),
    r('services',    '/services',    Object.assign({ world: 'engine', view: 'servicesView', next: '/engine/services', parent: 'search' }, pub)),
    r('events',      '/events',      Object.assign({ world: 'engine', view: 'eventsList', next: '/engine/events', parent: 'search' }, pub)),
    r('courses',     '/courses',     Object.assign({ world: 'engine', view: 'coursesView', next: '/engine/courses', parent: 'search' }, pub)),
    r('newsletters', '/newsletters', Object.assign({ world: 'engine', view: 'nlList', next: '/engine/newsletters', parent: 'search' }, pub)),
    r('communities', '/communities', Object.assign({ world: 'engine', view: 'commList', next: '/engine/communities', parent: 'search' }, pub)),
    r('showcase',    '/showcase',    Object.assign({ world: 'engine', view: 'showcaseDiscover', next: '/engine/showcase', parent: 'search' }, pub)),

    /* Shopping */
    r('marketplace', '/marketplace', Object.assign({ world: 'engine', view: 'marketplaceView', next: '/engine/marketplace', parent: 'search', native: '/marketplace' }, pub)),
    r('cart',        '/cart',        { world: 'engine', view: 'cartView', family: 'modal' }),
    r('orders',        '/orders',        acct('ordersView', '/account/orders')),
    r('saved',         '/saved',         acct('savedView', '/account/saved')),
    r('collections',   '/collections',   { world: 'home', parent: 'home' }),
    r('subscriptions', '/subscriptions', acct('subsView', '/account/subscriptions')),
    r('addresses',     '/addresses',     acct('addressesView', '/account/addresses')),
    r('bookings',      '/bookings',      acct('bookingsView', '/account/bookings')),

    /* Money */
    r('wallet',         '/wallet',         acct('walletView', '/account/wallet', { native: '/wallet' })),
    r('money-requests', '/money-requests', acct('moneyRequestsView', '/account/money-requests')),
    r('invoices',       '/invoices',       acct('invoicesView', '/account/invoices')),
    r('quotes',         '/quotes',         acct('quotesView', '/account/quotes')),
    r('payment-links',  '/payment-links',  acct('payLinkView', '/account/payment-links')),
    r('gift-cards',     '/gift-cards',     acct('giftCardView', '/account/gift-cards')),
    r('rewards',        '/rewards',        acct('loyaltyView', '/account/rewards')),
    r('referrals',      '/referrals',      acct('referView', '/account/referrals')),

    /* Selling & business */
    r('dashboard', '/dashboard', acct('dashboardView', '/account/dashboard')),
    r('store',     '/store',     acct('storeManageView', '/account/store')),
    r('listings',  '/listings',  acct('sellView', '/account/store/listings')),
    r('analytics', '/analytics', acct('shopAnalyticsView', '/account/store/analytics')),
    r('ads',       '/ads',       acct('adsView', '/account/store/ads')),
    r('affiliate', '/affiliate', acct('affiliateView', '/account/affiliate')),
    r('team',      '/team',      acct('teamView', '/account/team')),

    /* Planning */
    r('calendar',     '/calendar',     acct('agendaView', '/account/calendar')),
    r('appointments', '/appointments', acct('apptView', '/account/appointments')),

    /* Entities. Posts are canonical under their author; the flat /post/:id is the
       legacy form the app upgrades once the author is known. */
    r('post',    '/:username/post/:id', Object.assign({ world: 'home', tail: true, params: { username: 'handle', id: 'int' },
                                          aliases: ['/post/:id'], native: '/post/:id', auth: 'account' }, { privacy: 'public', seo: 'index' })),
    r('job',     '/job/:id',     { world: 'engine', params: { id: 'int' }, tail: true, next: '/job/:idslug', privacy: 'public', seo: 'index' }),
    r('listing', '/listing/:id', { world: 'engine', params: { id: 'int' }, tail: true, next: '/listing/:idslug', privacy: 'public', seo: 'index', native: '/listing/:id' }),
    r('event',   '/event/:id',   { world: 'engine', params: { id: 'int' }, tail: true, next: '/event/:idslug', privacy: 'public', seo: 'index' }),
    r('group',   '/group/:slug', { world: 'beam', params: { slug: 'slug' }, tail: true, privacy: 'public', seo: 'index' }),
    r('circle',  '/circle/:slug', { world: 'home', params: { slug: 'slug' }, tail: true, privacy: 'public', seo: 'index' }),

    /* Signed-out pages. */
    r('login',           '/login',           { world: 'auth', auth: 'public', family: 'modal', parent: null, seo: 'noindex' }),
    r('signup',          '/signup',          { world: 'auth', auth: 'public', family: 'modal', parent: null, seo: 'noindex' }),
    r('forgot-password', '/forgot-password', { world: 'auth', auth: 'public', family: 'modal', parent: null, seo: 'noindex' }),
    r('reset-password',  '/reset-password',  { world: 'auth', auth: 'public', family: 'modal', parent: null, seo: 'noindex' }),
    r('verify-email',    '/verify-email',    { world: 'auth', auth: 'public', family: 'modal', parent: null, seo: 'noindex' }),

    /* Public identity — people AND businesses share atwe.com/{username}. These are
       matched LAST, after every literal route, and never for a reserved word. */
    r('profile-section', '/:username/:section', Object.assign({ world: 'home', auth: 'peek', tail: true,
                             params: { username: 'handle', section: PROFILE_SECTIONS }, parent: 'profile' }, pub)),
    r('profile', '/:username', Object.assign({ world: 'home', auth: 'peek', tail: true, params: { username: 'handle' },
                             aliases: ['/company/:username'], native: '/user/:username' }, pub)),

    /* ── APPROVED FUTURE ADDRESSES (Route Audit §44). Data only. ── */
    r('beam-dm',        '/beam/u/:username',            { status: P, world: 'beam', params: { username: 'handle' }, parent: 'messages' }),
    r('beam-group',     '/beam/g/:id',                  { status: P, world: 'beam', params: { id: 'int' }, parent: 'messages' }),
    r('engine-search',  '/engine/search',               { status: P, world: 'engine', parent: 'search', auth: 'public', seo: 'noindex' }),
    r('service',        '/service/:idslug',             { status: P, world: 'engine', params: { idslug: 'idslug' }, privacy: 'public', seo: 'index' }),
    r('course',         '/course/:idslug',              { status: P, world: 'engine', params: { idslug: 'idslug' }, privacy: 'public', seo: 'index' }),
    r('newsletter',     '/newsletter/:idslug',          { status: P, world: 'engine', params: { idslug: 'idslug' }, privacy: 'public', seo: 'index' }),
    r('community',      '/communities/:id',             { status: P, world: 'engine', params: { id: 'int' }, privacy: 'public', seo: 'index' }),
    r('account-section','/account/:section',            { status: P, world: 'account', parent: 'me',
      params: { section: ['profile', 'money', 'selling', 'customers', 'marketing', 'jobs', 'library', 'planning', 'creating', 'ai', 'help'] } }),
    r('order-detail',   '/account/orders/:ref',         { status: P, world: 'account', params: { ref: 'slug' }, parent: 'orders' }),
    r('settings-leaf',  '/settings/:page/:leaf',        { status: P, world: 'settings', parent: 'settings-page',
      params: { page: SETTINGS_PAGES, leaf: 'slug' } }),
    r('live',           '/live/:id',                    { status: P, world: 'home', params: { id: 'slug' }, seo: 'noindex' }),
    r('media',          '/:username/post/:id/photo/:n', { status: P, world: 'home', params: { username: 'handle', id: 'int', n: 'int' },
                                                          parent: 'post', family: 'modal', seo: 'noindex' }),
  ];

  /* Words a username can never be because the ROUTER treats them as not-a-handle
     today, beyond the first segment of a live route. This is the literal defensive
     set that public/index.html's RESERVED_PATHS carries; the registry test requires
     parseReserved() to equal RESERVED_PATHS exactly, so neither can drift. */
  const PARSE_DEFENSIVE = [
    'index.html', 'admin.html', 'locked.html', 'sw.js', 'manifest.json',
    'manifest.webmanifest', 'favicon.png', 'favicon.ico', 'robots.txt', 'sitemap.xml',
    'api', 'admin', 'static', 'assets', 'public', 'cdn', 'media', 'files', 'download',
    'beam', 'engine', 'profile', 'account', 'register', 'logout', 'signin', 'signout',
    'password', 'auth', 'oauth', 'sso', 'verify', 'confirm', 'invite', 'welcome',
    'about', 'contact', 'support', 'legal', 'privacy', 'privacy-policy', 'terms',
    'terms-of-service', 'cookies', 'security', 'status', 'blog', 'press', 'careers',
    'pricing', 'plans', 'upgrade', 'pro', 'premium', 'billing', 'checkout', 'pay',
    'company', 'companies', 'business', 'organization', 'org', 'page', 'pages',
    'atwe', 'atweai', 'atwe-ai', 'official', 'staff', 'team', 'root', 'system',
    'null', 'undefined', 'true', 'false', 'me', 'you', 'new', 'edit', 'delete',
  ];

  /* Roots the SERVER owns outside the app router (server.js): /go and /__shell/*
     serve the shell, /s/:code is a smart link, /catalog/:file a feed, /_diag a deploy
     probe, /.well-known the app-association files. A member holding one of these
     would have a profile that can never be reached. */
  const SERVER_ROOTS = ['go', 's', 'catalog', '_diag', '__shell', '.well-known', 'api', 'admin'];

  /* Reserved for NEW usernames only (Route Audit §45): near-term Atwe namespaces and
     defensive words. NOT used by the router, so a member who already holds one keeps
     a working atwe.com/{name} — nobody is renamed, and no link breaks. */
  const NEAR_TERM = [
    'beam', 'engine', 'account', 'explore', 'trending', 'shorts', 'dailies', 'daily', 'stories',
    'story', 'live', 'chat', 'dm', 'inbox', 'groups', 'circles', 'lists', 'list', 'bookmarks',
    'drafts', 'compose', 'shop', 'shops', 'product', 'products', 'sell', 'selling', 'till', 'pos',
    'delivery', 'courier', 'phone', 'verification', 'certified', 'card', 'webinars', 'webinar',
    'collaborators', 'workers', 'candidates', 'call', 'calls', 'spaces', 'refunds', 'disputes',
    'returns', 'offers', 'bundles', 'coupons', 'pools', 'splits', 'waitlist', 'service', 'course',
    'newsletter', 'qr', 'features', 'guidelines', 'feedback', 'alerts', 'activity', 'discover',
    'assistant', 'hashtag', 'tag', 'tags', 'cashtag', 'www', 'mail', 'atweinc', 'atwe-inc',
    'sitemap', 'robots', 'u', 'user', 'users', 'i', 'p',
  ];

  /* File extensions a NEW username may not end in: express.static serves /public
     before the app, so atwe.com/<name>.<ext> would be a file, never a profile. */
  const FILE_EXT_RE = /\.(html?|xhtml|js|mjs|cjs|css|json|txt|xml|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|webmanifest|pdf|mp4|webm|mov|mp3|wav|ogg|m4a|woff2?|ttf|otf|eot|zip|gz|php|aspx?|jsp|cgi|env|ini|ya?ml|md|csv)$/i;

  /* ── Pattern machinery ── */
  const segsOf = (pattern) => pattern.split('/').filter(Boolean);
  const isParam = (seg) => seg.charAt(0) === ':';
  const firstLiteral = (pattern) => { const s = segsOf(pattern)[0]; return s && !isParam(s) ? s.toLowerCase() : null; };
  const liveRoutes = () => ROUTES.filter((x) => x.status === L);
  const byName = {};
  ROUTES.forEach((x) => { byName[x.name] = x; });

  function checkParam(route, key, raw) {
    const spec = route.params[key];
    if (Array.isArray(spec)) { const v = raw.toLowerCase(); return spec.includes(v) ? v : null; }
    const t = PARAM_TYPES[spec];
    if (!t || !t.test(raw)) return null;
    return t.norm(raw);
  }

  /* Split a pathname the way the app's router does: decode, drop empty segments,
     trim each one. A path that fails to decode is taken raw, as it is today. */
  function splitPath(pathname) {
    let path;
    try { path = decodeURIComponent(pathname || '/'); } catch (e) { path = pathname || '/'; }
    return path.split('/').filter(Boolean).map((x) => x.trim()).filter(Boolean);
  }

  /* Match ONE pattern against already-split segments. */
  function matchPattern(route, pattern, segs) {
    const ps = segsOf(pattern);
    if (segs.length < ps.length) return null;
    if (segs.length > ps.length && !route.tail) return null;
    const params = {};
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], s = segs[i];
      if (isParam(p)) {
        const v = checkParam(route, p.slice(1), s);
        if (v === null) return null;
        params[p.slice(1)] = v;
      } else if (p.toLowerCase() !== s.toLowerCase()) return null;
    }
    return params;
  }

  const PARSE_RESERVED = (() => {
    const set = new Set(PARSE_DEFENSIVE);
    liveRoutes().forEach((x) => [x.pattern].concat(x.aliases).forEach((p) => { const f = firstLiteral(p); if (f) set.add(f); }));
    return set;
  })();

  /* The order a path is tried in. Literal-first patterns before handle patterns, and
     within the handle family the most specific shape first. */
  const MATCH_ORDER = (() => {
    const live = liveRoutes();
    const HANDLE = ['post', 'profile-section', 'profile'];
    const handle = HANDLE.map((n) => byName[n]);
    return live.filter((x) => !HANDLE.includes(x.name)).concat(handle);
  })();

  /* Resolve a pathname to { name, params, alias } — or null when the path is not one
     Atwe owns (the caller then falls through to its default surface, as today).
     Only LIVE routes are considered; planned routes never match. */
  function match(pathname) {
    const segs = splitPath(pathname);
    if (!segs.length) return { name: 'home', params: {}, alias: false };
    for (const route of MATCH_ORDER) {
      const pats = [route.pattern].concat(route.aliases);
      for (let i = 0; i < pats.length; i++) {
        const pat = pats[i];
        // A handle-rooted pattern never claims a reserved word.
        if (isParam(segsOf(pat)[0] || '')) {
          const u = segs[0].replace(/^@/, '').toLowerCase();
          if (PARSE_RESERVED.has(u)) continue;
        }
        const params = matchPattern(route, pat, segs);
        if (params) return { name: route.name, params, alias: i > 0 };
      }
    }
    return null;
  }

  /* Build the canonical CURRENT path for a live route. Throws on a planned route or a
     missing/invalid parameter: a builder that quietly produced '/undefined' would be
     worse than one that refuses. */
  function build(name, params) {
    const route = byName[name];
    if (!route) throw new Error('unknown route: ' + name);
    if (route.status !== L) throw new Error('route is planned, not live: ' + name);
    params = params || {};
    const out = segsOf(route.pattern).map((seg) => {
      if (!isParam(seg)) return seg;
      const key = seg.slice(1), raw = params[key];
      if (raw === undefined || raw === null || raw === '') throw new Error(name + ': missing ' + key);
      const v = checkParam(route, key, String(raw));
      if (v === null) throw new Error(name + ': invalid ' + key);
      return encodeURIComponent(v);
    });
    return '/' + out.join('/');
  }

  function get(name) { return byName[name] || null; }

  /* ── Reserved-name sets ── */
  /* The words the ROUTER refuses as a handle, today. Equal to index.html's RESERVED_PATHS. */
  function parseReserved() { return [...PARSE_RESERVED].sort(); }

  /* Every first path segment a route (live or planned, current or `next`) uses. */
  function routeRoots() {
    const set = new Set();
    ROUTES.forEach((x) => [x.pattern, x.next].concat(x.aliases).forEach((p) => { if (p) { const f = firstLiteral(p); if (f) set.add(f); } }));
    return [...set].sort();
  }

  /* The union a NEW username is checked against (Route Audit §45):
     router-reserved + every route root (incl. approved future ones) + server-owned
     roots + near-term namespaces. Static filenames are added by the caller that can
     read the /public directory (server.js), since this file cannot touch a disk. */
  function allocationReserved() {
    const set = new Set(PARSE_RESERVED);
    routeRoots().forEach((x) => set.add(x));
    SERVER_ROOTS.forEach((x) => set.add(x));
    NEAR_TERM.forEach((x) => set.add(x));
    return [...set].sort();
  }

  /* The structural rule for a NEW username (Route Audit §45). Returns null when the
     shape is acceptable, else a sentence a member can act on. Existing usernames are
     grandfathered by the CALLER (it skips this for a name the account already holds);
     this function never looks at who holds what. */
  function usernameShapeError(name) {
    const n = String(name || '');
    if (!n) return 'Choose a username.';
    if (n.length > 40) return 'Username is too long.';
    if (!/^[A-Za-z0-9._-]+$/.test(n)) return 'Username can use letters, numbers, dots, dashes and underscores.';
    if (!/^[A-Za-z0-9]/.test(n) || !/[A-Za-z0-9]$/.test(n)) return 'A username has to start and end with a letter or a number.';
    if (n.includes('..')) return 'A username can’t have two dots in a row.';
    if (FILE_EXT_RE.test(n)) return 'A username can’t end like a file name.';
    return null;
  }

  /* Notification destination kinds → the route that should open. Data-level only:
     the in-app notification rows still use their own handlers. */
  const NOTIF_TARGETS = {
    post: 'post', profile: 'profile', listing: 'listing', job: 'job', event: 'event',
    group: 'group', circle: 'circle', wallet: 'wallet', orders: 'orders', order: 'order-detail',
    message: 'beam-dm', settings: 'settings', devices: 'devices', invoices: 'invoices',
    quotes: 'quotes', calendar: 'calendar', store: 'store', analytics: 'analytics',
  };

  return {
    version: 1,
    ROUTES, PARAM_TYPES, SETTINGS_PAGES, PROFILE_SECTIONS, PARSE_DEFENSIVE, SERVER_ROOTS,
    NEAR_TERM, FILE_EXT_RE, NOTIF_TARGETS,
    get, match, build, splitPath, firstLiteral, liveRoutes,
    parseReserved, routeRoots, allocationReserved, usernameShapeError,
  };
});
