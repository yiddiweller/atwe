import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/**
 * Buying, inside the app.
 *
 * Deliberately the SAME endpoints the web checkout uses, in the same order:
 * quote first (so the buyer sees shipping, tax and the total before committing
 * to anything), then buy. Nothing about the money moves here — the server owns
 * every part of that, including the idempotency claim that makes a double-tap
 * safe. This layer's whole job is to ask the right questions in the right order
 * and pass a stable clientId.
 */

/* ── Where it goes ──────────────────────────────────────────────────────────── */

export interface Address {
  id: number;
  fullName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal: string | null;
  country: string;
  isDefault: boolean;
  instructions: string | null;
}

/** What a new address needs. Only three of them are actually required, which is
 *  the server's rule, not a shortcut: much of the world has no postcode and no
 *  region, and demanding them would lock those buyers out. */
export interface AddressInput {
  fullName: string;
  line1: string;
  city: string;
  line2?: string;
  region?: string;
  postal?: string;
  country?: string;
  phone?: string;
  instructions?: string;
  isDefault?: boolean;
}

export function useAddresses() {
  return useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.get<{ addresses: Address[] }>('/api/addresses'),
    staleTime: 60_000,
  });
}

export async function addAddress(a: AddressInput): Promise<Address> {
  const r = await api.post<{ address: Address }>('/api/addresses', a);
  return r.address;
}

export async function deleteAddress(id: number): Promise<void> {
  await api.del(`/api/addresses/${id}`);
}

export async function setDefaultAddress(id: number): Promise<void> {
  await api.post(`/api/addresses/${id}/default`);
}

/** One line, the way a person would write it on an envelope. */
export function addressLine(a: Address): string {
  return [a.line1, a.line2, a.city, a.region, a.postal].filter(Boolean).join(', ');
}

/* ── What it costs ──────────────────────────────────────────────────────────── */

export interface ShipOption { id: string; label: string; amountCents: number; days?: number | null }

/** How long it should take: the seller's handling time plus transit, as a
 *  window rather than a promise of one day. */
export interface Eta {
  minAt: string;
  maxAt: string;
  handleDays?: [number, number];
  transitDays?: [number, number];
}

/** "7–14 Sep", or a single day when both ends land on it. */
export function etaLabel(e: Eta): string {
  const d = (iso: string) => new Date(iso);
  const a = d(e.minAt), b = d(e.maxAt);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '';
  const day = (x: Date) => x.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return a.toDateString() === b.toDateString() ? day(a) : `${a.getDate()}–${day(b)}`;
}

export interface Quote {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  needsShipping: boolean;
  /** The server could not price shipping because there is no address yet. */
  needAddress?: boolean;
  shippingOptions: ShipOption[];
  selectedRateId: string | null;
  /** When it should land — shown BEFORE paying, not after. It is a RANGE, not a
   *  date: the server sends { minAt, maxAt, handleDays, transitDays }, and
   *  treating it as a string renders "Invalid Date". */
  eta?: Eta | null;
  taxConfigured: boolean;
  ratesConfigured: boolean;
}

export interface QuoteInput {
  productId: number;
  qty: number;
  variantId?: number | null;
  addressId?: number | null;
  couponCode?: string;
  shipRateId?: string | null;
  pickup?: boolean;
}

/** Price a single-item purchase. Read-only — it commits to nothing. */
export async function quoteBuy(q: QuoteInput): Promise<Quote> {
  return api.post<Quote>('/api/checkout/quote', { mode: 'buy', ...q });
}

/* ── Paying ─────────────────────────────────────────────────────────────────── */

export type PayWith = 'balance' | 'protected';

export interface BuyInput extends QuoteInput {
  payWith: PayWith;
  /** The SAME id across every retry of one purchase, and a new one only for a
   *  genuinely new purchase. It is what makes a double-tap or a network retry
   *  charge once — the server claims it before any money moves and replays the
   *  first result afterwards. */
  clientId: string;
}

export interface BuyResult {
  ok: boolean;
  orderId: number;
  paid?: boolean;
  escrow?: boolean;
  fromBalance?: boolean;
  deduped?: boolean;
}

export async function buyNow(input: BuyInput): Promise<BuyResult> {
  const { payWith, ...rest } = input;
  return api.post<BuyResult>('/api/orders/buy', {
    ...rest,
    // "Protected" IS a balance payment — it just parks the money in escrow until
    // the buyer confirms, rather than handing it straight to the seller.
    payWith: 'balance',
    protected: payWith === 'protected',
  });
}

/** Everything the checkout needs to invalidate after a successful purchase. */
export function useAfterPurchase() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['wallet'] });
    qc.invalidateQueries({ queryKey: ['listing'] });
    qc.invalidateQueries({ queryKey: ['marketplace'] });
  };
}
