import Constants from 'expo-constants';

/**
 * Base URL of the existing Atwe backend. Resolution order:
 *   1. EXPO_PUBLIC_API_URL (build-time env, per eas.json / .env)
 *   2. app.json → expo.extra.apiUrl
 *   3. production default
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'https://atwe.com';

/** Network timeout for a single request (ms). Mirrors the web app's 30s chat timeout. */
export const REQUEST_TIMEOUT = 30_000;
