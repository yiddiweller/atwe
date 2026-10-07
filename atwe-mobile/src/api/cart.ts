import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/**
 * The cart — several things from one seller, bought together.
 *
 * The server keeps ONE cart and groups it by seller, because an order always
 * goes to a single business. So the screen is a list of little carts, each with
 * its own subtotal and its own Checkout: buying from two sellers is two orders,
 * and pretending otherwise would be a lie about what happens.
 */

export interface CartItem {
  productId: number;
  variantId: number | null;
  variantLabel: string | null;
  name: string;
  priceCents: number;
  image: string | null;
  kind: 'physical' | 'digital' | 'service' | 'rental';
  qty: number;
  soldOut: boolean;
}

export interface CartSeller {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  accountType: 'personal' | 'business';
}

export interface Cart {
  seller: CartSeller;
  items: CartItem[];
  totalCents: number;
  shippingCents: number;
  needsShipping: boolean;
  /** Spend this much with the seller and they post it free. */
  freeShipOverCents?: number | null;
  freeShipMet?: boolean;
}

export function useCart() {
  return useQuery({
    queryKey: ['cart'],
    queryFn: () => api.get<{ carts: Cart[] }>('/api/cart'),
    staleTime: 10_000,
  });
}

/** Set how many. **Zero removes it** — and that is why this never falls back to
 *  `Number(x) || 1`, which would turn a deliberate 0 into a 1. */
export async function setCartQty(
  productId: number, qty: number, variantId?: number | null,
): Promise<void> {
  await api.post('/api/cart', { productId, qty, variantId: variantId ?? undefined });
}

export async function removeFromCart(productId: number, variantId?: number | null): Promise<void> {
  const q = variantId != null ? `?variant=${variantId}` : '';
  await api.del(`/api/cart/${productId}${q}`);
}

/** How many things are waiting, across every seller — for the badge. */
export function cartCount(carts: Cart[] | undefined): number {
  return (carts ?? []).reduce((n, g) => n + g.items.reduce((m, i) => m + i.qty, 0), 0);
}

export function useCartActions() {
  const qc = useQueryClient();
  return {
    refresh: () => qc.invalidateQueries({ queryKey: ['cart'] }),
  };
}
