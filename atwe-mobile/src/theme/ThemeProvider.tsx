import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const [pref, setPrefState] = useState<ThemePref>('system');

  // Load saved preference once.
  useEffect(() => {
    SecureStore.getItemAsync(PREF_KEY).then((v) => {
      if (v === 'black' || v === 'light' || v === 'system') setPrefState(v);
    });
  }, []);

  const name: ThemeName = pref === 'system' ? (system === 'light' ? 'light' : 'black') : pref;
  const c = palettes[name];

  // Keep the native root background in sync (prevents white flash on nav).
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);

  const setPref = (p: ThemePref) => {
    setPrefState(p);
    SecureStore.setItemAsync(PREF_KEY, p).catch(() => {});
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
