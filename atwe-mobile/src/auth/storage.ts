import * as SecureStore from 'expo-secure-store';

/**
 * Token storage backed by the iOS Keychain (Secure Enclave-protected) via
 * expo-secure-store. The 30-day bearer NEVER touches AsyncStorage or any
 * plaintext store.
 */

const TOKEN_KEY = 'atwe_token';

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
