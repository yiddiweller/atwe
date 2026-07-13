import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Marketplace — mirrors the backend `GET /api/marketplace` and `GET
 * /api/listings/:id` + the `mapListing` shape (product + seller). The app is the
 * consumer, so field names match the API exactly.
 */

export type ListingKind = 'physical' | 'digital' | 'service' | 'rental';

export interface ListingSeller {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  accountType: 'personal' | 'business';
  verified: boolean;
}

export interface Listing {
  id: number;
  businessId: number;
  name: string;
  description: string | null;
  priceCents: number;
  priceFromCents: number;
  image: string | null;
  images: string[];
  kind: ListingKind;
  active: boolean;
  soldOut: boolean;
  stock: number | null;
  hasVariants: boolean;
  rating: number | null;
  reviewCount: number;
  category: string | null;
  saved?: boolean;
  seller: ListingSeller;
  createdAt?: string;
  moreFromSeller?: Listing[];
}

interface MarketplaceResponse {
  listings: Listing[];
  sort: string;
}

interface ListingResponse {
  listing: Listing;
}

/** Browse / search the marketplace. Empty query = the default Best-Match feed. */
export function useMarketplace(q: string, kind: ListingKind | null) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (kind) params.set('kind', kind);
  const qs = params.toString();
  return useQuery({
    queryKey: ['marketplace', q, kind ?? 'all'],
    queryFn: () => api.get<MarketplaceResponse>(`/api/marketplace${qs ? `?${qs}` : ''}`),
  });
}

/** A single listing's detail (+ more-from-seller). */
export function useListing(id: number | string) {
  return useQuery({
    queryKey: ['listing', String(id)],
    queryFn: () => api.get<ListingResponse>(`/api/listings/${id}`),
    enabled: id != null && id !== '',
  });
}

/** Save / unsave a listing (wishlist). */
export async function saveListing(id: number, on: boolean): Promise<void> {
  if (on) await api.post(`/api/saved-products/${id}`);
  else await api.del(`/api/saved-products/${id}`);
}

/** "$12.00" — cents → display. Kept alongside wallet's `money` for listing use. */
export function priceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** A listing's display price: "from $X" when it has variants, else the flat price. */
export function listingPrice(l: Listing): string {
  const base = l.hasVariants ? l.priceFromCents : l.priceCents;
  return (l.hasVariants ? 'from ' : '') + priceLabel(base);
}

export const KIND_LABEL: Record<ListingKind, string> = {
  physical: 'Goods',
  digital: 'Digital',
  service: 'Services',
  rental: 'Rentals',
};
