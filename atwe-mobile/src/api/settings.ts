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

/* ── Devices & sessions ───────────────────────────────────────────────────── */

export interface Session {
  id: number;
  userAgent: string;
  ip: string;
  /** Roughly where, from the IP — often empty, and empty is fine. */
  location: string;
  created_at: string;
  last_seen: string;
  /** The one you are holding. It cannot be signed out from itself here — use
   *  Sign out — so it is shown without the action rather than with a dead one. */
  current: boolean;
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<{ sessions: Session[] }>('/api/auth/sessions'),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/api/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

/** Signs out EVERY device, this one included — so the caller must expect to be
 *  thrown back to the login screen, not just see a shorter list. */
export function signOutEverywhere() {
  return api.del<{ ok: true }>('/api/auth/sessions');
}

/** A device string is not a device NAME. This turns the useful part of a user
 *  agent into something a person recognises. */
export function deviceName(ua: string): string {
  if (!ua) return 'Unknown device';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Web browser';
}

/* ── Your data ────────────────────────────────────────────────────────────── */

/** The owner-scoped bundle — everything of yours, no secrets. Returned as JSON
 *  so the caller can hand it to the share sheet. */
export function exportMyData() {
  return api.get<Record<string, unknown>>('/api/account/export');
}

/** Reversible: signing back in reactivates it. Password-gated server-side, so a
 *  stolen unlocked phone cannot hide somebody's account. */
export function deactivateAccount(password: string) {
  return api.post<{ ok: true }>('/api/account/deactivate', { password });
}

/* ── Feedback ─────────────────────────────────────────────────────────────── */

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'question', 'other'] as const;
export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];

/** Straight into the support inbox staff already work — not an email link that
 *  opens a mail app somebody may not have set up. */
export function sendFeedback(v: { category: FeedbackCategory; body: string; build?: string }) {
  return api.post<{ ok: true }>('/api/feedback', { ...v, platform: 'ios' });
}
