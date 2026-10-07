import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * The money the wallet does not already cover — gift cards, invoices, quotes,
 * rewards, referrals, splits, pools, standing payments, payment links and
 * Subscribe & Save.
 *
 * One module, because every one of them is the same idea seen from a different
 * angle (somebody owes somebody), and ten one-type files would be ten places to
 * look when the server changes a field. Every shape mirrors its `map*` on the
 * server exactly — verified against live payloads, not against the docs.
 */

/** The little person-stub the money routes attach to almost everything. */
export interface Party {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  accountType?: 'personal' | 'business';
}

/* ── Gift cards ───────────────────────────────────────────────────────────── */

/**
 * A gift card is a SEPARATE balance, not wallet money — Apple/Amazon's model,
 * deliberately. `balanceCents` is what is left on it; `amountCents` is what it
 * was minted at, and the two differ once it has been part-spent.
 */
export interface GiftCard {
  id: number;
  code: string;
  amountCents: number;
  balanceCents: number;
  message: string | null;
  createdAt: string;
  redeemedAt: string | null;
  redeemed: boolean;
  status: 'active' | 'void';
  frozen: boolean;
  companyIssued: boolean;
  /** I bought it. */
  mine: boolean;
  /** I hold it and can spend it. */
  ownedByMe: boolean;
  /** It was addressed to me. */
  sentToMe: boolean;
  /** Addressed to me and not yet claimed. */
  claimable: boolean;
  depleted: boolean;
}

export function useGiftCards() {
  return useQuery({
    queryKey: ['gift-cards'],
    queryFn: () => api.get<{ cards: GiftCard[] }>('/api/gift-cards'),
  });
}
export function buyGiftCard(body: { amountCents: number; to?: string; message?: string; clientId: string }) {
  return api.post<{ card: GiftCard }>('/api/gift-cards', body);
}
export function redeemGiftCard(code: string) {
  return api.post<{ card: GiftCard }>('/api/gift-cards/redeem', { code });
}
export function claimGiftCard(id: number) {
  return api.post<{ card: GiftCard }>(`/api/gift-cards/${id}/claim`, {});
}
export function giftCardToWallet(id: number, amountCents: number) {
  return api.post<{ ok: true; balanceCents: number }>(`/api/gift-cards/${id}/to-wallet`, { amountCents });
}

/* ── Invoices ─────────────────────────────────────────────────────────────── */

export interface LineItem {
  description: string;
  amountCents: number;
}

export interface Invoice {
  id: number;
  title: string;
  items: LineItem[];
  amountCents: number;
  note: string | null;
  dueAt: string | null;
  status: 'sent' | 'paid' | 'cancelled';
  createdAt: string;
  paidAt: string | null;
  paidOutside: boolean;
  lastRemindedAt: string | null;
  /** I issued it. */
  mine: boolean;
  issuer: Party;
  customer: Party;
}

export function useInvoices(scope: 'received' | 'sent') {
  return useQuery({
    queryKey: ['invoices', scope],
    queryFn: () => api.get<{ invoices: Invoice[] }>(`/api/invoices?scope=${scope}`),
  });
}
export function useInvoice(id: number | string) {
  return useQuery({
    queryKey: ['invoice', String(id)],
    queryFn: () => api.get<{ invoice: Invoice }>(`/api/invoices/${id}`),
    enabled: id != null && id !== '',
  });
}
/**
 * Paying an invoice is Stripe-or-nothing, NOT wallet balance — the route claims
 * the invoice, then either hands back a Checkout `url` or (with no Stripe
 * configured) marks it paid outright. It reads neither `payWith` nor `clientId`,
 * so sending them would be the code claiming a behaviour the server has not got.
 * Its own claim-first guard is what makes a double-tap safe.
 */
export function payInvoice(id: number) {
  return api.post<{ ok?: boolean; paid?: boolean; url?: string }>(`/api/invoices/${id}/pay`, {});
}
export function cancelInvoice(id: number) {
  return api.post(`/api/invoices/${id}/cancel`, {});
}

/* ── Quotes ───────────────────────────────────────────────────────────────── */

/**
 * A quote comes BEFORE the work; an invoice comes after. Accepting one creates
 * the invoice, which is why `accept` hands an invoice back to open.
 */
export interface WorkQuote {
  id: number;
  title: string;
  items: LineItem[];
  amountCents: number;
  note: string | null;
  validUntil: string | null;
  status: 'sent' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  createdAt: string;
  respondedAt: string | null;
  invoiceId: number | null;
  mine: boolean;
  issuer: Party;
  customer: Party;
}

