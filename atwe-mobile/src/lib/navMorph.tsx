import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * Shared signal that lets the Home feed drive the bottom tab bar's scroll-morph
 * (bar → white "+" ball) — the same effect as the web, but for the native custom
 * glass tab bar. `collapsed` (0 = full bar, 1 = ball) animates the morph on the UI
 * thread; `ball` is a JS mirror used only for pointer-events (tabs vs the + ball).
 */
type NavMorph = {
  collapsed: SharedValue<number>;
  ball: boolean;
  setBall: (on: boolean) => void;
};

const Ctx = createContext<NavMorph | null>(null);

export function NavMorphProvider({ children }: { children: ReactNode }) {
  const collapsed = useSharedValue(0);
  const [ball, setBallState] = useState(false);
  const setBall = useCallback((on: boolean) => setBallState((cur) => (cur === on ? cur : on)), []);
  return <Ctx.Provider value={{ collapsed, ball, setBall }}>{children}</Ctx.Provider>;
}

export function useNavMorph() {
  return useContext(Ctx);
}
