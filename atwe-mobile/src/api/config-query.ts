import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * `GET /api/config` — what this server actually has switched on. Every optional
 * integration in Atwe degrades rather than breaking, and this is how the app
 * learns which ones are there: no Stripe, no card checkout; no Google client id,
 * no Google sign-in.
 */
export interface AppConfig {
  build?: string;
  billingEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  demoMode: boolean;
  googleClientId?: string | null;
  appleClientId?: string | null;
  taxEnabled?: boolean;
  shippingRatesEnabled?: boolean;
  /** Real, paid-for shipping labels. Off unless a provider is configured, and
   *  then the seller keeps entering carrier + tracking by hand. */
  shippingLabelsEnabled?: boolean;
  features?: Record<string, boolean>;
  vapidPublicKey?: string;
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    // No token needed, and it is asked for before there is one.
    queryFn: () => api.get<AppConfig>('/api/config', { noAuth: true }),
    staleTime: 5 * 60_000,
  });
}