export function useQuotes(scope: 'received' | 'sent') {
  return useQuery({
    queryKey: ['quotes', scope],
    queryFn: () => api.get<{ quotes: WorkQuote[] }>(`/api/quotes?scope=${scope}`),
  });
}
export function useQuote(id: number | string) {
  return useQuery({
    queryKey: ['quote', String(id)],
    queryFn: () => api.get<{ quote: WorkQuote }>(`/api/quotes/${id}`),
    enabled: id != null && id !== '',
  });
}
export function acceptQuote(id: number) {
  return api.post<{ ok: true; invoice: Invoice }>(`/api/quotes/${id}/accept`, {});
}
export function declineQuote(id: number) {
  return api.post(`/api/quotes/${id}/decline`, {});
}
export function cancelQuote(id: number) {
  return api.post(`/api/quotes/${id}/cancel`, {});
}

/* ── Rewards (loyalty points) ─────────────────────────────────────────────── */

export interface LoyaltyTx {
  delta: number;
  reason: 'order' | 'redeem' | 'bonus';
  orderId: number | null;
  balanceAfter: number;
  createdAt: string;
}

export interface Loyalty {
  pointsBalance: number;
  pointsLifetime: number;
  pointsPerDollar: number;
  minRedeem: number;
  redeemableCents: number;
  tier: { key: string; name: string };
  nextTier: { name: string; pointsAway: number } | null;
  transactions: LoyaltyTx[];
}

export function useLoyalty() {
  return useQuery({ queryKey: ['loyalty'], queryFn: () => api.get<Loyalty>('/api/loyalty') });
}
export function redeemPoints(points: number) {
  return api.post<{ ok: true; creditedCents: number; pointsBalance: number }>('/api/loyalty/redeem', { points });
}

/* ── Referrals ────────────────────────────────────────────────────────────── */

export interface ReferralMilestone {
  at: number;
  cents: number;
  reached: boolean;
}

export interface Referrals {
  code: string;
  link: string;
  bonusCents: number;
  businessBonusCents: number;
  count: number;
  totalEarnedCents: number;
  milestones: ReferralMilestone[];
  nextMilestone: { at: number; cents: number } | null;
  businessCount: number;
  referrals: { user: Party; createdAt: string; rewardCents: number }[];
}

export function useReferrals() {
  return useQuery({ queryKey: ['referrals'], queryFn: () => api.get<Referrals>('/api/referrals') });
}

/* ── Splits ───────────────────────────────────────────────────────────────── */

export interface SplitShare {
  user: Party;
  amountCents: number;
  paid: boolean;
}

export interface Split {
  id: number;
  title: string;
  totalCents: number;
  paidCents: number;
  createdAt: string;
  lastRemindedAt: string | null;
  creator: Party;
  iAmCreator: boolean;
  /** Absent on a split I created — I never owe a share of my own. */
  myShareCents?: number;
  myPaid?: boolean;
  shares: SplitShare[];
}

export function useSplits(scope: 'owed' | 'created') {
  return useQuery({
    queryKey: ['splits', scope],
    queryFn: () => api.get<{ splits: Split[] }>(`/api/splits?scope=${scope}`),
  });
}
export function useSplit(id: number | string) {
  return useQuery({
    queryKey: ['split', String(id)],
    queryFn: () => api.get<{ split: Split }>(`/api/splits/${id}`),
    enabled: id != null && id !== '',
  });
}
export function paySplit(id: number) {
  return api.post<{ ok?: boolean; alreadyPaid?: boolean }>(`/api/splits/${id}/pay`, {});
}

/* ── Pools (group fundraising) ────────────────────────────────────────────── */

/**
 * NB the contributor is FLAT — the server spreads the person's fields straight
 * onto the row rather than nesting a `user`, and the timestamp is `at`, not
 * `createdAt`. Declared as a nested Party first, which typechecked perfectly and
 * would have rendered a list of blank names and blank times; the API checker is
 * what caught it. There is no `id` either, so a contributor is not tappable.
 */
export interface PoolContribution {
  name: string;
  username: string | null;
  avatar: string | null;
  amountCents: number;
  at: string;
}

export interface Pool {
  id: number;
  title: string;
  description: string | null;
  goalCents: number | null;
  raisedCents: number;
  closed: boolean;
  createdAt: string;
  iAmCreator: boolean;
  creator: Party;
  /** Detail only. */
  contributors?: PoolContribution[];
}

