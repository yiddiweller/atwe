import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import { palettes, spacing, radius, type, timing, type Palette, type ThemeName } from './tokens';

type ThemePref = ThemeName | 'system';

interface ThemeContextValue {
  /** Resolved palette for the active theme. */
  c: Palette;
  /** Active resolved theme. */
  name: ThemeName;
  /** User preference (may be 'system'). */
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
  timing: typeof timing;
}

const PREF_KEY = 'atwe_theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

/* expo-secure-store has no web implementation and THROWS there, which is not
   worth taking a theme preference down for. Same fallback as the token store:
   localStorage on web, the Keychain on a phone. */
const prefStore = {
  get: async (): Promise<string | null> => {
    if (Platform.OS === 'web') { try { return localStorage.getItem(PREF_KEY); } catch { return null; } }
    return SecureStore.getItemAsync(PREF_KEY);
  },
  set: async (v: string) => {
    if (Platform.OS === 'web') { try { localStorage.setItem(PREF_KEY, v); } catch { /* private mode */ } return; }
    await SecureStore.setItemAsync(PREF_KEY, v);
  },
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const [pref, setPrefState] = useState<ThemePref>('system');

  // Load saved preference once.
  useEffect(() => {
    prefStore.get().then((v) => {
      if (v === 'black' || v === 'light' || v === 'system') setPrefState(v);
    }).catch(() => {});
  }, []);

  const name: ThemeName = pref === 'system' ? (system === 'light' ? 'light' : 'black') : pref;
  const c = palettes[name];

  // Keep the native root background in sync (prevents white flash on nav).
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);

  const setPref = (p: ThemePref) => {
    setPrefState(p);
    prefStore.set(p).catch(() => {});
  };

  const value = useMemo<ThemeContextValue>(
    () => ({ c, name, pref, setPref, spacing, radius, type, timing }),
    [c, name, pref],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}

/**
 * Pin one palette for a subtree, whatever the account's theme is.
 *
 * Signing in is a black brand moment in EVERY theme — the same decision the web
 * makes, and for the same reason: the Atwe mark is white, so on a white ground
 * it simply is not there, and the gate should look like the app icon rather
 * than like a setting. The moment somebody is signed in, their real theme takes
 * over.
 */
export function ForceTheme({ name, children }: { name: ThemeName; children: React.ReactNode }) {
  const outer = useContext(ThemeContext);
  const value = useMemo<ThemeContextValue>(() => ({
    c: palettes[name],
    name,
    // The PREFERENCE is untouched — this pins how one subtree looks, it does not
    // change what the account chose.
    pref: outer?.pref ?? 'system',
    setPref: outer?.setPref ?? (() => {}),
    spacing, radius, type, timing,
  }), [name, outer]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
