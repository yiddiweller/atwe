import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { realtime, type RtEvent } from '@/api/sse';

/**
 * Subscribe to one live event for as long as a screen is on screen.
 * Unsubscribes on the way out, so a screen that has been left never keeps
 * reacting to messages arriving somewhere else.
 */
export function useRealtime(event: RtEvent | '*', handler: (data: unknown, e: RtEvent) => void) {
  useEffect(() => realtime.on(event, handler), [event, handler]);
}

/**
 * The common case: something happened, so these queries are stale. Given to
 * React Query rather than hand-patching a list, which is how a list and its
 * server drift apart.
 */
export function useRealtimeInvalidate(events: RtEvent[], keys: unknown[][]) {
  const qc = useQueryClient();
  useEffect(() => {
    const offs = events.map((e) =>
      realtime.on(e, () => { for (const k of keys) qc.invalidateQueries({ queryKey: k }); }),
    );
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, JSON.stringify(events), JSON.stringify(keys)]);
}
