#!/usr/bin/env node
/**
 * Does the server actually send what the app says it sends?
 *
 * TypeScript agrees with whatever it is told. Declare `sender_id: number` on a
 * payload that carries a nested `sender` object and nothing fails — the value is
 * simply undefined forever, and whatever it drives silently never renders. That
 * exact mistake shipped: group messages showed no name and no face for a whole
 * slice, and a whole group read as one unbroken run from nobody. Two more turned
 * up the first time this ran: every order row dropped the "from …" line because
 * it read buyerName/sellerName instead of the buyer/seller objects the server
 * sends, and Settings told every account its email was "Not verified" because it
 * read `emailVerified` where the wire says `email_verified`.
 *
 * So: fetch each endpoint from a real server and check that every field each
 * interface names is genuinely there.
 *
 *   REQUIRED field missing  -> a bug, near enough always.
 *   OPTIONAL field missing  -> look at it. It may be conditional (ppvCents rides
 *                             only on a locked post) or only on another endpoint
 *                             (moreFromSeller is on the detail, not the list) —
 *                             or it may be wrong, as buyerName was.
 *
 * Run it against a server with a POPULATED account. An empty list proves nothing
 * and is reported as skipped, never as a pass.
 *
 *   TOK=<bearer> UN=<username> [BASE=http://localhost:3000] \
 *     node tools/check-api-types.js
 */
const fs = require('fs');
const path = require('path');

const T = process.env.TOK;
const B = process.env.BASE || 'http://localhost:3000';
const UN = process.env.UN;
/* The About tab needs an account that has actually filled one in; the runner's
   own usually has not, and an empty array is reported as skipped, not passed. */
const UN_ABOUT = process.env.UN_ABOUT || UN;
if (!T || !UN) {
  console.error('Set TOK (a bearer token) and UN (that account\'s username).');
  process.exit(2);
}
const H = { Authorization: 'Bearer ' + T };
const API = path.join(__dirname, '..', 'src', 'api');
const SRC = fs.readdirSync(API)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => fs.readFileSync(path.join(API, f), 'utf8'))
  .join('\n');
const TYPES = fs.readFileSync(path.join(API, 'types.ts'), 'utf8');

