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
  /** Business accounts: seven days from Monday, each `{closed:true}` or
   *  `{open,close}`. The bookable times are cut from this. */
  businessHours?: unknown[] | null;
  balanceCents?: number;
  twoFactorEnabled?: boolean;
  businessVerifyStatus?: 'none' | 'pending' | 'verified';
  onboarded?: boolean;
  /* Automatic replies, business accounts only. They live on the USER row rather
     than a settings table, which is why they arrive here and are saved through
     the profile route — see `saveAutoMessages`, and the warning attached to it. */
  greetingEnabled?: boolean;
  greetingMessage?: string | null;
  awayEnabled?: boolean;
  awayMessage?: string | null;
  awaySchedule?: 'always' | 'outside_hours';
  cartRecoveryEnabled?: boolean;
  cartRecoveryDelayHours?: number;
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
/* AppConfig lives in `config-query.ts`, beside the hook that fetches it.

   There used to be a SECOND copy here, and nothing imported it — so the type
   checker was faithfully verifying a shape the app never used, while the real
   one quietly drifted. Re-exported rather than redeclared so that cannot
   happen again. */
export type { AppConfig } from './config-query';
