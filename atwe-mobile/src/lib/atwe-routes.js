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
    /* A public entity's `{id}-{slug}` (route batch 7). The id is AUTHORITATIVE and the slug
       decorative: any text after "<id>-" is accepted (an old slug, a wrong one, none at all)
       and the app replaces the address with the entity's CURRENT slug once it has loaded.
       norm keeps the slug as written (lower-cased) and drops leading zeros from the id. */
    idslug: { test: (s) => /^\d{1,12}(-[^/]{0,200})?$/.test(s), norm: (s) => s.replace(/^0+(?=\d)/, '').toLowerCase() },
  };

  /* ── THE ONE SLUG RULE (route batch 7) ── used by the app, the server and the tests, so a
     card, a share link, a notification and the router can never disagree about an entity's
     canonical address. The slug is COMPUTED from the entity's current title — nothing is
     stored — so a renamed listing keeps its id and simply gains a new canonical slug. A
     title with no Latin letters or digits (Hebrew, Arabic, CJK, emoji) has an empty slug and
     the canonical address is the bare id. */
  const SLUG_MAX = 60;
  function slugify(title) {
    let s = String(title == null ? '' : title);
    try { s = s.normalize('NFKD'); } catch (e) {}
    s = s.replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/-[^-]*$/, '') || s.slice(0, SLUG_MAX);
    return s.replace(/-+$/, '');
  }
  /* The canonical `{id}-{slug}` segment for an entity. */
  function idSlug(id, title) {
    const n = parseInt(id, 10);
    if (!Number.isInteger(n) || n < 0) throw new Error('idSlug: invalid id ' + id);
    const sl = slugify(title);
    return sl ? n + '-' + sl : String(n);
  }
  /* Read an `{id}-{slug}` segment back: { id, slug } (slug null when absent) or null. */
  function parseIdSlug(seg) {
    const m = /^(\d{1,12})(?:-(.*))?$/.exec(String(seg || ''));
    return m ? { id: parseInt(m[1], 10), slug: m[2] === undefined ? null : m[2] } : null;
  }

  /* The Settings tree (route batch 4). A page is /settings/<page>; its title is the
     page's own header. A leaf is /settings/<page>/<leaf>, rendered by its own sheet
     (`view`), and its logical parent is its page. Only the approved leaves are here:
     transient flows (change email / username / password, pause, deactivate, link a
     device, feedback, the theme and ordinary switches) deliberately have NO address. */
  const SETTINGS_TREE = [
    ['account', 'Your account'], ['privacy', 'Privacy & safety'], ['security', 'Security & access'],
    ['notifications', 'Notifications'], ['premium', 'Premium'], ['display', 'Display & accessibility'],
    ['assistant', 'Atwe Assistant'], ['data', 'Your data & storage'], ['about', 'About'],
  ];
  const SETTINGS_PAGES = SETTINGS_TREE.map((x) => x[0]);
  const SETTINGS_LEAVES = [
    ['account', 'delete', 'deleteAccountOverlay', 'Delete account'],
    ['privacy', 'contact', 'privacyOverlay', 'Who can contact you'],
    ['privacy', 'blocked', 'blockedOverlay', 'Blocked accounts'],
    ['privacy', 'muted', 'mutedOverlay', 'Muted accounts'],
    ['privacy', 'muted-words', 'mutedWordsOverlay', 'Muted words'],
    ['privacy', 'last-seen', 'lastSeenHiddenOverlay', 'Hidden from'],
    /* /devices is the pre-batch-4 address; it stays an ALIAS so every link already issued
       keeps working: the server 301s it (route batch 9) and the app canonicalises it in place. */
    ['security', 'devices', 'devicesOverlay', 'Devices & sessions', { aliases: ['/devices'] }],
    ['security', '2fa', 'twoFaView', 'Two-factor authentication'],
    ['security', 'passkeys', 'passkeysView', 'Passkeys'],
    ['security', 'locks', 'lockedSectionsOverlay', 'Locked sections'],
    ['notifications', 'phone', 'phoneOverlay', 'Your number'],
    ['premium', 'creator', 'creatorSubView', 'Creator subscriptions'],
    ['display', 'language', 'langView', 'Language'],
    ['display', 'currency', 'currencyView', 'Currency'],
    ['data', 'history', 'historyView', 'Posts you’ve read'],
    ['about', 'whats-new', 'changelogView', 'What’s new'],
  ];
  const PROFILE_SECTIONS = ['posts', 'replies', 'media', 'likes', 'about', 'connections'];

  /* The Account tree (route batch 5). The Account ROOT is the live `me` route — today at
     /me, with /account recorded as its `next` for the batch-8 world-root flip. Its CHILDREN
     already live under /account/..., and each names `me` (or one of its sections) as its
     logical parent, so the batch-8 flip changes the root's pattern and nothing below it.

     A SECTION is /account/<key>, rendered inside the Account page itself (no overlay). The
     URL key is the approved one; the page's own section id differs for two of them
     (marketing is the page's `growth`, help is its `app`) and that binding lives in the app.
     A TOOL is a routed overlay under /account; its logical parent is the section whose row
     opens it in the live Account page. `aliases` are the flat addresses issued before batch
     5 — permanent: the server 301s them (route batch 9, legacyRedirect) and the app
     canonicalises them in place. */
  const ACCOUNT_SECTIONS = [
    ['profile', 'Profile'], ['money', 'Money'], ['selling', 'Selling'], ['customers', 'Customers'],
    ['marketing', 'Marketing'], ['jobs', 'Jobs & hiring'], ['library', 'Orders & saved'],
    ['planning', 'Planning'], ['creating', 'Creating'], ['ai', 'Atwe AI'], ['help', 'Help & feedback'],
  ];
  /* name, path under /account, overlay, parent section, title, flat alias (or null), extra */
  const ACCOUNT_TOOLS = [
    ['wallet',         'wallet',          'walletView',        'money',     'Wallet',          '/wallet'],
    ['money-requests', 'money-requests',  'moneyRequestsView', 'money',     'Money requests',  '/money-requests'],
    ['invoices',       'invoices',        'invoicesView',      'money',     'Invoices',        '/invoices'],
    ['quotes',         'quotes',          'quotesView',        'money',     'Quotes',          '/quotes'],
    ['payment-links',  'payment-links',   'payLinkView',       'money',     'Payment links',   '/payment-links'],
    ['gift-cards',     'gift-cards',      'giftCardView',      'money',     'Gift cards',      '/gift-cards'],
    ['rewards',        'rewards',         'loyaltyView',       'money',     'Rewards',         '/rewards'],
    ['referrals',      'referrals',       'referView',         'money',     'Invite friends',  '/referrals'],
    ['card',           'card',            'debitCardView',     'money',     'Atwe Card',       null],
    ['store',          'store',           'storeManageView',   'selling',   'Manage store',    '/store'],
    ['listings',       'store/listings',  'sellView',          'selling',   'My listings',     '/listings'],
    /* The seller's side of the Orders overlay: same view as /account/orders, opened on its
       Seller tab. `sharedView` names the route that owns the overlay by default. */
    ['store-orders',   'store/orders',    'ordersView',        'selling',   'Store orders',    null, { sharedView: 'orders' }],
    ['coupons',        'store/coupons',   'couponsView',       'selling',   'Coupons',         null],
    ['bundles',        'store/bundles',   'bundlesView',       'selling',   'Bundles',         null],
    /* Sales & analytics and the Ads Manager live in the Marketing section of the live page,
       so that is their logical parent, whatever their path says about the store. */
    ['analytics',      'store/analytics', 'shopAnalyticsView', 'marketing', 'Sales & analytics', '/analytics'],
    ['ads',            'store/ads',       'adsView',           'marketing', 'Ads Manager',     '/ads'],
    ['dashboard',      'dashboard',       'dashboardView',     'selling',   'Business dashboard', '/dashboard'],
    ['team',           'team',            'teamView',          'selling',   'Team',            '/team'],
    ['till',           'till',            'tillView',          'selling',   'The till',        null],
    ['delivery',       'delivery',        'deliveryView',      'selling',   'Local delivery',  null],
    ['phone',          'phone',           'phoneView',         'selling',   'Business phone number', null],
    ['verification',   'verification',    'idVerifyView',      'profile',   'Verify your identity', null],
    ['pro',            'pro',             'proView',           'profile',   'Atwe Pro',        null],
    ['affiliate',      'affiliate',       'affiliateView',     'marketing', 'Affiliate program', '/affiliate'],
    ['orders',         'orders',          'ordersView',        'library',   'Orders',          '/orders'],
    ['saved',          'saved',           'savedView',         'library',   'Saved items',     '/saved'],
    ['subscriptions',  'subscriptions',   'subsView',          'library',   'Subscriptions',   '/subscriptions'],
    ['addresses',      'addresses',       'addressesView',     'library',   'Addresses',       '/addresses'],
    ['bookings',       'bookings',        'bookingsView',      'library',   'Bookings',        '/bookings'],
    ['calendar',       'calendar',        'agendaView',        'planning',  'Calendar',        '/calendar'],
    ['appointments',   'appointments',    'apptView',          'planning',  'Appointments',    '/appointments'],
    ['resumes',        'resumes',         'resumesList',       'jobs',      'Resumes',         '/resumes'],
    ['job-alerts',     'job-alerts',      'savedSearches',     'jobs',      'Job alerts',      '/job-alerts'],
    /* "My network" is a row of the Profile section in the live page. */
    ['network',        'network',         'connList',          'profile',   'My network',      '/network'],
  ];

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
     native   set from NATIVE below (route batch 10): what the phone app does with it */
  const L = 'live', P = 'planned';
  const r = (name, pattern, o) => Object.assign({ name, pattern, status: L, tail: false,
    world: 'global', view: null, auth: 'account', privacy: 'private', seo: 'private',
    family: 'hierarchy', parent: 'history', aliases: [], next: null, native: null, params: {}, title: null }, o || {});
  const pub = { auth: 'public', privacy: 'public', seo: 'index' };

  const ROUTES = [
    /* The five worlds (+ the AI inside page). Route batch 8 switched the roots on: Beam is
       /beam, Engine /engine, Account /account. The addresses they replaced (/messages,
       /search, /me and the older /profile) are permanent ALIASES, canonicalised in the app
       by replace, and the server 301s them (route batch 9). The route NAMES did not move — every parent in
       this file still says 'messages' / 'search' / 'me', and that is the point. */
    r('home',      '/',          { world: 'home', family: 'root', parent: null, aliases: ['/feed', '/home', '/go'] }),
    r('messages',  '/beam',      { world: 'beam', family: 'root', parent: null, aliases: ['/messages'] }),
    r('search',    '/engine',    { world: 'engine', family: 'root', parent: null, aliases: ['/search'], seo: 'noindex' }),
    r('me',        '/account',   { world: 'account', family: 'root', parent: null, aliases: ['/me', '/profile'] }),
    r('notifications', '/notifications', { world: 'notifications', family: 'root', parent: null, view: 'notifOverlay' }),
    r('ai',        '/ai',        { world: 'ai', parent: 'history' }),

    /* Settings — its own global namespace (Route Audit §19, option B), and since route
       batch 4 a real URL HIERARCHY: the hub, nine pages, and the approved leaves. The URL
       alone names the destination. Nothing here is a tail route any more: an unknown
       /settings/<x> or /settings/<page>/<x> matches NOTHING, so it can never silently
       render some other valid page. */
    r('settings',       '/settings',       { world: 'settings', view: 'settingsOverlay', title: 'Settings' }),
    ...SETTINGS_TREE.map(([page, title]) => r('settings-' + page, '/settings/' + page,
      { world: 'settings', view: 'settingsOverlay', parent: 'settings', title })),
    ...SETTINGS_LEAVES.map(([page, leaf, view, title, extra]) => r('settings-' + page + '-' + leaf, '/settings/' + page + '/' + leaf,
      Object.assign({ world: 'settings', view, parent: 'settings-' + page, title }, extra || {}))),
    r('help',           '/help',           Object.assign({ view: 'helpOverlay', world: 'global' }, pub)),

    /* Engine browse (route batch 7): canonical under /engine/<x>. The flat /<x> each one
       was issued at is a permanent ALIAS that the app canonicalises by replace (the server
       301 is route batch 9, legacyRedirect). The Engine ROOT has been /engine since batch 8. */
    r('jobs',        '/engine/jobs',        { world: 'engine', aliases: ['/jobs'], parent: 'search' }),
    r('businesses',  '/engine/businesses',  Object.assign({ world: 'engine', view: 'bizDirectory', aliases: ['/businesses'], parent: 'search' }, pub)),
    r('services',    '/engine/services',    Object.assign({ world: 'engine', view: 'servicesView', aliases: ['/services'], parent: 'search' }, pub)),
    r('events',      '/engine/events',      Object.assign({ world: 'engine', view: 'eventsList', aliases: ['/events'], parent: 'search' }, pub)),
    r('courses',     '/engine/courses',     Object.assign({ world: 'engine', view: 'coursesView', aliases: ['/courses'], parent: 'search' }, pub)),
    r('newsletters', '/engine/newsletters', Object.assign({ world: 'engine', view: 'nlList', aliases: ['/newsletters'], parent: 'search' }, pub)),
    r('communities', '/engine/communities', Object.assign({ world: 'engine', view: 'commList', aliases: ['/communities'], parent: 'search' }, pub)),
    r('showcase',    '/engine/showcase',    Object.assign({ world: 'engine', view: 'showcaseDiscover', aliases: ['/showcase'], parent: 'search' }, pub)),

    /* Shopping */
    r('marketplace', '/engine/marketplace', Object.assign({ world: 'engine', view: 'marketplaceView', aliases: ['/marketplace'], parent: 'search' }, pub)),
    r('cart',        '/cart',        { world: 'engine', view: 'cartView', family: 'modal' }),
    r('collections',   '/collections',   { world: 'home', parent: 'home' }),

    /* Account (route batch 5): the eleven sections and the Account-owned tools, all under
       /account and all private. Their parents climb to `me`, the Account root. */
    ...ACCOUNT_SECTIONS.map(([key, title]) => r('account-' + key, '/account/' + key,
      { world: 'account', parent: 'me', title })),
    ...ACCOUNT_TOOLS.map(([name, sub, view, section, title, alias, extra]) => r(name, '/account/' + sub,
      Object.assign({ world: 'account', view, parent: 'account-' + section, title, aliases: alias ? [alias] : [] }, extra || {}))),

    /* Entities. Posts are canonical under their author; the flat /post/:id is the
       legacy form the app upgrades once the author is known. */
    r('post',    '/:username/post/:id', Object.assign({ world: 'home', tail: true, params: { username: 'handle', id: 'int' },
                                          aliases: ['/post/:id'], auth: 'account' }, { privacy: 'public', seo: 'index' })),
    /* Typed public entities (route batch 7): SHORT typed permalinks, never nested under
       /engine. `{id}-{slug}`: the id is authoritative, the slug decorative (see idslug).
       /listing, /job and /event keep `tail` — a trailing segment was tolerated before and
       an issued link must not break. A direct entry's App Back falls to the browse parent;
       real history always wins. */
    r('job',     '/job/:idslug',     { world: 'engine', params: { idslug: 'idslug' }, tail: true, parent: 'jobs', privacy: 'public', seo: 'index' }),
    r('listing', '/listing/:idslug', { world: 'engine', params: { idslug: 'idslug' }, tail: true, parent: 'marketplace', privacy: 'public', seo: 'index' }),
    r('event',   '/event/:idslug',   { world: 'engine', params: { idslug: 'idslug' }, tail: true, parent: 'events', privacy: 'public', seo: 'index' }),
    r('service', '/service/:idslug', { world: 'engine', params: { idslug: 'idslug' }, parent: 'services', privacy: 'public', seo: 'index' }),
    r('course',  '/course/:idslug',  { world: 'engine', params: { idslug: 'idslug' }, parent: 'courses', privacy: 'public', seo: 'index' }),
    r('newsletter', '/newsletter/:idslug', { world: 'engine', params: { idslug: 'idslug' }, parent: 'newsletters', privacy: 'public', seo: 'index' }),
    r('newsletter-issue', '/newsletter/:id/issue/:issue', { world: 'engine', params: { id: 'int', issue: 'int' }, parent: 'newsletter', privacy: 'public', seo: 'index' }),
    r('community', '/communities/:id', { world: 'engine', params: { id: 'int' }, parent: 'communities', privacy: 'public', seo: 'index' }),
    r('group',   '/group/:slug', { world: 'beam', params: { slug: 'slug' }, tail: true, privacy: 'public', seo: 'index' }),
    /* A Showcase item (route batch 8). The FOUNDER'S shape: /showcase/{id}, NO slug — the
       id alone reconstructs it (GET /api/showcases/:id). Its browse page is the parent. */
    r('showcase-detail', '/showcase/:id', { world: 'engine', params: { id: 'int' }, parent: 'showcase', privacy: 'public', seo: 'index' }),

    /* Beam conversations (route batch 8). PRIVATE addresses: the conversation is read only if
       the server says this member may read it, and a conversation that is not theirs answers
       exactly as one that does not exist. A group's public /group/{slug} above is a
       DIFFERENT thing (its shareable page) and is left exactly as it was.
       Extra threads with one person are /beam/u/{username}/{threadId}; the main chat is the
       bare /beam/u/{username}. Their logical parent is the inbox, /beam. */
    r('beam-dm',         '/beam/u/:username',         { world: 'beam', params: { username: 'handle' }, parent: 'messages' }),
    r('beam-thread',     '/beam/u/:username/:thread', { world: 'beam', params: { username: 'handle', thread: 'int' }, parent: 'messages' }),
    r('beam-group',      '/beam/g/:id',               { world: 'beam', params: { id: 'int' }, parent: 'messages' }),
    r('beam-group-info', '/beam/g/:id/info',          { world: 'beam', params: { id: 'int' }, parent: 'beam-group' }),
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
                             aliases: ['/company/:username'] }, pub)),

    /* ── APPROVED FUTURE ADDRESSES (Route Audit §44). Data only. ── */
    /* /beam/u/{username}/contact stays PLANNED (route batch 8): Beam has no contact card of
       its own — the conversation header's picture opens the person's PROFILE, and building a
       contact page just to give it an address would be inventing a feature. */
    r('beam-contact',   '/beam/u/:username/contact',    { status: P, world: 'beam', params: { username: 'handle' }, parent: 'beam-dm' }),
    r('engine-search',  '/engine/search',               { status: P, world: 'engine', parent: 'search', auth: 'public', seo: 'noindex' }),
    /* Route batch 7 left these planned, each for a recorded reason:
       · /engine/search — the live app has no committed search-results state: results are a
         live function of the text box (debounced per keystroke) and the jobs/services/
         companies scopes render with no query at all, so "landing" vs "results" is not a
         structural distinction an address can name without a brittle heuristic.
       · /engine/workers — "Find workers" is the Jobs board's other side (AC._jobBoard), not
         a standalone destination.
       · Showcase DETAIL: the audit gave it both /showcase/{id} and {id}-{slug}; the FOUNDER
         DECIDED (Batch-7 pre-close) /showcase/{id}, no slug. Batch 8 made it live, above.
       Batch 8 kept /engine/search planned for the same reason as batch 7: nothing changed
       about how search works, and an address must not be invented for it. */
    r('engine-workers', '/engine/workers',              { status: P, world: 'engine', parent: 'search', auth: 'public' }),
    /* PRIVATE DETAILS STAY PLANNED (route batch 5 audit): orders, wallet transactions,
       invoices and quotes are keyed only by sequential SERIAL ids today, and a private
       detail must not be addressable by an enumerable id. They go live only once each row
       carries an opaque ref (a schema change, deliberately not part of a routing batch). */
    r('order-detail',   '/account/orders/:ref',         { status: P, world: 'account', params: { ref: 'slug' }, parent: 'orders' }),
    r('store-order-detail', '/account/store/orders/:ref', { status: P, world: 'account', params: { ref: 'slug' }, parent: 'store-orders' }),
    r('wallet-tx',      '/account/wallet/tx/:ref',      { status: P, world: 'account', params: { ref: 'slug' }, parent: 'wallet' }),
    /* Approved Account destinations with no screen in the product yet: vacation mode is a
       switch inside Manage store, and there is no Certified surface. */
    r('store-pause',    '/account/store/pause',         { status: P, world: 'account', parent: 'store' }),
    r('certified',      '/account/certified',           { status: P, world: 'account', parent: 'account-selling' }),
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

  /* ── WHAT THE PHONE APP DOES WITH EACH ADDRESS (route batch 10) ──
     Every LIVE route says, explicitly, one of two things:
       · a NATIVE target — the atwe-mobile (expo-router) path that genuinely renders it.
         `:param` is filled from the matched route's params; an `idslug` param fills it
         with its numeric id, because every native detail screen is keyed by id;
       · BROWSER — the app has no screen for it, so the iPhone must NOT capture the link
         (it is excluded in the AASA) and Safari opens it.
     An object { resolve, to } means the native screen needs a value the URL does not
     carry (a Beam DM is keyed by the peer's numeric id; the URL by their @username), so
     the app asks the server first — the same authorising lookup the web uses.
     A route with no entry here is a test failure (test/native-links.test.js): no address
     may silently fall through. Only map a route to a screen that EXISTS in atwe-mobile/app. */
  const BROWSER = 'browser';
  const NATIVE = {
    home: '/', messages: '/beam', search: '/engine', me: '/profile', notifications: '/notifications', ai: '/ai',
    settings: '/settings',
    'settings-account': '/settings/account', 'settings-privacy': '/settings/privacy',
    'settings-security': '/settings/security', 'settings-notifications': '/settings/notifications',
    'settings-display': '/settings/display', 'settings-data': '/settings/data', 'settings-about': '/settings/about',
    'settings-premium': BROWSER, 'settings-assistant': BROWSER,
    help: BROWSER,
    jobs: '/jobs', businesses: '/businesses', services: '/services', events: '/events', courses: '/courses',
    newsletters: '/newsletters', communities: '/communities', showcase: '/showcase', marketplace: '/marketplace',
    cart: '/cart', collections: BROWSER,
    /* The native Account page's own section ids: marketing is its `growth`, help its `app`
       (the same two the web binds in index.html). It has no customers/creating/ai section. */
    'account-profile': '/me/profile', 'account-money': '/me/money', 'account-selling': '/me/selling',
    'account-marketing': '/me/growth', 'account-jobs': '/me/jobs', 'account-library': '/me/library',
    'account-planning': '/me/planning', 'account-help': '/me/app',
    'account-customers': BROWSER, 'account-creating': BROWSER, 'account-ai': BROWSER,
    wallet: '/wallet', 'money-requests': '/wallet-requests', invoices: '/invoices', quotes: '/quotes',
    'payment-links': '/payment-links', 'gift-cards': '/gift-cards', rewards: '/rewards', referrals: '/referrals',
    card: BROWSER, store: '/store', listings: '/sell', 'store-orders': '/orders?tab=seller',
    coupons: '/coupons', bundles: '/bundles', analytics: '/sales', ads: BROWSER, dashboard: BROWSER,
    team: '/team', till: BROWSER, delivery: BROWSER, phone: BROWSER, verification: BROWSER, pro: BROWSER,
    affiliate: BROWSER, orders: '/orders', saved: BROWSER, subscriptions: '/subscriptions',
    addresses: '/addresses', bookings: BROWSER, calendar: BROWSER, appointments: '/appointments',
    resumes: BROWSER, 'job-alerts': BROWSER, network: BROWSER,
    post: '/post/:id',
    job: '/job/:idslug', listing: '/listing/:idslug', event: '/event/:idslug', service: '/service/:idslug',
    course: '/course/:idslug', newsletter: '/newsletter/:idslug', 'newsletter-issue': '/newsletter/issue/:issue',
    community: '/community/:id', 'showcase-detail': '/showcase/:id',
    /* A public group page is keyed by SLUG and is a different surface from the conversation
       (native group screens are the member's chat, by id); a circle has no native screen. */
    group: BROWSER, circle: BROWSER,
    'beam-dm': { resolve: 'peer', to: '/chat/:peer' },
    /* The native conversation has no extra threads and no group-info page. */
    'beam-thread': BROWSER, 'beam-group': '/group/:id', 'beam-group-info': BROWSER,
    /* Sign-in pages stay on the web: reset and verify carry one-time tokens the app has no
       screen for, and ?next= sign-in returns are a web flow. */
    login: BROWSER, signup: BROWSER, 'forgot-password': BROWSER, 'reset-password': BROWSER, 'verify-email': BROWSER,
    /* The native profile has no addressable section tabs (and no Connections tab). */
    'profile-section': BROWSER,
    profile: '/user/:username',
  };
  /* Every Settings LEAF (a sheet: devices, 2FA, muted words…) stays in the browser: the
     native Settings pages show those controls inline, with no addressable sheet of their own. */
  SETTINGS_LEAVES.forEach(([page, leaf]) => { NATIVE['settings-' + page + '-' + leaf] = BROWSER; });
  Object.keys(NATIVE).forEach((n) => { if (byName[n]) byName[n].native = NATIVE[n]; });

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

  /* ── THE LEGACY REDIRECT TABLE (route batch 9) ──
     The canonical address a PURE path rename now lives at, or null when `pathname` is not
     a legacy alias. It is DERIVED from every live route's `aliases`, so the server's 301
     table and the app's own client-side canonicalisation can never disagree about where an
     old address went. Data only: no database, no lookups.
       · /messages → /beam, /search → /engine, /me and /profile → /account
       · /devices → /settings/security/devices
       · every flat Account / Engine word → its /account/... or /engine/... address
       · /home, /feed → /
     NOT here, deliberately:
       · /post/:id — the canonical address needs the AUTHOR, which only the server can
         look up (it 301s itself, and only for a public post);
       · /company/:username — the audit KEEPS it as a working alias (its page declares
         /username as canonical instead);
       · /go — a server-owned shell path, never reached by the router;
       · the typed entities' stale or missing slug — that needs the entity's CURRENT title.
     The query string is the caller's to keep. */
  const NO_REDIRECT_ALIAS = { post: true, profile: true };
  function legacyRedirect(pathname) {
    const m = match(pathname);
    if (!m || !m.alias || NO_REDIRECT_ALIAS[m.name]) return null;
    const segs = splitPath(pathname);
    if (segs.length && segs[0].toLowerCase() === 'go') return null;
    let to;
    try { to = build(m.name, m.params); } catch (e) { return null; }
    return to;
  }

  /* ── A SAFE post-sign-in destination (route batch 9) ──
     The ONE answer to "where may sign-in send this person afterwards?". Returns an
     Atwe-local path (+ its query) or null. It never returns anything a browser could
     treat as another origin:
       · must start with exactly one "/" — never "//host", never "/\host";
       · no backslash, no control character, no whitespace, raw OR percent-decoded;
       · resolved against a dummy origin and refused unless the origin is unchanged
         (catches every scheme: javascript:, data:, https:, and their encodings);
       · must be a LIVE Atwe route (match()), never a sign-in page (no loops);
       · a legacy alias is canonicalised (legacyRedirect) on the way through.
     The query is kept, minus one-time secrets (token / verify / reset) and `next` itself;
     the hash is dropped. */
  const NEXT_DROP_PARAMS = ['next', 'token', 'verify', 'reset', 'imp'];
  const BAD_CHARS = /[\u0000- \u007f\\]/;
  function safeNext(raw) {
    if (typeof raw !== 'string') return null;
    const v = raw.trim();
    if (!v || v.length > 600) return null;
    if (v.charAt(0) !== '/' || v.charAt(1) === '/' || BAD_CHARS.test(v)) return null;
    // The PATH, percent-decoded, must be just as clean (a %2F%2F or %5C in it is refused).
    // The query is re-parsed and re-serialised below, so an encoded space there is fine.
    const rawPath = v.split(/[?#]/)[0];
    let dec;
    try { dec = decodeURIComponent(rawPath); } catch (e) { return null; }
    if (dec.charAt(0) !== '/' || dec.charAt(1) === '/' || /[\u0000-\u001f\u007f\\]/.test(dec)) return null;
    const BASE = 'https://atwe.invalid';
    let u;
    try { u = new URL(v, BASE); } catch (e) { return null; }
    if (u.origin !== BASE) return null;
    const m = match(u.pathname);
    if (!m) return null;
    const route = byName[m.name];
    if (!route || route.world === 'auth') return null;
    const path = legacyRedirect(u.pathname) || u.pathname;
    const q = new URLSearchParams(u.search);
    NEXT_DROP_PARAMS.forEach((k) => q.delete(k));
    const qs = q.toString();
    return path + (qs ? '?' + qs : '');
  }

  /* ══ NATIVE LINKS (route batch 10) ═══════════════════════════════════════════
     ONE answer, shared by the AASA file and the phone app, to "does the installed iPhone
     app open this address, and where?". The AASA `components` are GENERATED from the
     routes above (appLinkComponents), the app decides by EVALUATING those same components
     (appLinkAllows), so an address the iPhone hands to the app is by construction an
     address the app claims — and one it hands to Safari is one the app would not render.
     tools/native-links.js writes public/.well-known/apple-app-site-association from this,
     and copies this file into atwe-mobile, byte for byte; test/native-links.test.js fails
     if either drifts. */

  /* A query parameter the WEB app acts on (a token, a payment, an invite, a sign-in
     return). The phone has no handler for any of them, so a link carrying one stays in
     the browser whatever its path — never opened natively with the action silently lost. */
  const WEB_ACTION_QUERY = [
    'ad', 'aff', 'boost', 'call', 'cashout', 'checkout', 'coupon', 'creatorsub', 'go', 'imp', 'invoice',
    'joingroup', 'next', 'nlsub', 'order', 'pack', 'pay', 'paylink', 'pool', 'promote', 'ref', 'reset',
    's', 'ticket', 'tip', 'token', 'topup', 'u', 'verify', 'waitlist',
  ];
  /* Hosts that serve Atwe. www and the secondary domains 301 to atwe.com keeping the path
     (server.js), so a link on any of them means the same atwe.com address. atwe.ai's bare
     root lands on /ai (it was the AI product). */
  const OWN_HOSTS = ['atwe.com', 'www.atwe.com', 'atwe.app', 'www.atwe.app', 'atwe.co', 'www.atwe.co', 'atwe.ai', 'www.atwe.ai'];
  const FILE_EXTS = String(FILE_EXT_RE.source).replace(/^\\\.\((.*)\)\$$/, '$1');

  const aasaPath = (pattern) => '/' + segsOf(pattern).map((s) => (isParam(s) ? '*' : s.toLowerCase())).join('/');
  const comp = (path, exclude, extra) => Object.assign({ '/': path }, extra || {},
    exclude ? { exclude: true } : {}, { caseSensitive: false });
  const nativeOk = (route) => !!route.native && route.native !== BROWSER;

  /* The ordered AASA components. First match wins, exactly as iOS evaluates them. */
  let _components = null;
  function appLinkComponents() {
    if (_components) return _components.map((c) => Object.assign({}, c));
    const out = [];
    // 1. A web action in the query keeps ANY address in the browser.
    WEB_ACTION_QUERY.forEach((k) => { const q = {}; q[k] = '*'; out.push(comp('*', true, { '?': q })); });
    // 2. Server-owned and internal roots, and every static file the server serves.
    SERVER_ROOTS.forEach((w) => { out.push(comp('/' + w, true)); out.push(comp('/' + w + '/*', true)); });
    FILE_EXTS.split('|').forEach((x) => {
      // FILE_EXT_RE alternatives are small regexes (html?, jpe?g, woff2?, ya?ml, aspx?) — expand them.
      const forms = /\?/.test(x) ? [x.replace(/.\?/, ''), x.replace(/\?/, '')] : [x];
      forms.forEach((f) => out.push(comp('*.' + f, true)));
    });
    // 3. Router-reserved words that are not a route root: never a profile, never ours to open.
    const live = liveRoutes();
    const roots = new Set();
    live.forEach((x) => [x.pattern].concat(x.aliases).forEach((p) => { const f = firstLiteral(p); if (f) roots.add(f); }));
    [...PARSE_RESERVED].sort().forEach((w) => {
      if (roots.has(w) || SERVER_ROOTS.includes(w)) return;
      out.push(comp('/' + w, true)); out.push(comp('/' + w + '/*', true));
    });
    // 4. Literal-rooted routes, grouped by their first segment; the most specific first,
    //    then the rest of that root goes to the browser.
    out.push(comp('/', !nativeOk(byName.home)));
    [...roots].sort().forEach((root) => {
      if (SERVER_ROOTS.includes(root)) return;
      const pats = [];
      live.forEach((x) => [x.pattern].concat(x.aliases).forEach((p) => {
        if (firstLiteral(p) === root) pats.push({ route: x, p, n: segsOf(p).length });
      }));
      pats.sort((a, b) => (b.n - a.n) || (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
      pats.forEach(({ route, p }) => {
        const ex = !nativeOk(route);
        out.push(comp(aasaPath(p), ex));
        if (route.tail) out.push(comp(aasaPath(p) + '/*', ex));
      });
      out.push(comp('/' + root, true)); out.push(comp('/' + root + '/*', true));
    });
    // 5. Handle-rooted: a post, the profile sections, then the profile itself (tail).
    out.push(comp('/*/post/*', !nativeOk(byName.post)));
    PROFILE_SECTIONS.forEach((s) => {
      const ex = !nativeOk(byName['profile-section']);
      out.push(comp('/*/' + s, ex)); out.push(comp('/*/' + s + '/*', ex));
    });
    out.push(comp('/*', !nativeOk(byName.profile)));
    _components = out;
    return appLinkComponents();
  }

  /* Evaluate the components the way iOS does: `*` is any run of characters (slashes
     included), `?` one character, case-insensitive; a `?` dictionary requires each named
     query item to be present with a matching value. No match = not a universal link. */
  const _globRe = {};
  function globRe(g) {
    if (!_globRe[g]) _globRe[g] = new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return _globRe[g];
  }
  function parseQuery(search) {
    const out = {};
    String(search || '').replace(/^\?/, '').split('&').forEach((kv) => {
      if (!kv) return;
      const i = kv.indexOf('=');
      const k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      let dk = k, dv = v;
      try { dk = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) {}
      try { dv = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) {}
      if (!(dk in out)) out[dk] = dv;
    });
    return out;
  }
  function appLinkMatch(pathname, search) {
    const path = pathname || '/';
    const q = parseQuery(search);
    const list = appLinkComponents();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!globRe(c['/']).test(path)) continue;
      if (c['?'] && !Object.keys(c['?']).every((k) => k in q && globRe(c['?'][k]).test(q[k]))) continue;
      return { index: i, component: c, allow: !c.exclude };
    }
    return { index: -1, component: null, allow: false };
  }
  function appLinkAllows(pathname, search) { return appLinkMatch(pathname, search).allow; }

  /* Fill a native template from a matched route's params. */
  function fillNative(tpl, route, params) {
    const qi = tpl.indexOf('?');
    const path = qi < 0 ? tpl : tpl.slice(0, qi), query = qi < 0 ? '' : tpl.slice(qi);
    const filled = path.split('/').map((seg) => {
      if (!isParam(seg)) return seg;
      const key = seg.slice(1);
      let v = params[key];
      if (route.params[key] === 'idslug') { const p = parseIdSlug(v); v = p ? String(p.id) : null; }
      if (v === undefined || v === null || v === '') throw new Error('native: missing ' + key);
      return encodeURIComponent(v);
    }).join('/');
    return filled + query;
  }

  /* Split any Atwe link — https://atwe.com/…, another of our hosts, the app's own
     atwe://… scheme, or a bare /path (a push payload) — into { path, search }.
     Returns null for a link that is not Atwe's at all. */
  function splitAtweUrl(url) {
    const s = String(url == null ? '' : url).trim();
    if (!s) return null;
    let m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/i.exec(s);
    if (m) {
      const scheme = m[1].toLowerCase();
      if (scheme === 'atwe') {
        // atwe://beam/u/sam — the "host" is really the first path segment.
        const path = '/' + [m[2]].concat(m[3].split('/')).filter(Boolean).join('/');
        return { path, search: m[4] || '' };
      }
      if (scheme !== 'http' && scheme !== 'https') return null;
      const host = m[2].replace(/:\d+$/, '').toLowerCase().replace(/^[^@]*@/, '');
      if (!OWN_HOSTS.includes(host)) return null;
      let path = m[3] || '/';
      if ((host === 'atwe.ai' || host === 'www.atwe.ai') && (path === '/' || path === '')) path = '/ai';
      return { path, search: m[4] || '' };
    }
    m = /^atwe:([^?#]*)(\?[^#]*)?/i.exec(s);
    if (m) return { path: '/' + m[1].split('/').filter(Boolean).join('/'), search: m[2] || '' };
    if (s.charAt(0) === '/' && s.charAt(1) !== '/') {
      m = /^([^?#]*)(\?[^#]*)?/.exec(s);
      return { path: m[1] || '/', search: m[2] || '' };
    }
    return null;
  }

  /* What the phone app does with a link. Always one of:
       { kind: 'native',   path, route }          open this native screen
       { kind: 'resolve',  resolve, value, to, route }  look `value` up on the server, then open `to`
       { kind: 'notfound', path: '/', route: null }  ours, but no such page: home + a notice
       { kind: 'browser',  url, route }           hand the canonical https address to the browser
     or null when the link is not Atwe's. `url` is always the canonical atwe.com address. */
  function nativeLink(url) {
    const parts = splitAtweUrl(url);
    if (!parts) return null;
    const { path, search } = parts;
    const m = match(path);
    const route = m ? byName[m.name] : null;
    const webPath = (m && legacyRedirect(path)) || path;
    const webUrl = 'https://atwe.com' + (webPath || '/') + (search || '');
    if (!appLinkAllows(path, search)) return { kind: 'browser', url: webUrl, route: route ? route.name : null };
    if (!route || !nativeOk(route)) return { kind: 'notfound', path: '/', route: null };
    if (typeof route.native === 'object') {
      const key = Object.keys(route.params)[0];
      return { kind: 'resolve', resolve: route.native.resolve, value: m.params[key], to: route.native.to, route: route.name };
    }
    try { return { kind: 'native', path: fillNative(route.native, route, m.params), route: route.name }; }
    catch (e) { return { kind: 'notfound', path: '/', route: null }; }
  }

  /* The whole apple-app-site-association document. */
  function aasaDocument(appIDs) {
    return { applinks: { details: [{ appIDs: appIDs.slice(), components: appLinkComponents() }] } };
  }

  /* Notification destination kinds → the route that should open. Data-level only:
     the in-app notification rows still use their own handlers. */
  const NOTIF_TARGETS = {
    post: 'post', profile: 'profile', listing: 'listing', job: 'job', event: 'event',
    group: 'group', circle: 'circle', wallet: 'wallet', orders: 'orders', order: 'order-detail',
    message: 'beam-dm', settings: 'settings', devices: 'settings-security-devices', invoices: 'invoices',
    quotes: 'quotes', calendar: 'calendar', store: 'store', analytics: 'analytics',
  };

  return {
    version: 1,
    ROUTES, PARAM_TYPES, SETTINGS_PAGES, SETTINGS_TREE, SETTINGS_LEAVES, PROFILE_SECTIONS, PARSE_DEFENSIVE, SERVER_ROOTS,
    ACCOUNT_SECTIONS, ACCOUNT_TOOLS,
    NEAR_TERM, FILE_EXT_RE, NOTIF_TARGETS,
    get, match, build, splitPath, firstLiteral, liveRoutes, slugify, idSlug, parseIdSlug,
    parseReserved, routeRoots, allocationReserved, usernameShapeError,
    legacyRedirect, safeNext,
    BROWSER, NATIVE, WEB_ACTION_QUERY, OWN_HOSTS, appLinkComponents, appLinkMatch, appLinkAllows,
    splitAtweUrl, nativeLink, aasaDocument,
  };
});