export function usePools(scope: 'mine' | 'contributed') {
  return useQuery({
    queryKey: ['pools', scope],
    queryFn: () => api.get<{ pools: Pool[] }>(`/api/pools?scope=${scope}`),
  });
}
export function usePool(id: number | string) {
  return useQuery({
    queryKey: ['pool', String(id)],
    queryFn: () => api.get<{ pool: Pool }>(`/api/pools/${id}`),
    enabled: id != null && id !== '',
  });
}
export function contributeToPool(id: number, amountCents: number) {
  return api.post<{ ok: true; pool: Pool }>(`/api/pools/${id}/contribute`, { amountCents });
}
export function createPool(body: { title: string; description?: string; goalCents?: number }) {
  return api.post<{ pool: Pool; link: string }>('/api/pools', body);
}
export function closePool(id: number) {
  return api.post(`/api/pools/${id}/close`, {});
}

/* ── Standing payments ────────────────────────────────────────────────────── */

export interface ScheduledPayment {
  id: number;
  amountCents: number;
  note: string | null;
  /** null = a one-off on a date, not a repeat. */
  intervalDays: number | null;
  recurring: boolean;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  nextAt: string;
  lastPaidAt: string | null;
  runs: number;
  /** True on the payer's copy. */
  outgoing: boolean;
  counterparty: Party;
}

export function useScheduledPayments(scope: 'outgoing' | 'incoming') {
  return useQuery({
    queryKey: ['scheduled-payments', scope],
    queryFn: () => api.get<{ payments: ScheduledPayment[] }>(`/api/scheduled-payments?scope=${scope}`),
  });
}
export function setScheduledPaymentPaused(id: number, paused: boolean) {
  return api.patch<{ payment: ScheduledPayment }>(`/api/scheduled-payments/${id}`, {
    status: paused ? 'paused' : 'active',
  });
}
export function cancelScheduledPayment(id: number) {
  return api.del(`/api/scheduled-payments/${id}`);
}
export function createScheduledPayment(body: {
  to: string; amount: number; note?: string; intervalDays?: number; startAt?: string;
}) {
  return api.post<{ payment: ScheduledPayment }>('/api/scheduled-payments', body);
}

/* ── Payment links ────────────────────────────────────────────────────────── */

export interface PaymentLink {
  id: number;
  code: string;
  /** null = the payer names the amount. */
  amountCents: number | null;
  note: string | null;
  collectedCents: number;
  payCount: number;
  active: boolean;
  createdAt: string;
}

export function usePaymentLinks() {
  return useQuery({
    queryKey: ['payment-links'],
    queryFn: () => api.get<{ links: PaymentLink[] }>('/api/payment-links'),
  });
}
export function createPaymentLink(body: { amountCents?: number; note?: string }) {
  return api.post<{ link: PaymentLink }>('/api/payment-links', body);
}
export function setPaymentLinkActive(id: number, active: boolean) {
  return api.patch<{ link: PaymentLink }>(`/api/payment-links/${id}`, { active });
}

/* ── Subscribe & Save ─────────────────────────────────────────────────────── */

export interface ProductSubscription {
  id: number;
  productId: number;
  variantId: number | null;
  qty: number;
  intervalDays: number;
  discountPct: number;
  status: 'active' | 'paused' | 'cancelled';
  nextAt: string;
  lastOrderId: number | null;
  perDeliveryCents: number;
  product: { id: number; name: string; image: string | null; priceCents: number; active: boolean; kind: string };
  seller: Party;
  shipTo: { name: string | null; line1: string | null; city: string | null } | null;
}

export function useProductSubscriptions() {
  return useQuery({
    queryKey: ['product-subscriptions'],
    queryFn: () => api.get<{ subscriptions: ProductSubscription[] }>('/api/product-subscriptions'),
  });
}
export function setSubscriptionPaused(id: number, paused: boolean) {
  return api.patch<{ subscription: ProductSubscription }>(`/api/product-subscriptions/${id}`, {
    status: paused ? 'paused' : 'active',
  });
}
export function cancelSubscription(id: number) {
  return api.del(`/api/product-subscriptions/${id}`);
}

/* ── Shared labels ────────────────────────────────────────────────────────── */

/** How often a standing payment or a Subscribe & Save delivery repeats. */
export function everyLabel(days: number | null | undefined): string {
  if (!days) return 'Once';
  if (days === 7) return 'Every week';
  if (days === 14) return 'Every 2 weeks';
  if (days === 30) return 'Every month';
  if (days === 60) return 'Every 2 months';
  if (days === 90) return 'Every 3 months';
  return `Every ${days} days`;
}
