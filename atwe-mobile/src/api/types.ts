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
  verified: boolean;
  /* These two are snake_case ON THE WIRE and that is not a slip — `publicUser`
     has always sent `is_admin` / `email_verified`, and the web app reads them
     that way. Declaring them camelCase here did not fail; it just made them
     permanently undefined, so Settings told every account its email was "Not
     verified" whether it was or not. Match the wire, do not rename it. */
  is_admin: boolean;
  email_verified: boolean;
  avatar?: string | null;
  banner?: string | null;
  headline?: string | null;
  bio?: string | null;
  /* These two matter more than they look: the profile editor prefills from
     them, and a field it cannot read starts blank and is then SAVED as blank —
     silently wiping whatever was there. */
  location?: string | null;
  website?: string | null;
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
