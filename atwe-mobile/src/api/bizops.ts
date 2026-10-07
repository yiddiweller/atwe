import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Party } from './money';

/**
 * Running the business, as opposed to selling a thing: who is looking, who helps
 * you, what gets said automatically, and chasing an abandoned basket.
 *
 * Shapes read off live payloads. A trap already caught here: the team routes
 * take `permissions` as an OBJECT (`{orders:true}`), not `perms` and not an
 * array — sending the wrong name does not fail, it silently falls back to the
 * ROLE's defaults, so the member quietly gets different access from the one that
 * was ticked.
 */

/* ── Reach analytics ──────────────────────────────────────────────────────── */

export interface AnalyticsDay {
  day: string;
  views: number;
}

export interface BizAnalytics {
  profileViews: { total: number; last30: number; unique30: number; days: AnalyticsDay[] };
  followers: number;
  connections: number;
  posts: { count: number; views: number; likes: number; reposts: number };
  jobs: { count: number; applicants: number; views: number };
  /** Taps on a product tagged in a post, reel or story. */
  tagTaps: { total: number; last30: number; unique30: number };
  /** How well the business answers people. `responseRate` is a percentage. */
  messaging: {
    conversations: number; responded: number; responseRate: number;
    medianReplyMins: number | null; messagesIn: number; messagesOut: number;
  };
}

export function useBizAnalytics(enabled = true) {
  return useQuery({
    queryKey: ['biz-analytics'],
    queryFn: () => api.get<BizAnalytics>('/api/business/analytics'),
    enabled,
  });
}

/* ── Team ─────────────────────────────────────────────────────────────────── */

export type TeamPerm = 'jobs' | 'qa' | 'orders' | 'reviews' | 'inbox';
export type TeamRole = 'admin' | 'manager' | 'staff';

export interface TeamMember extends Party {
  role: TeamRole;
  /** Only the granted ones are present — an unticked permission is absent, not false. */
  permissions: Partial<Record<TeamPerm, boolean>>;
  status: 'invited' | 'active';
  verified?: boolean;
}

export interface TeamResponse {
  members: TeamMember[];
  /** The server's own list, so the tick-boxes can never offer one it will drop. */
  perms: TeamPerm[];
  roles: TeamRole[];
}

export interface Membership {
  businessId: number;
  role: TeamRole;
  permissions: Partial<Record<TeamPerm, boolean>>;
  status: 'invited' | 'active';
  business: Party;
}

export function useTeam(enabled = true) {
  return useQuery({
    queryKey: ['team'],
    queryFn: () => api.get<TeamResponse>('/api/business/team'),
    enabled,
  });
}
export function useMemberships() {
  return useQuery({
    queryKey: ['memberships'],
    queryFn: () => api.get<{ memberships: Membership[] }>('/api/business/memberships'),
  });
}
export function inviteTeamMember(username: string, role: TeamRole, permissions: Partial<Record<TeamPerm, boolean>>) {
  return api.post<{ ok: true }>('/api/business/team', { username, role, permissions });
}
export function updateTeamMember(memberId: number, body: { role?: TeamRole; permissions?: Partial<Record<TeamPerm, boolean>> }) {
  return api.patch(`/api/business/team/${memberId}`, body);
}
export function removeTeamMember(memberId: number) {
  return api.del(`/api/business/team/${memberId}`);
}
export function respondToTeamInvite(businessId: number, accept: boolean) {
  return api.post(`/api/business/team/${businessId}/respond`, { accept });
}

/** What each permission actually lets somebody do, in a sentence. */
export const PERM_LABEL: Record<TeamPerm, { label: string; sub: string }> = {
  orders:  { label: 'Orders',      sub: 'Mark things shipped and delivered' },
  qa:      { label: 'Questions',   sub: 'Answer customers as the business' },
  reviews: { label: 'Reviews',     sub: 'Reply to reviews' },
  jobs:    { label: 'Hiring',      sub: 'See applicants and move them along' },
  inbox:   { label: 'Team inbox',  sub: 'Work the shared inbox' },
};

/* ── Auto-messages ────────────────────────────────────────────────────────── */

/**
 * Greeting and away replies. They ride on the PROFILE update route, not a
 * dedicated one — and that route requires `name` and `username` in every body,
 * so saving these without them wipes the account's name. Not a hypothetical:
 * it is written into the repo's own notes as a bug that shipped once.
 */
export interface AutoMessages {
  greetingEnabled: boolean;
  greetingMessage: string | null;
  awayEnabled: boolean;
  awayMessage: string | null;
  awaySchedule: 'always' | 'outside_hours';
}

export function saveAutoMessages(
  identity: { name: string; username: string },
  m: AutoMessages,
) {
  return api.put('/api/auth/profile', { ...identity, ...m });
}

/* ── Cart recovery ────────────────────────────────────────────────────────── */

export interface CartRecovery {
  enabled: boolean;
  /** How long a basket sits before the nudge. 1-24. */
  delayHours: number;
  sentCount: number;
  recoveredCount: number;
}

export function useCartRecovery(enabled = true) {
  return useQuery({
    queryKey: ['cart-recovery'],
    queryFn: () => api.get<CartRecovery>('/api/cart-recovery/settings'),
    enabled,
  });
}
export function saveCartRecovery(body: { enabled: boolean; delayHours: number }) {
  return api.put<CartRecovery>('/api/cart-recovery/settings', body);
}

/* ── Shipping labels (optional — Shippo) ──────────────────────────────────── */

/**
 * Buying a real, paid-for shipping label instead of typing a tracking number in
 * by hand. OPTIONAL: without a provider configured the routes 503 and
 * `/api/config.shippingLabelsEnabled` is false, so the whole flow stays hidden
 * and the seller keeps entering carrier + tracking themselves.
 *
 * The parcel is asked for per shipment because Atwe stores no per-product weight
 * or dimensions — there is nothing to prefill from, so the sheet opens on a
 * small-package default rather than pretending to know.
 */
export interface ShipRate {
  id: string;
  carrier: string;
  service: string;
  amountCents: number;
  /** Estimated days in transit, as the carrier gives it. */
  days: string | null;
}

export interface Parcel {
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

/** A small box, which is what most of what people post actually is. */
export const DEFAULT_PARCEL: Parcel = { weightLb: 1, lengthIn: 10, widthIn: 8, heightIn: 4 };

export function getLabelRates(orderId: number, parcel: Parcel, kind: 'out' | 'return' = 'out') {
  const base = kind === 'return' ? `/api/orders/${orderId}/return/label` : `/api/orders/${orderId}/label`;
  return api.post<{ rates: ShipRate[] }>(`${base}/rates`, parcel);
}

/**
 * Buy the chosen rate. The server re-fetches that rate's authoritative price
 * before charging — the phone never sends an amount, so a stale or tampered
 * figure cannot become the charge.
 */
export function buyLabel(orderId: number, rateId: string, clientId: string, kind: 'out' | 'return' = 'out') {
  const base = kind === 'return' ? `/api/orders/${orderId}/return/label` : `/api/orders/${orderId}/label`;
  return api.post<{ ok: true; labelUrl: string; costCents: number; carrier: string; tracking: string }>(
    `${base}/buy`, { rateId, clientId },
  );
}
