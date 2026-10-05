import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { api, ApiError } from '@/api/client';
import { nativeLink, type NativeLink } from './atwe-routes';

/**
 * Opening an Atwe link from outside the app — a shared profile, a post someone
 * sent you, a notification you tapped — and landing on the right screen.
 *
 * THE APP DOES NOT KEEP ITS OWN LIST OF ADDRESSES (route batch 10). `atwe-routes.js`
 * beside this file is a generated copy of the web's route registry, and every
 * decision is made there by `nativeLink()`:
 *   · it understands the CANONICAL atwe.com addresses (and their permanent legacy
 *     aliases), on any of our hosts, on the atwe:// scheme, or as a bare /path;
 *   · it decides "app or browser" by evaluating the SAME components the AASA file is
 *     generated from, so a link the iPhone hands to the app is one the app claims, and
 *     one the app does not render is never captured — it opens in Safari;
 *   · a route the app has a screen for maps to that screen; one it has no screen for
 *     is declared, explicitly, as a browser route.
 *
 * The old native-only shapes (atwe://user/sam, /chat/12, a bare /post/:id treated as a
 * profile, a 2–30 character handle rule) were never issued outside the app and are not
 * atwe.com addresses, so they are gone: atwe://beam/u/sam means atwe.com/beam/u/sam.
 */
export { nativeLink };
export type { NativeLink };

/* ── Links that reach the app as a SYSTEM URL (universal link, atwe://, Android) ──
   expo-router consumes those itself and routes them by FILE PATH, so atwe.com/john would
   first land on its "Unmatched Route" screen. app/+native-intent.tsx calls systemPath(),
   which rewrites the address to the native screen before the router sees it. What the
   router cannot do on its own (ask the server for a DM's peer id, hand a web-only address
   to the browser, say "that page doesn't exist", replay a link that arrived while signed
   out) is queued here and finished by the root layout once somebody is signed in. */
let pending: string | null = null;
const listeners = new Set<() => void>();

export function systemPath(path: string, initial: boolean): string {
  let l: NativeLink | null = null;
  try { l = nativeLink(path); } catch { return path; }
  if (!l) return path; // not an Atwe link (an Expo dev URL, say) — leave it to the router
  pending = path;
  listeners.forEach((fn) => fn());
  if (l.kind === 'native' || l.kind === 'notfound') return l.path;
  // Resolve or browser: nothing to route yet. A cold start opens Home underneath.
  return initial ? '/' : '';
}
export function takePendingLink(): string | null { const p = pending; pending = null; return p; }
export function onPendingLink(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Kept for callers that only need a native path (null = not a native screen). */
export function routeForUrl(url: string): string | null {
  const l = nativeLink(url);
  return l && (l.kind === 'native' || l.kind === 'notfound') ? l.path : null;
}

/**
 * Follow a link. A browser route goes to the browser (the AASA excludes it, so iOS
 * opens Safari rather than handing it back to the app). A Beam conversation is keyed
 * by the person's numeric id, so the @username in the address is resolved by the
 * server first — the same lookup the web uses, which refuses an unknown handle and a
 * conversation you may not open with ONE identical "not found".
 */
export async function openLink(url: string, opts: { routed?: boolean } = {}): Promise<void> {
  const l = nativeLink(url);
  if (!l) return;
  if (l.kind === 'browser') { await Linking.openURL(l.url).catch(() => {}); return; }
  // `routed`: the router already took the app to l.path (systemPath rewrote it).
  if (opts.routed && l.kind === 'native') return;
  if (l.kind === 'notfound') {
    if (!opts.routed) router.push('/' as never);
    Alert.alert('Atwe', 'That page doesn’t exist.');
    return;
  }
  if (l.kind === 'resolve') {
    try {
      const who = await api.get<{ id: number }>(`/api/atchat/peer/${encodeURIComponent(l.value)}`);
      router.push(l.to.replace(':peer', String(who.id)) as never);
    } catch (e) {
      router.push('/beam' as never);
      // A 404 is the server's ONE answer for "no such person" and "not yours to open".
      Alert.alert('Atwe', e instanceof ApiError && e.status === 404
        ? 'That conversation doesn’t exist.'
        : 'Couldn’t open that conversation. Check your connection and try again.');
    }
    return;
  }
  router.push(l.path as never);
}

/** Follow a link now (a notification tap, or a link the app itself is handed). */
export function openUrl(url: string) { void openLink(url); }
