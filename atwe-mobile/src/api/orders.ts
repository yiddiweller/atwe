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
export interface Order {
  id: number;
  status: OrderStatus;
  totalCents: number;
  createdAt: string;
  mine: boolean;                 // I am the seller
  items?: OrderItem[];
  buyerName?: string | null;
  sellerName?: string | null;
  carrier?: string | null;
  tracking?: string | null;
  localDelivery?: boolean;
  escrow?: boolean;
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
