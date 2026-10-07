import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Post, SearchUser } from './social';
import type { Listing } from './marketplace';

/**
 * Search, across everything Atwe holds — the same scopes the web has, over the
 * one `GET /api/search` endpoint.
 */
export type SearchScope = 'all' | 'people' | 'posts' | 'shop' | 'jobs' | 'businesses' | 'services';

export const SEARCH_SCOPES: { key: SearchScope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'people', label: 'People' },
  { key: 'posts', label: 'Posts' },
  { key: 'shop', label: 'Shop' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'services', label: 'Services' },
  { key: 'businesses', label: 'Businesses' },
];

export interface Job {
  id: number;
  title: string;
  industry?: string | null;
  location?: string | null;
  remote?: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryPeriod?: string | null;
  applicants?: number;
  featured?: boolean;
  poster?: { id: number; name: string; username: string; avatar?: string | null } | null;
}
export interface Service {
  id: number;
  title: string;
  category?: string | null;
  area?: string | null;
  rate?: string | null;
  provider?: { id: number; name: string; username: string; avatar?: string | null } | null;
}

export interface SearchResults {
  users?: SearchUser[];
  posts?: Post[];
  listings?: Listing[];
  jobs?: Job[];
  services?: Service[];
  businesses?: SearchUser[];
}

export function useSearch(scope: SearchScope, q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['search', scope, query],
    queryFn: () => api.get<SearchResults>(`/api/search?scope=${scope}&q=${encodeURIComponent(query)}`),
    enabled: query.length >= 1,
    staleTime: 30_000,
  });
}

/** "£40,000 – £55,000 a year", or nothing if the poster did not say. */
export function jobPay(j: Job): string | null {
  if (!j.salaryMin && !j.salaryMax) return null;
  const n = (v?: number | null) => (v == null ? '' : `£${Math.round(v).toLocaleString()}`);
  const per = j.salaryPeriod ? ` a ${j.salaryPeriod}` : '';
  if (j.salaryMin && j.salaryMax) return `${n(j.salaryMin)} – ${n(j.salaryMax)}${per}`;
  return `${n(j.salaryMin ?? j.salaryMax)}${per}`;
}
