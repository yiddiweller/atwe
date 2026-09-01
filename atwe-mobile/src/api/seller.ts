import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Party } from './money';

/**
 * The RUNNING-a-business half of selling — the part the buying flow does not
 * touch. Coupons, bundles, offers and product Q&A.
 *
 * Every shape mirrors its `map*` on the server exactly, read off a live payload
 * rather than the docs: `Service`→`ServiceListing` and `Quote`→`WorkQuote` are
 * both scars from guessing, and both were name collisions that would have made
 * the type checker verify the wrong interface.
 */

/* ── Coupons ──────────────────────────────────────────────────────────────── */

export interface Coupon {
  id: number;
  code: string;
  /** percent → `value` is 1-100; fixed → `value` is cents off. */
  kind: 'percent' | 'fixed';
  value: number;
  /** The order has to reach this before the code applies. 0 = no floor. */
  minOrderCents: number;
  /** null = unlimited. */
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: boolean;
}

export function useCoupons() {
  return useQuery({
    queryKey: ['coupons'],
    queryFn: () => api.get<{ coupons: Coupon[] }>('/api/coupons'),
  });
}
export function createCoupon(body: {
  code: string; kind: 'percent' | 'fixed'; value: number;
  minOrderCents?: number; maxUses?: number; expiresAt?: string;
}) {
  return api.post<{ coupon: Coupon }>('/api/coupons', body);
}
export function setCouponActive(id: number, active: boolean) {
  return api.patch<{ coupon: Coupon }>(`/api/coupons/${id}`, { active });
}
export function deleteCoupon(id: number) {
  return api.del(`/api/coupons/${id}`);
}

/** "10% off" / "$5 off" — one place, so a list and a detail cannot disagree. */
export function couponLabel(c: Coupon): string {
  return c.kind === 'percent' ? `${c.value}% off` : `$${(c.value / 100).toFixed(2)} off`;
}

/* ── Bundles ──────────────────────────────────────────────────────────────── */

export interface BundleItem {
  productId: number;
  name: string;
  priceCents: number;
  qty: number;
  image: string | null;
  kind: string;
  active: boolean;
  stock: number | null;
}

export interface Bundle {
  id: number;
  sellerId: number;
  name: string;
  description: string | null;
  image: string | null;
  priceCents: number;
  active: boolean;
  createdAt: string;
  items: BundleItem[];
  itemCount: number;
  /** What the pieces cost bought separately — the saving is the point. */
  retailCents: number;
  savingsCents: number;
  shippingCents: number;
  needsShipping: boolean;
  soldOut: boolean;
  seller: Party & { verified?: boolean };
}

export function useBundles(sellerUsernameOrId?: number | string) {
  const qs = sellerUsernameOrId != null ? `?seller=${sellerUsernameOrId}` : '';
  return useQuery({
    queryKey: ['bundles', String(sellerUsernameOrId ?? 'mine')],
    queryFn: () => api.get<{ bundles: Bundle[] }>(`/api/bundles${qs}`),
  });
}
export function useMyBundles() {
  return useQuery({
    queryKey: ['my-bundles'],
    queryFn: () => api.get<{ bundles: Bundle[] }>('/api/my-bundles'),
  });
}
export function useBundle(id: number | string) {
  return useQuery({
    queryKey: ['bundle', String(id)],
    queryFn: () => api.get<{ bundle: Bundle }>(`/api/bundles/${id}`),
    enabled: id != null && id !== '',
  });
}
export function createBundle(body: {
  name: string; description?: string; priceCents: number;
  items: { productId: number; qty: number }[];
}) {
  return api.post<{ bundle: Bundle }>('/api/bundles', body);
}
export function updateBundle(id: number, body: Partial<{ name: string; description: string; priceCents: number; active: boolean }>) {
  return api.patch<{ bundle: Bundle }>(`/api/bundles/${id}`, body);
}
export function deleteBundle(id: number) {
  return api.del(`/api/bundles/${id}`);
}

/* ── Offers (haggling on a listing) ───────────────────────────────────────── */

export interface Offer {
  id: number;
  productId: number;
  amountCents: number;
  status: 'pending' | 'countered' | 'accepted' | 'declined' | 'cancelled' | 'paid' | 'paying';
  /** Whose move it is. */
  turn: 'buyer' | 'seller';
  orderId: number | null;
  createdAt: string;
  updatedAt: string;
  iAmBuyer: boolean;
  iAmSeller: boolean;
  /** It is my move AND the offer is still open — the server works this out. */
  myTurn: boolean;
  canPay: boolean;
  product: { id: number; name: string; image: string | null; priceCents: number; active: boolean; kind: string };
  buyer: Party;
  seller: Party;
}

export function useOffers() {
  return useQuery({
    queryKey: ['offers'],
    queryFn: () => api.get<{ offers: Offer[] }>('/api/offers'),
  });
}
export function useOffer(id: number | string) {
  return useQuery({
    queryKey: ['offer', String(id)],
    queryFn: () => api.get<{ offer: Offer }>(`/api/offers/${id}`),
    enabled: id != null && id !== '',
  });
}
export function makeOffer(productId: number, amountCents: number) {
  return api.post<{ offer: Offer }>('/api/offers', { productId, amountCents });
}
/** Accept, decline, or counter with a number of your own. */
export function respondToOffer(id: number, action: 'accept' | 'decline' | 'counter', amountCents?: number) {
  return api.post<{ offer: Offer }>(`/api/offers/${id}/respond`, { action, amountCents });
}
export function cancelOffer(id: number) {
  return api.post(`/api/offers/${id}/cancel`, {});
}

/* ── Product Q&A ──────────────────────────────────────────────────────────── */

export interface QaAnswer {
  id: number;
  body: string;
  createdAt: string;
  mine: boolean;
  /** The seller's own answer — flagged, and sorted first by the server. */
  bySeller: boolean;
  author: Party & { verified?: boolean };
}

export interface QaQuestion {
  id: number;
  body: string;
  createdAt: string;
  mine: boolean;
  asker: Party & { verified?: boolean };
  answers: QaAnswer[];
}

export function useProductQa(productId: number | string) {
  return useQuery({
    queryKey: ['product-qa', String(productId)],
    queryFn: () => api.get<{ questions: QaQuestion[]; isSeller: boolean }>(`/api/products/${productId}/qa`),
    enabled: productId != null && productId !== '',
  });
}
export function askProductQuestion(productId: number, body: string) {
  return api.post<{ ok: true; id: number }>(`/api/products/${productId}/qa`, { body });
}
export function answerProductQuestion(questionId: number, body: string) {
  return api.post<{ ok: true; id: number }>(`/api/products/qa/${questionId}/answer`, { body });
}
export function deleteProductQuestion(questionId: number) {
  return api.del(`/api/products/qa/${questionId}`);
}
export function deleteProductAnswer(answerId: number) {
  return api.del(`/api/products/qa/answer/${answerId}`);
}
