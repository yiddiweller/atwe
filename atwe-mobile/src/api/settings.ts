import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/**
 * The settings the server owns — everything else on the Settings screens is a
 * per-device preference and lives in the theme provider or `haptics`.
 *
 * Two endpoints, because the server has two: `/api/privacy` holds the pair that
 * are reciprocal by design (a read receipt you send is one you get), and
 * `/api/account-privacy` holds the visibility switches.
 */
export interface Privacy {
  readReceipts: boolean;
  privateProfileViews: boolean;
}

export interface AccountPrivacy {
  presenceVisibility: 'everyone' | 'connections' | 'nobody';
  connectionsVisible: boolean;
  whoCanRequest: 'everyone' | 'network' | 'nobody';
  whoCanAddGroups: 'everyone' | 'connections' | 'nobody';
  shareProfileUpdates: boolean;
  personalized: boolean;
  allowRemix: boolean;
  silenceUnknownCallers: boolean;
  dndEnabled: boolean;
  dndStartMin: number;
  dndEndMin: number;
  dndTzOffset: number;
}

export function useAccountPrivacy() {
  return useQuery({
    queryKey: ['account-privacy'],
    queryFn: () => api.get<AccountPrivacy>('/api/account-privacy'),
    staleTime: 30_000,
  });
}

export function useSaveAccountPrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AccountPrivacy>) =>
      api.put<{ ok: true }>('/api/account-privacy', patch),
    /* Paint the switch immediately and roll it back if the server says no — a
       toggle that waits for a round-trip before it moves feels broken. */
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['account-privacy'] });
      const prev = qc.getQueryData<AccountPrivacy>(['account-privacy']);
      if (prev) qc.setQueryData(['account-privacy'], { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(['account-privacy'], ctx.prev);
    },
  });
}

/** `readReceipts` / `privateProfileViews` ride on `/api/auth/me`, so the source
 *  of truth for them is the signed-in user, not a query of their own. */
export function useSavePrivacy() {
  return useMutation({
    mutationFn: (patch: Partial<Privacy>) =>
      api.put<{ ok: true } & Privacy>('/api/privacy', patch),
  });
}

export interface NotifCategory { key: string; label: string; on: boolean }

export function useNotifPrefs() {
  return useQuery({
    queryKey: ['notif-prefs'],
    queryFn: () => api.get<{ categories: NotifCategory[]; cartRemindersOff: boolean }>('/api/notification-prefs'),
    staleTime: 30_000,
  });
}

export function useSaveNotifPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Record<string, boolean>) =>
      api.put<{ ok: true }>('/api/notification-prefs', { prefs }),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: ['notif-prefs'] });
      const prev = qc.getQueryData<{ categories: NotifCategory[]; cartRemindersOff: boolean }>(['notif-prefs']);
      if (prev) {
        qc.setQueryData(['notif-prefs'], {
          ...prev,
          categories: prev.categories.map((c) => (c.key in prefs ? { ...c, on: prefs[c.key] } : c)),
        });
      }
      return { prev };
    },
    onError: (_e, _p, ctx) => { if (ctx?.prev) qc.setQueryData(['notif-prefs'], ctx.prev); },
  });
}
