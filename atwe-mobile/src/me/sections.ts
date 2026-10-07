import type { Ionicons } from '@expo/vector-icons';
import type { User } from '@/api/types';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export interface MeItem {
  /** The label, or a function of the account when it depends on state. */
  l: string | ((u: User) => string);
  ic: IconName;
  /** Where it goes. Everything here is a real screen — see the note below. */
  to: string;
  /** The words a non-technical person would actually type looking for it. */
  kw: string;
  /** Hidden entirely when this returns false. */
  when?: (u: User) => boolean;
  danger?: boolean;
  /** A staff-only row reads a step quieter, so it does not look like another
   *  thing the app offers. */
  staff?: boolean;
}

export interface MeSection {
  id: string;
  title: string;
  ic: IconName;
  /** One line naming what is inside. NOT drawn under the section name on the
   *  hub — the founder's call on the web: the names carry it. It is here for
   *  the search results and as the section's own description. */
  sub: string;
  items: MeItem[];
  /** Rendered as its OWN card at the top level instead of a row in the sections
   *  list — still a real section underneath. */
  solo?: boolean;
}

/**
 * The Account page, and the app-wide search index, from ONE table — the web's
 * `ME_SECTIONS`, same ids, same order, same titles and subtitles.
 *
 * It replaced a flat list of ~35 rows under uppercase headings, which is the
 * shape the web itself abandoned: no phone screen holds a list that long, and
 * the groups had drifted into junk drawers. The top level is section rows; each
 * opens a page of its own.
 *
 * WHAT IS NOT HERE, AND WHY. The web has eleven sections; four of them
 * (Customers, Creating, Atwe AI, Help & feedback) have no screen on the phone
 * yet, and a section that opens empty is worse than one that is honestly
 * absent, so they are left out rather than stubbed. Individual rows are missing
 * for the same reason. Nothing that WAS reachable has been dropped: every route
 * the old page linked to is still here or behind Manage store, which is exactly
 * where the web files it too.
 */
