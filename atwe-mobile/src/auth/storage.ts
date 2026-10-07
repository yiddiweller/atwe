import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Token storage backed by the iOS Keychain (Secure Enclave-protected) via
 * expo-secure-store. The 30-day bearer NEVER touches AsyncStorage or any
 * plaintext store — on a phone, which is the only place the app ships.
 *
 * `expo-secure-store` has NO web implementation: calling it there throws
 * `getValueWithKeyAsync is not a function` and takes the whole auth bootstrap
 * down with it. That matters because the same code is built for the web to
 * LOOK at the screens during development, so the web path falls back to
 * localStorage — which is not a secure store and is not pretending to be one.
 * Nothing ships to a browser; if that ever changes, this is the line to
 * revisit first.
 */

const TOKEN_KEY = 'atwe_token';
const web = Platform.OS === 'web';

export async function saveToken(token: string): Promise<void> {
  if (web) { try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ } return; }
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadToken(): Promise<string | null> {
  if (web) { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  if (web) { try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing to clear */ } return; }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
