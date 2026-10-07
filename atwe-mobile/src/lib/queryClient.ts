import { QueryClient } from '@tanstack/react-query';

/**
 * Single app-wide React Query client. Defaults tuned for a social/business app
 * on mobile networks: cache aggressively, retry transient failures once, and
 * don't refetch on every focus (SSE keeps hot data fresh instead).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
