import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { API_URL } from '@/api/config';
import { realtime } from '@/api/sse';

/**
 * Whether the phone can actually reach Atwe.
 *
 * Deliberately not NetInfo: "the wifi is connected" and "Atwe answers" are
 * different questions, and it is the second one that matters — a hotel network
 * that has not been logged into looks perfectly connected. So this asks the
 * server, cheaply, and only when there is reason to.
 *
 * It also does the resume work an app needs on iOS: coming back from the
 * background silently kills the live connection, so returning to the app
 * re-checks and reconnects.
 */
interface ConnectionValue {
  online: boolean;
  /** Just came back after being away — the banner shows briefly, then goes. */
  justBack: boolean;
  check: () => Promise<boolean>;
}
const Ctx = createContext<ConnectionValue>({ online: true, justBack: false, check: async () => true });

const PING_MS = 20000;

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(true);
  const [justBack, setJustBack] = useState(false);
  const wasOffline = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`${API_URL}/api/health`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
      const ok = r.ok;
      setOnline(ok);
      if (ok && wasOffline.current) {
        // Back after a gap: say so briefly, and re-open the live connection,
        // which will have been dropped while there was no network.
        wasOffline.current = false;
        setJustBack(true);
        realtime.reconnect();
        setTimeout(() => setJustBack(false), 2200);
      }
      if (!ok) wasOffline.current = true;
      return ok;
    } catch {
      wasOffline.current = true;
      setOnline(false);
      return false;
    }
  }, []);

  useEffect(() => {
    void check();
    // Poll gently while offline, rarely while fine — nobody needs a heartbeat
    // every few seconds when everything is working.
    const tick = () => {
      timer.current = setTimeout(async () => {
        await check();
        tick();
      }, online ? PING_MS * 3 : PING_MS / 4);
    };
    tick();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [check, online]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      // iOS freezes a backgrounded app and quietly drops its live connection —
      // it may even still look open. Coming back always re-checks.
      if (s === 'active') { void check(); realtime.reconnect(); }
    });
    return () => sub.remove();
  }, [check]);

  return <Ctx.Provider value={{ online, justBack, check }}>{children}</Ctx.Provider>;
}

export function useConnection() { return useContext(Ctx); }
