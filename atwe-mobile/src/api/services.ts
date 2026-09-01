import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Services and the local hub — "find any service": a plumber, a tutor, a
 * magician. Mirrors `mapService` on the server.
 *
 * A SERVICE is not a marketplace listing. A listing is a thing you buy through
 * checkout; a service is a profile of what somebody does, and you get in touch
 * about it. Both exist and they are deliberately different.
 */

export interface ServiceProvider {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  accountType: 'personal' | 'business';
  verified: boolean;
}

export interface ServiceListing {
  id: number;
  title: string;
  category: string | null;
  area: string | null;
  rate: string | null;
  description: string | null;
  image: string | null;
  active: boolean;
  createdAt: string;
  amenities: string[];
  specs: unknown[];
  provider: ServiceProvider;
}

/** The categories the web offers as chips. */
export const SERVICE_CATEGORIES = [
  'Home & trades', 'Beauty', 'Health', 'Tutoring', 'Events',
  'Photo & video', 'Tech', 'Cleaning', 'Motoring', 'Pets', 'Other',
] as const;

export function useServices(q: string, category: string | null) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (category) p.set('category', category);
  const qs = p.toString();
  return useQuery({
    queryKey: ['services', q, category ?? 'all'],
    queryFn: () => api.get<{ services: ServiceListing[] }>(`/api/services${qs ? `?${qs}` : ''}`),
  });
}

export function useService(id: number | string) {
  return useQuery({
    queryKey: ['service', String(id)],
    queryFn: () => api.get<{ service: ServiceListing }>(`/api/services/${id}`),
    enabled: id != null && id !== '',
  });
}

export function useMyServices() {
  return useQuery({
    queryKey: ['my-services'],
    queryFn: () => api.get<{ services: ServiceListing[] }>('/api/my-services'),
  });
}

export interface ServiceDraft {
  title: string;
  category?: string;
  area?: string;
  rate?: string;
  description?: string;
}
export function offerService(d: ServiceDraft) {
  return api.post<{ service: ServiceListing }>('/api/services', d);
}
export async function removeService(id: number): Promise<void> {
  await api.del(`/api/services/${id}`);
}

/* ── the local hub ────────────────────────────────────────────────────────── */

/** One search across everything nearby, which is the whole point of the hub:
 *  somebody looking for "plumber" does not care whether the answer is a service,
 *  a business, a listing or a job. */
export interface LocalResults {
  services: ServiceListing[];
  businesses: {
    id: number; name: string; username: string | null; avatar: string | null;
    verified: boolean; headline: string | null; accountType: 'personal' | 'business';
  }[];
  jobs: {
    id: number; title: string; industry: string | null; location: string | null;
    remote: boolean; featured: boolean; company: string;
  }[];
  events: {
    id: number; title: string; startsAt: string; online: boolean;
    location: string | null; host: string;
  }[];
}

export function useLocal(q: string) {
  return useQuery({
    queryKey: ['local', q],
    queryFn: () => api.get<LocalResults>(`/api/local${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  });
}

/* ── the business directory ───────────────────────────────────────────────── */

export interface DirectoryBusiness {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  verified: boolean;
  headline: string | null;
  accountType: 'personal' | 'business';
  followers: number;
  jobs: number;
  /** Only when the viewer shared their location. */
  distanceKm?: number;
}

export function useDirectory(q: string, verifiedOnly: boolean) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (verifiedOnly) p.set('verifiedOnly', 'true');
  const qs = p.toString();
  return useQuery({
    queryKey: ['directory', q, verifiedOnly],
    queryFn: () => api.get<{ businesses: DirectoryBusiness[] }>(
      `/api/businesses/directory${qs ? `?${qs}` : ''}`),
  });
}

/** "12 mi" / "3 km" — a distance, in whatever the phone's locale expects. */
export function distanceLabel(km?: number): string | null {
  if (km == null) return null;
  const imperial = typeof Intl !== 'undefined'
    && /^(en-US|en-GB|my|li)/.test(Intl.DateTimeFormat().resolvedOptions().locale || '');
  return imperial ? `${Math.round(km * 0.621371)} mi` : `${Math.round(km)} km`;
}
