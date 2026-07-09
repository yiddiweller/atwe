/**
 * Core API types — the shared contract with the backend. This is the seed of
 * the "typed API contract" bridge described in the architecture plan; grow it
 * endpoint-by-endpoint (ideally generated from an OpenAPI description of the
 * existing Express routes) so the app consumes the ~470-endpoint surface
 * type-safely.
 *
 * Fields mirror the backend's `publicUser` shape.
 */

export type AccountType = 'personal' | 'business';
export type Plan = 'free' | 'pro';

export interface User {
  id: number;
  name: string;
  email: string;
  username: string | null;
  plan: Plan;
  accountType: AccountType;
  isAdmin: boolean;
  verified: boolean;
  emailVerified: boolean;
  avatar?: string | null;
  banner?: string | null;
  headline?: string | null;
  bio?: string | null;
  balanceCents?: number;
  twoFactorEnabled?: boolean;
  businessVerifyStatus?: 'none' | 'pending' | 'verified';
  onboarded?: boolean;
  // …extend as screens are built.
}

export interface AuthResponse {
  token: string;
  user: User;
}

/** `/api/auth/login` may 401 with this instead of a token when 2FA is on. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
}

/** `/api/config` feature flags. */
export interface AppConfig {
  billingEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled?: boolean;
  vapidPublicKey?: string;
  demoMode?: boolean;
  features?: Record<string, boolean>;
}