/** The top-level `name: T;` / `name?: T;` fields of one exported interface. */
function declared(iface) {
  /* `extends` has to be allowed through. An interface written
     `export interface TeamMember extends Party {` did not match a pattern that
     went straight from the name to the brace, so the checker reported it as
     "no such interface" and SKIPPED it — a silent hole that looks identical to
     a type that genuinely has no example to check against.

     Only the interface's OWN fields are read; anything it inherits belongs to
     the parent, which is checked under its own name. */
  const m = new RegExp(`export interface ${iface}(?:\\s+extends\\s+[^{]+)?\\s*{`, 'm').exec(SRC + TYPES);
  if (!m) return null;
  const src = SRC + TYPES;
  let i = m.index + m[0].length, depth = 1, body = '';
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) break; }
    body += ch; i++;
  }
  // Only depth-0 lines: a field nested inside an inline object literal type is
  // that object's, not this interface's.
  /* Break on a newline OR a semicolon, but ONLY at depth 0.
     Two lessons are baked in here, each of which broke this parser once:
     - a line can declare SEVERAL fields (`id: number; name: string;`), and
       reading only the first made the checker quietly verify a fraction of what
       it claimed — ShowcaseAuthor reported "2 fields" for an interface with six;
     - splitting on every semicolon then tore INLINE OBJECT LITERALS apart, so
       `requester?: { id: number; name: string }` reported `name` and `username`
       as missing top-level fields. They are nested, and nested fields belong to
       their own object, not to this interface. Depth is what tells them apart. */
  const lines = []; let d = 0, cur = '';
  for (const ch of body) {
    if (ch === '{') d++;
    else if (ch === '}') d--;
    if ((ch === '\n' || ch === ';') && d === 0) { lines.push(cur); cur = ''; }
    else if (ch !== '\n') cur += ch;
  }
  lines.push(cur);
  return lines
    .map((l) => l.replace(/\/\*[^]*?\*\//g, '').trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/'))
    .map((l) => {
      const m2 = /^([A-Za-z_]\w*)(\??)\s*:/.exec(l);
      return m2 ? { name: m2[1], optional: m2[2] === '?' } : null;
    })
    .filter(Boolean);
}

const CASES = [
  ['Post',           '/api/social/feed?scope=foryou',        (j) => j.posts[0]],
  ['PostAuthor',     '/api/social/feed?scope=foryou',        (j) => j.posts[0].author],
  ['Conversation',   '/api/atchat/conversations',            (j) => j.conversations[0]],
  ['DmMessage',      null,                                   null],  // filled in below
  ['Group',          '/api/atchat/groups',                   (j) => j.groups[0]],
  ['GroupMessage',   null,                                   null],
  ['GroupSender',    null,                                   null],
  ['StoryTrayEntry', '/api/stories',                         (j) => j.tray[0]],
  ['Story',          null,                                   null],
  ['Notification',   '/api/notifications',                   (j) => j.notifications[0]],
  ['NotifActor',     '/api/notifications',                   (j) => j.notifications[0].actor],
  ['WalletTx',       '/api/wallet',                          (j) => j.transactions[0]],
  ['WalletData',     '/api/wallet',                          (j) => j],
  ['CashoutStatus',  '/api/wallet/cashout-status',           (j) => j],
  ['MoneyRequest',   '/api/wallet/requests?scope=incoming',  (j) => j.requests[0]],
  ['Listing',        '/api/marketplace',                     (j) => j.listings[0]],
  ['ListingSeller',  '/api/marketplace',                     (j) => j.listings[0].seller],
  ['Order',          '/api/orders?scope=buyer',              (j) => j.orders[0]],
  ['OrderParty',     '/api/orders?scope=buyer',              (j) => j.orders[0].seller],
  ['OrderItem',      '/api/orders?scope=buyer',              (j) => j.orders[0].items[0]],
  ['SuggestUser',    '/api/social/suggestions',              (j) => j.users[0]],
  ['Trend',          '/api/social/trending',                 (j) => j.trends[0]],
  ['SearchUser',     '/api/search?scope=people&q=a',         (j) => j.users[0]],
  ['Profile',        `/api/social/profile/${UN}`,            (j) => j],
  ['ProfileUser',    `/api/social/profile/${UN}`,            (j) => j.user],
  ['Address',        '/api/addresses',                       (j) => j.addresses[0]],
  ['Appointment',    '/api/appointments?scope=mine',         (j) => j.appointments[0]],
  ['ApptParty',      '/api/appointments?scope=mine',         (j) => j.appointments[0].business],
  ['Service',        null,                                   null],  // needs a business id
  ['SlotsResult',    null,                                   null],
  ['Review',         null,                                   null],
  ['Reviewer',       null,                                   null],
  ['ReviewSummary',  null,                                   null],
  ['Quote',          null,                                   null],  // a POST; see below
  ['Eta',            null,                                   null],
  ['Job',            '/api/jobs',                            (j) => j.jobs[0]],
  ['JobPoster',      '/api/jobs',                            (j) => j.jobs[0].poster],
  ['ScreeningQuestion', null,                                null],  // needs a job that asks
  ['Applicant',      null,                                   null],  // needs a job of my own
  ['WorkerListing',  '/api/worker-listings',                 (j) => j.workers[0]],
  ['JobMatch',       null,                                   null],  // a POST; see below
  ['Showcase',       '/api/showcases?scope=discover',        (j) => j.showcases[0]],
  ['ShowcaseAuthor', '/api/showcases?scope=discover',        (j) => j.showcases[0].author],
  ['Newsletter',     '/api/newsletters?scope=discover',      (j) => j.newsletters[0]],
  ['Community',      '/api/communities?scope=discover',      (j) => j.communities[0]],
  ['Course',         '/api/courses?scope=discover',          (j) => j.courses[0]],
  ['Lesson',         null,                                   null],  // needs a course with lessons
  ['ServiceListing', '/api/services',                        (j) => j.services[0]],
  ['ServiceProvider','/api/services',                        (j) => j.services[0].provider],
  ['LocalResults',   '/api/local',                           (j) => j],
  ['DirectoryBusiness', '/api/businesses/directory',         (j) => j.businesses[0]],
  ['AtweEvent',      '/api/events?scope=upcoming',           (j) => j.events[0]],
  ['EventHost',      '/api/events?scope=upcoming',           (j) => j.events[0].host],
  ['Attendee',       null,                                   null],  // needs an event id
  // Social: polls, quotes, lists, close friends, highlights.
  ['Poll',           null,                                   null],  // needs a poll post
  ['PollOption',     null,                                   null],
  ['QuotedPost',     null,                                   null],  // needs a quote post
  ['UserList',       '/api/social/lists',                    (j) => j.lists[0]],
  ['Highlight',      `/api/highlights?username=${UN}`,       (j) => j.highlights[0]],
  ['HighlightItem',  `/api/highlights?username=${UN}`,       (j) => j.highlights[0].items[0]],
  // Beam's rarer corners.
  ['StarredItem',    '/api/atchat/starred',                  (j) => j.items[0]],
  ['ChatPrefs',      '/api/atchat/prefs',                    (j) => j],
  ['ChatLabel',      '/api/atchat/labels',                   (j) => j.labels[0]],
  ['ScheduledMessage', '/api/atchat/scheduled',              (j) => j.scheduled[0]],
  ['BroadcastList',  '/api/atchat/broadcasts',               (j) => j.lists[0]],
  ['MessageHit',     '/api/atchat/messages/search?q=oak',    (j) => j.items[0]],
  ['BroadcastDetail', null,                                  null],  // needs a list id
  // Selling: coupons, bundles, offers, product Q&A.
  ['Coupon',         '/api/coupons',                         (j) => j.coupons[0]],
  ['Bundle',         '/api/my-bundles',                      (j) => j.bundles[0]],
  ['BundleItem',     '/api/my-bundles',                      (j) => j.bundles[0].items[0]],
  ['Offer',          '/api/offers',                          (j) => j.offers[0]],
  ['QaQuestion',     null,                                   null],  // needs a product id
  ['QaAnswer',       null,                                   null],  // needs a product id
  ['BizAnalytics',   '/api/business/analytics',              (j) => j],
  ['TeamResponse',   '/api/business/team',                   (j) => j],
  ['TeamMember',     '/api/business/team',                   (j) => j.members[0]],
  ['CartRecovery',   '/api/cart-recovery/settings',          (j) => j],
  ['Membership',     null,                                   null],  // needs an invite to me
  ['ShipRate',       null,                                   null],  // needs a shipping provider
  // The profile's About tab.
  ['Experience',     '/api/social/profile/' + UN_ABOUT,      (j) => j.experiences[0]],
  ['Education',      '/api/social/profile/' + UN_ABOUT,      (j) => j.education[0]],
  ['Certification',  '/api/social/profile/' + UN_ABOUT,      (j) => j.certifications[0]],
  ['Skill',          '/api/social/profile/' + UN_ABOUT,      (j) => j.skills[0]],
  ['Recommendation', null,                                   null],  // needs one written
  // Money. Several need a seeded example, so they are checked from whichever
  // list the account genuinely has; a bare `null` is reported as skipped, never
  // as a pass.
  ['GiftCard',       '/api/gift-cards',                      (j) => j.cards[0]],
  ['Invoice',        '/api/invoices?scope=received',         (j) => j.invoices[0]],
  ['LineItem',       '/api/quotes?scope=received',           (j) => j.quotes[0].items[0]],
  ['WorkQuote',      '/api/quotes?scope=received',           (j) => j.quotes[0]],
  ['Party',          '/api/invoices?scope=received',         (j) => j.invoices[0].issuer],
  ['Loyalty',        '/api/loyalty',                         (j) => j],
  ['LoyaltyTx',      '/api/loyalty',                         (j) => j.transactions[0]],
  ['Referrals',      '/api/referrals',                       (j) => j],
  ['ReferralMilestone', '/api/referrals',                    (j) => j.milestones[0]],
  ['Split',          '/api/splits?scope=owed',               (j) => j.splits[0]],
  ['SplitShare',     '/api/splits?scope=owed',               (j) => j.splits[0].shares[0]],
  ['Pool',           '/api/pools?scope=mine',                (j) => j.pools[0]],
  ['PoolContribution', null,                                 null],  // detail-only; needs a pool id
  ['ScheduledPayment', '/api/scheduled-payments?scope=outgoing', (j) => j.payments[0]],
  ['PaymentLink',    '/api/payment-links',                   (j) => j.links[0]],
  ['ProductSubscription', '/api/product-subscriptions',      (j) => j.subscriptions[0]],
  ['User',           '/api/auth/me',                         (j) => j.user],
  ['AppConfig',      '/api/config',                          (j) => j],
];

const get = async (p) => {
  const r = await fetch(B + p, { headers: H });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

(async () => {
  // Three cases need an id this account actually has.
  try {
    const gl = await get('/api/atchat/groups');
    const gid = gl.groups?.[0]?.id;
    if (gid) {
      CASES[5][1] = `/api/atchat/groups/${gid}`; CASES[5][2] = (j) => j.messages.at(-1);
      CASES[6][1] = `/api/atchat/groups/${gid}`; CASES[6][2] = (j) => j.messages.at(-1)?.sender;
    }
    const cl = await get('/api/atchat/conversations');
    const pid = cl.conversations?.[0]?.id;
    if (pid) { CASES[3][1] = `/api/atchat/with/${pid}`; CASES[3][2] = (j) => j.messages.at(-1); }
    const tray = await get('/api/stories');
    const su = tray.tray?.[0]?.user?.id;
    if (su) { CASES[8][1] = `/api/stories/${su}`; CASES[8][2] = (j) => j.stories[0]; }
  } catch { /* leave those three skipped */ }

  // Services and slots hang off a business id, which comes from an appointment
  // this account already has — the only business it is certain to be able to see.
  try {
    const appts = await get('/api/appointments?scope=mine');
    const bid = appts.appointments?.[0]?.business?.id;
    if (bid) {
      const si = CASES.findIndex(([n]) => n === 'Service');
      CASES[si][1] = `/api/business/${bid}/services`; CASES[si][2] = (j) => j.services[0];
      const li = CASES.findIndex(([n]) => n === 'SlotsResult');
      CASES[li][1] = `/api/business/${bid}/slots?days=7`; CASES[li][2] = (j) => j;
      const ri = CASES.findIndex(([n]) => n === 'Review');
      CASES[ri][1] = `/api/business/${bid}/reviews`; CASES[ri][2] = (j) => j.reviews[0];
      const wi = CASES.findIndex(([n]) => n === 'Reviewer');
      CASES[wi][1] = `/api/business/${bid}/reviews`; CASES[wi][2] = (j) => j.reviews[0].reviewer;
      const mi = CASES.findIndex(([n]) => n === 'ReviewSummary');
      CASES[mi][1] = `/api/business/${bid}/reviews`; CASES[mi][2] = (j) => j.summary;
    }
  } catch { /* leave them skipped */ }

  // A lesson only exists inside a course that has one.
  try {
    const cs = await get('/api/courses?scope=discover');
    const withLessons = (cs.courses || []).find((c) => c.lessonCount > 0) || cs.courses?.[0];
    if (withLessons) {
      const i = CASES.findIndex(([n]) => n === 'Lesson');
      CASES[i][1] = `/api/courses/${withLessons.id}`;
      CASES[i][2] = (j) => j.course.lessons?.[0];
    }
  } catch { /* leave it skipped */ }

  // An attendee list hangs off an event this account can see.
  try {
    const evs = await get('/api/events?scope=upcoming');
    const ev = (evs.events || []).find((e) => e.going > 0) || evs.events?.[0];
    if (ev) {
      const i = CASES.findIndex(([n]) => n === 'Attendee');
      CASES[i][1] = `/api/events/${ev.id}/attendees`;
      CASES[i][2] = (j) => j.attendees[0];
    }
  } catch { /* leave it skipped */ }

  /* Jobs: a screening question only exists on a job that asks one, an applicant
     only on a job I posted, and the match score is a POST. All three are found
     from the live board rather than hard-coded, so this keeps working on any
     account. */
  let jobMatch = null;
  try {
    const board = await get('/api/jobs');
    const withScreening = (board.jobs || []).find((j) => (j.screening || []).length);
    if (withScreening) {
      const si = CASES.findIndex(([n]) => n === 'ScreeningQuestion');
      CASES[si][1] = `/api/jobs/${withScreening.id}`;
      CASES[si][2] = (j) => j.job.screening[0];
    }
    const mine = (board.jobs || []).find((j) => j.mine && j.applicants);
    if (mine) {
      const ai = CASES.findIndex(([n]) => n === 'Applicant');
      CASES[ai][1] = `/api/jobs/${mine.id}/applicants`;
      CASES[ai][2] = (j) => j.applicants[0];
    }
    const other = (board.jobs || []).find((j) => !j.mine);
    if (other) {
      const r = await fetch(B + `/api/jobs/${other.id}/match`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}',
      });
      if (r.ok) jobMatch = await r.json();
    }
  } catch { /* leave them skipped */ }

  // The checkout quote is a POST, so it needs its own little request rather than
  // the shared GET. Priced against a real listing and a real saved address, or
  // it proves nothing.
  let quote = null;
  try {
    const [addrs, market] = await Promise.all([get('/api/addresses'), get('/api/marketplace')]);
    const addr = addrs.addresses?.[0];
    const p = (market.listings || []).find((l) => !l.soldOut && !l.hasVariants);
    if (addr && p) {
      const r = await fetch(B + '/api/checkout/quote', {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'buy', productId: p.id, qty: 1, addressId: addr.id }),
      });
      if (r.ok) quote = await r.json();
    }
  } catch { /* leave Quote / Eta skipped */ }

  let bad = 0, soft = 0, checked = 0;
  const skipped = [];
  if (jobMatch) {
    const mi = CASES.findIndex(([n]) => n === 'JobMatch');
    CASES[mi][1] = '__jobmatch'; CASES[mi][2] = () => jobMatch;
  }
  if (quote) {
    const qi = CASES.findIndex(([n]) => n === 'Quote');
    CASES[qi][1] = '__quote'; CASES[qi][2] = () => quote;
    const ei = CASES.findIndex(([n]) => n === 'Eta');
    if (quote.eta) { CASES[ei][1] = '__quote'; CASES[ei][2] = () => quote.eta; }
  }
  for (const [iface, url, pick] of CASES) {
    const want = declared(iface);
    if (!want) { skipped.push(`${iface} (no such interface)`); continue; }
    if (!url) { skipped.push(`${iface} (no example in this account)`); continue; }
    let live;
    try { live = (url === '__quote' || url === '__jobmatch') ? pick(null) : pick(await get(url)); }
    catch (e) { skipped.push(`${iface} (${e.message})`); continue; }
    if (!live || typeof live !== 'object') { skipped.push(`${iface} (nothing to compare)`); continue; }
    checked++;
    const have = new Set(Object.keys(live));
    const missReq = want.filter((f) => !f.optional && !have.has(f.name)).map((f) => f.name);
    const missOpt = want.filter((f) => f.optional && !have.has(f.name)).map((f) => f.name);
    if (missReq.length) { bad++; console.log(`FAIL ${iface}: required but never sent -> ${missReq.join(', ')}`); }
    if (missOpt.length) { soft++; console.log(`note ${iface}: optional and absent here -> ${missOpt.join(', ')}`); }
    if (!missReq.length && !missOpt.length) console.log(`ok   ${iface} (${want.length} fields)`);
  }
  console.log(`\n${checked} interfaces checked · ${bad} with a REQUIRED field the server never sends · ${soft} with optional gaps to eyeball`);
  if (skipped.length) console.log('skipped (nothing to compare against):\n  ' + skipped.join('\n  '));
  process.exit(bad ? 1 : 0);
})();
