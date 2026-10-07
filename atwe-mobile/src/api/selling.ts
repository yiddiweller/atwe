import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Listing, ListingKind } from './marketplace';

/**
 * Selling — the owner's side of the shop.
 *
 * `GET /api/my-listings` returns the seller's OWN products, which is a
 * deliberately different payload from the public marketplace one: it includes
 * hidden listings, and every field the edit form has to read back. A field
 * missing from it reads as "off" in the form and is then wiped by the next
 * save — that has bitten this endpoint before, which is why it is used here
 * rather than the public shape.
 */

export function useMyListings() {
  return useQuery({
    queryKey: ['my-listings'],
    queryFn: () => api.get<{ products: Listing[] }>('/api/my-listings'),
    staleTime: 15_000,
  });
}

/** What the form sends. Everything optional but the name and the price, because
 *  a PATCH must be able to change one thing without restating the rest. */
export interface ListingInput {
  name?: string;
  description?: string;
  priceCents?: number;
  kind?: ListingKind;
  image?: string | null;
  /** null = untracked, i.e. never runs out. */
  stock?: number | null;
  shipFree?: boolean;
  shipFeeCents?: number;
  category?: string | null;
  active?: boolean;
  pickup?: boolean;
  pickupLocation?: string | null;
}

export async function createListing(v: ListingInput): Promise<Listing> {
  const r = await api.post<{ product: Listing }>('/api/products', v);
  return r.product;
}

export async function updateListing(id: number, v: ListingInput): Promise<Listing> {
  const r = await api.patch<{ product: Listing }>(`/api/products/${id}`, v);
  return r.product;
}

export async function deleteListing(id: number): Promise<void> {
  await api.del(`/api/products/${id}`);
}

/* ── How it is going ────────────────────────────────────────────────────────── */

export interface TopProduct { name: string; units: number; revenueCents: number }
export interface TrendDay { day: string; revenueCents: number }

export interface ShopAnalytics {
  orders: number;
  revenueCents: number;
  units: number;
  pending: number;
  /** Paid and waiting to be posted — the number that is actually a to-do list. */
  toShip: number;
  totalRevenueCents: number;
  topProducts: TopProduct[];
  trend: TrendDay[];
  trendDays: number;
}

export function useShopAnalytics() {
  return useQuery({
    queryKey: ['shop-analytics'],
    queryFn: () => api.get<ShopAnalytics>('/api/shop/analytics'),
    staleTime: 30_000,
  });
}