export const ME_SECTIONS: MeSection[] = [
  {
    id: 'profile', title: 'Profile', ic: 'create-outline',
    sub: 'Your details, and who sees your Dailies',
    items: [
      { l: 'Edit profile', ic: 'person-outline', to: '/edit-profile',
        kw: 'profile picture photo banner bio headline about edit change name avatar image' },
      { l: 'Close friends', ic: 'people-circle-outline', to: '/close-friends',
        kw: 'close friends private story daily audience list' },
    ],
  },
  {
    id: 'money', title: 'Money', ic: 'wallet-outline',
    sub: 'Wallet, payments, invoices and rewards',
    items: [
      { l: 'Wallet', ic: 'wallet-outline', to: '/wallet',
        kw: 'wallet balance money cash funds' },
      { l: 'Send money', ic: 'paper-plane-outline', to: '/wallet-send',
        kw: 'send money pay transfer cash someone' },
      { l: 'Money requests', ic: 'download-outline', to: '/wallet-requests',
        kw: 'money requests request payment ask for money owe' },
      { l: 'Add money', ic: 'add-circle-outline', to: '/wallet-topup',
        kw: 'add money top up load funds deposit' },
      { l: 'Cash out to a bank', ic: 'business-outline', to: '/wallet-cashout',
        kw: 'cash out withdraw bank payout transfer out' },
      { l: 'Invoices', ic: 'receipt-outline', to: '/invoices',
        kw: 'invoices bill billing get paid invoice' },
      { l: 'Quotes', ic: 'document-text-outline', to: '/quotes',
        kw: 'quotes estimates proposal quote price' },
      { l: 'Split a bill', ic: 'pie-chart-outline', to: '/splits',
        kw: 'split a bill share cost divide splitwise' },
      { l: 'Money pools', ic: 'people-circle-outline', to: '/pools',
        kw: 'money pools fundraising collection chip in goal' },
      { l: 'Scheduled payments', ic: 'calendar-outline', to: '/scheduled-payments',
        kw: 'scheduled payments standing order recurring payment automatic' },
      { l: 'Payment links', ic: 'link-outline', to: '/payment-links',
        kw: 'payment links pay link collect payment' },
      { l: 'Gift cards', ic: 'gift-outline', to: '/gift-cards',
        kw: 'gift cards voucher redeem code present giftcard balance' },
      { l: 'Rewards', ic: 'ribbon-outline', to: '/rewards',
        kw: 'rewards points loyalty cashback tier' },
      { l: 'Invite friends', ic: 'person-add-outline', to: '/referrals',
        kw: 'invite friends referral bonus refer earn' },
    ],
  },
  {
    id: 'selling', title: 'Selling', ic: 'storefront-outline',
    sub: 'Your listings, store and offers',
    items: [
      { l: 'My listings', ic: 'pricetag-outline', to: '/sell',
        kw: 'sell listings products items shop catalog add product new listing' },
      { l: 'Manage store', ic: 'storefront-outline', to: '/store',
        kw: 'manage store storefront shop settings selling bundles coupons team' },
      { l: 'Offers', ic: 'swap-horizontal-outline', to: '/offers',
        kw: 'offers negotiate price haggle bids' },
      { l: 'Offer a service', ic: 'construct-outline', to: '/offer-service',
        kw: 'offer a service freelance trade skill hire me' },
    ],
  },
  {
    id: 'growth', title: 'Marketing', ic: 'megaphone-outline',
    sub: 'What you have sold, and who is looking',
    items: [
      { l: 'Sales & analytics', ic: 'stats-chart-outline', to: '/sales',
        kw: 'sales analytics revenue reports stats numbers earned' },
      { l: 'Business analytics', ic: 'analytics-outline', to: '/business-analytics',
        kw: 'business analytics reach followers views insights',
        when: (u) => u.accountType === 'business' },
    ],
  },
  {
    id: 'jobs', title: 'Jobs & hiring', ic: 'briefcase-outline',
    sub: 'Hiring, applications and finding work',
    items: [
      { l: 'Post a job', ic: 'add-circle-outline', to: '/post-job',
        kw: 'post a job hire hiring vacancy role recruit' },
      { l: 'Jobs I posted', ic: 'briefcase-outline', to: '/jobs?scope=mine',
        kw: 'jobs i posted my jobs hiring listings vacancy' },
      { l: 'My applications', ic: 'send-outline', to: '/jobs?scope=applied',
        kw: 'my applications applied jobs status' },
      { l: 'Saved jobs', ic: 'bookmark-outline', to: '/jobs?scope=saved',
        kw: 'saved jobs bookmarked jobs' },
      { l: 'Find workers', ic: 'people-outline', to: '/workers',
        kw: 'find workers candidates talent hire people open to work' },
    ],
  },
  {
    id: 'library', title: 'Orders & saved', ic: 'bag-handle-outline',
    sub: 'Orders, subscriptions and saved things',
    items: [
      { l: 'Orders', ic: 'receipt-outline', to: '/orders',
        kw: 'orders purchases my orders bought receipts tracking delivery parcel' },
      { l: 'Cart', ic: 'bag-outline', to: '/cart',
        kw: 'cart basket checkout buy shopping trolley bag' },
      { l: 'Addresses', ic: 'location-outline', to: '/addresses',
        kw: 'addresses shipping address delivery address home' },
      { l: 'Subscriptions', ic: 'repeat-outline', to: '/subscriptions',
        kw: 'subscriptions recurring subscribe and save' },
      { l: 'Lists', ic: 'list-outline', to: '/lists',
        kw: 'lists timelines curated feeds' },
      { l: 'My courses', ic: 'school-outline', to: '/courses',
        kw: 'my courses learning lessons classes study' },
      { l: 'Newsletters', ic: 'mail-open-outline', to: '/newsletters',
        kw: 'newsletters articles issues subscribe' },
      { l: 'Showcase', ic: 'images-outline', to: '/showcase',
        kw: 'showcase portfolio work projects gallery photos images' },
    ],
  },
  {
    id: 'app', title: 'Help & feedback', ic: 'help-circle-outline',
    /* `solo` — its own card at the top level rather than a row in the sections
       list, but still a real section: the search indexes its rows and the
       section page opens normally. The web does the same. */
    solo: true,
    sub: 'Get help, or tell us what went wrong',
    items: [
      { l: 'Help', ic: 'help-circle-outline', to: 'https://atwe.com/help.html',
        kw: 'help support faq contact us guide how do i' },
      { l: 'Send feedback', ic: 'chatbox-ellipses-outline', to: '/feedback',
        kw: 'send feedback report a problem bug idea suggestion complain tell us' },
    ],
  },
  {
    id: 'planning', title: 'Planning', ic: 'calendar-outline',
    sub: 'Appointments and events',
    items: [
      { l: 'Appointments', ic: 'calendar-number-outline', to: '/appointments',
        kw: 'appointments bookings schedule visits' },
      { l: 'Events', ic: 'ticket-outline', to: '/events',
        kw: 'events rsvp attend tickets meetup' },
    ],
  },
];

