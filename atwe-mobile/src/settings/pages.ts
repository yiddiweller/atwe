import type { Ionicons } from '@expo/vector-icons';
import type { User } from '@/api/types';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export interface SetPage {
  id: string;
  label: string;
  /** The one line under the name. iPhone Settings has one on every row and it
   *  is the difference between a list you scan and a list you read. */
  sub: string;
  ic: IconName;
  kw: string;
  when?: (u: User) => boolean;
  /** A row that leaves Settings entirely rather than opening a sub-page. */
  to?: string;
}

/**
 * Settings, in the web's own information architecture and its own groups.
 *
 * The phone had uppercase headings over an Appearance segmented control, a
 * block of read-only account facts, and a column of Discover links that
 * duplicated the Engine tab — nothing like the web, which is exactly what the
 * founder called out.
 *
 * WHAT IS MISSING, AND WHY. The web has eleven rows; four of them (Security &
 * access, Premium & verification, Atwe Assistant, Your data & storage) have no
 * screen on the phone yet. A row that opens an empty page is worse than one
 * that is honestly absent, so they are not here. Everything the old Settings
 * screen could reach still is.
 */
export const SET_GROUPS: SetPage[][] = [
  [
    { id: 'account', label: 'Your account', sub: 'Account info and your plan',
      ic: 'person-outline', kw: 'account name username email plan verified two factor' },
    { id: 'privacy', label: 'Privacy & safety', sub: 'Who can reach you, and what you share',
      ic: 'shield-outline', kw: 'privacy safety read receipts private browsing who can contact presence last seen' },
    { id: 'notifications', label: 'Notifications', sub: 'Push alerts on this device',
      ic: 'notifications-outline', kw: 'notifications push alerts sounds badges mute' },
  ],
  [
    { id: 'store', label: 'Manage store', sub: 'Products, coupons, orders & storefront',
      ic: 'bag-handle-outline', kw: 'manage store storefront shop products coupons orders',
      to: '/store', when: (u) => u.accountType === 'business' },
  ],
  [
    { id: 'display', label: 'Display & accessibility', sub: 'Theme, and the taps you feel',
      ic: 'moon-outline', kw: 'display accessibility theme dark light appearance haptics vibration' },
    { id: 'about', label: 'About', sub: 'Version and legal',
      ic: 'information-circle-outline', kw: 'about version build legal terms privacy policy' },
  ],
];

export const SET_PAGES = SET_GROUPS.flat();
export const setPage = (id: string) => SET_PAGES.find((p) => p.id === id);
export const setGroups = (u: User) =>
  SET_GROUPS.map((g) => g.filter((p) => !p.when || p.when(u))).filter((g) => g.length > 0);

/** The search bar at the top of the hub, ranked like the Account page's. */
export function setFind(q: string, u: User) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return setGroups(u).flat()
    .map((p) => {
      const name = p.label.toLowerCase();
      let score = 0;
      if (name === needle) score = 100;
      else if (name.startsWith(needle)) score = 82;
      else if (name.includes(needle)) score = 48;
      else if (`${p.sub} ${p.kw}`.toLowerCase().includes(needle)) score = 30;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}
