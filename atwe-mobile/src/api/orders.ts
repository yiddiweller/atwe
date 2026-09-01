import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Orders — what you have bought, and what you have sold. The same two lists the
 * web shows, over `GET /api/orders?scope=`.
 */
export type OrderStatus =
  | 'pending' | 'paid' | 'fulfilled' | 'delivered' | 'cancelled'
  | 'escrow' | 'disputed' | 'released' | 'refunded';

export interface OrderItem { name: string; qty: number; priceCents: number; variantLabel?: string | null }
/** Who an order is with. The server sends a party OBJECT on each side — it does
 *  NOT send buyerName / sellerName, which this once declared, so every order row
 *  quietly dropped the "from …" / "to …" line and never said who it was with. */
export interface OrderParty {
  id: number;
  name: string | null;
  username: string | null;
  avatar: string | null;
}
/** The address an order is going to. NB the server calls it `name` here, not
 *  `fullName` as on a saved address — this is the snapshot taken at checkout,
 *  and it is immutable history the seller ships against. */
export interface ShipTo {
  name: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal: string | null;
  country: string | null;
  instructions: string | null;
}

/** When it should arrive — a window, not a promise of one day. */
export interface OrderEta { minAt: string; maxAt: string }

export interface Order {
  id: number;
  status: OrderStatus;
  totalCents: number;
  subtotalCents?: number;
  shippingCents?: number;
  taxCents?: number;
  discountCents?: number;
  createdAt: string;
  paidAt?: string | null;
  mine: boolean;                 // I am the seller
  items?: OrderItem[];
  buyer?: OrderParty | null;
  seller?: OrderParty | null;
  carrier?: string | null;
  tracking?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  shipNote?: string | null;
  shipTo?: ShipTo | null;
  eta?: OrderEta | null;
  needsShipping?: boolean;
  localDelivery?: boolean;
  escrow?: boolean;
  /** When an untouched escrow releases itself, so a silent buyer cannot strand
   *  a seller's money forever. */
  autoReleaseAt?: string | null;
  releasedAt?: string | null;
  disputeReason?: string | null;
  disputedByMe?: boolean;
  pickup?: boolean;
  pickupLocation?: string | null;
  refundedCents?: number;
  canReturn?: boolean;
}

export function useOrders(scope: 'buyer' | 'seller') {
  return useQuery({
    queryKey: ['orders', scope],
    queryFn: () => api.get<{ orders: Order[] }>(`/api/orders?scope=${scope}`),
  });
}

/** Plain words for where an order has got to. */
export function orderStatusLabel(o: Order): string {
  switch (o.status) {
    case 'pending': return 'Waiting to be paid';
    case 'paid': return o.carrier ? 'On its way' : 'Paid — being got ready';
    case 'escrow': return 'Paid, held until you confirm';
    case 'fulfilled': return 'Sent';
    case 'delivered': return 'Delivered';
    case 'released': return 'Finished';
    case 'refunded': return 'Refunded';
    case 'disputed': return 'Being looked at';
    case 'cancelled': return 'Cancelled';
    default: return o.status;
  }
}
export function orderStatusTone(o: Order): 'success' | 'warning' | 'danger' | 't3' {
  if (o.status === 'delivered' || o.status === 'released' || o.status === 'fulfilled') return 'success';
  if (o.status === 'disputed' || o.status === 'cancelled') return 'danger';
  if (o.status === 'pending' || o.status === 'escrow') return 'warning';
  return 't3';
}

/** One order, for the detail screen. */
export function useOrder(id: number | undefined) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<{ order: Order }>(`/api/orders/${id}`),
    enabled: id != null && Number.isFinite(id),
  });
}

/* ── Acting on an order ───────────────────────────────────────────────────────
 * Each of these belongs to exactly one side, and the server enforces that; the
 * screen only decides what to OFFER. It is better to not show a button than to
 * show one the server will refuse.
 */

/** Buyer: release the escrow. This is the money actually reaching the seller. */
export async function confirmOrder(id: number): Promise<void> {
  await api.post(`/api/orders/${id}/confirm`);
}

/** Either side, on a held order: send it to Atwe to look at. */
export async function disputeOrder(id: number, reason: string): Promise<void> {
  await api.post(`/api/orders/${id}/dispute`, { reason });
}

/** Buyer while unpaid; seller before it is sent. */
export async function cancelOrder(id: number, reason?: string): Promise<void> {
  await api.post(`/api/orders/${id}/cancel`, { reason });
}

export const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Other'] as const;
export type Carrier = (typeof CARRIERS)[number];

/** Seller: it has gone in the post. Carrier + tracking are what the buyer sees. */
export async function shipOrder(id: number, carrier: Carrier, tracking: string): Promise<void> {
  await api.post(`/api/orders/${id}/ship`, { carrier, tracking });
}

/** Either side: it arrived. The buyer saying so does NOT release escrow —
 *  confirming does, and they are deliberately different acts. */
export async function markDelivered(id: number): Promise<void> {
  await api.post(`/api/orders/${id}/deliver`);
}

/** Buyer: ask to send it back. */
export async function requestReturn(id: number, reason: string): Promise<void> {
  await api.post(`/api/orders/${id}/return`, { reason });
}

/** Where the carrier will show it. An unknown carrier gets no link rather than
 *  a guessed one that 404s. */
export function trackingUrl(carrier: string | null | undefined, tracking: string): string | null {
  const t = encodeURIComponent(tracking);
  switch ((carrier || '').toUpperCase()) {
    case 'USPS': return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;
    case 'UPS': return `https://www.ups.com/track?tracknum=${t}`;
    case 'FEDEX': return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
    case 'DHL': return `https://www.dhl.com/en/express/tracking.html?AWB=${t}`;
    default: return null;
  }
}

/** The steps an order walks through, and how far it has got. Cancelled and
 *  refunded orders have no timeline — they stopped. */
export function orderSteps(o: Order): { label: string; done: boolean }[] | null {
  if (o.status === 'cancelled' || o.status === 'refunded') return null;
  const paid = !!o.paidAt || ['paid', 'escrow', 'fulfilled', 'delivered', 'released', 'disputed'].includes(o.status);
  const steps = [
    { label: 'Ordered', done: true },
    { label: o.escrow ? 'Paid — held' : 'Paid', done: paid },
  ];
  if (o.needsShipping) steps.push({ label: 'Sent', done: !!o.shippedAt });
  steps.push({ label: 'Arrived', done: !!o.deliveredAt });
  if (o.escrow || o.status === 'released') {
    steps.push({ label: 'Money released', done: o.status === 'released' });
  }
  return steps;
}