/**
 * Top-level rows that are not a category — Settings is the thing people reach
 * for most and should not be buried a level down. Its own card, below the
 * sections, the way the web has it.
 */
export const ME_HUB_TAIL: MeItem[] = [
  { l: 'Settings', ic: 'settings-outline', to: '/settings',
    kw: 'settings preferences options configuration account app' },
  /* Its own card under Settings. `to` opens the real section page, so the entry
     lives here only to sit at the top level rather than inside the list. */
  { l: 'Help & feedback', ic: 'help-circle-outline', to: '/me/app',
    kw: 'help feedback support report a problem contact us faq' },
];

/** On the hub itself, under everything — the way Settings keeps Sign Out at the
 *  bottom of the account page rather than filing it under a heading. */
export const ME_HUB_FOOT: MeItem[] = [
  { l: 'Log out', ic: 'log-out-outline', to: '', kw: 'log out sign out logout exit', danger: true },
];

/** A destination that leaves the app. Help is a web page, not a screen, and
 *  `router.push` on an http URL silently does nothing. */
export const meExternal = (to: string) => /^https?:\/\//.test(to);

/** The label, resolved — some depend on the account (plan, verification). */
export const meLabel = (it: MeItem, u: User) => (typeof it.l === 'function' ? it.l(u) : it.l);

/** A section's rows this account can actually see. */
export const meItems = (s: MeSection, u: User) => s.items.filter((i) => !i.when || i.when(u));

/** A section with nothing left in it would advertise a page that opens empty. */
/** The rows of the top-level sections card — solo sections are excluded, since
 *  they get a card of their own. */
export const meSections = (u: User) =>
  ME_SECTIONS.filter((s) => !s.solo && meItems(s, u).length > 0);

/** Every section, solo included — what SEARCH looks through, because a row is
 *  no less findable for living in a card of its own. */
export const meAllSections = (u: User) => ME_SECTIONS.filter((s) => meItems(s, u).length > 0);

export const meSection = (id: string) => ME_SECTIONS.find((s) => s.id === id);

/** Every destination on this page, flattened, for the search bar. Ranked the
 *  way the web's `acFindPlaces` ranks: an exact name, then a prefix, then a
 *  whole word, then anywhere — name before keywords at every step. */
export function meFind(q: string, u: User) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const words = needle.split(/\s+/).filter(Boolean);
  const out: { item: MeItem; section: MeSection; score: number }[] = [];
  for (const s of meAllSections(u)) {
    for (const item of meItems(s, u)) {
      const name = meLabel(item, u).toLowerCase();
      const kw = item.kw.toLowerCase();
      let score = 0;
      if (name === needle) score = 100;
      else if (name.startsWith(needle)) score = 82;
      else if (new RegExp(`\\b${escapeRe(needle)}`).test(name)) score = 64;
      else if (words.every((w) => new RegExp(`\\b${escapeRe(w)}`).test(`${name} ${kw}`))) score = 50;
      else if (name.includes(needle)) score = 48;
      else if (kw.includes(needle)) score = 30;
      if (score) out.push({ item, section: s, score: score - name.length * 0.05 });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 40);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
