import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/**
 * A tiny signal so the opening splash can hold on pure black until the Home feed
 * has actually loaded, then zoom-reveal straight into the posts (X-style) — no
 * "logo, then a second black home screen, then posts" double wait.
 *
 * Home calls `markFeedReady()` the moment its first feed page settles; the root
 * layout gates the splash reveal on it.
 */
const Ctx = createContext<{ feedReady: boolean; markFeedReady: () => void }>({
  feedReady: false,
  markFeedReady: () => {},
});

export function AppReadyProvider({ children }: { children: ReactNode }) {
  const [feedReady, setFeedReady] = useState(false);
  const markFeedReady = useCallback(() => setFeedReady(true), []);
  return <Ctx.Provider value={{ feedReady, markFeedReady }}>{children}</Ctx.Provider>;
}

export const useAppReady = () => useContext(Ctx);
