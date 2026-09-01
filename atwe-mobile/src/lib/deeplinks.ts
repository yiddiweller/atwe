import * as Linking from 'expo-linking';
import { router } from 'expo-router';

/**
 * Opening an Atwe link from outside the app — a shared profile, a post someone
 * sent you, a notification you tapped — and landing on the right screen.
 *
 * Two shapes are handled, because both exist in the wild:
 *   atwe://user/sam            the app's own scheme
 *   https://atwe.com/sam       a link somebody shared from the web
 *
 * Anything not recognised opens the app rather than doing nothing, which is
 * always better than a tap that appears to fail.
 */
const WEB_HOSTS = ['atwe.com', 'www.atwe.com', 'atwe.ai', 'www.atwe.ai'];

export function routeForUrl(url: string): string | null {
  let parsed: Linking.ParsedURL;
  try { parsed = Linking.parse(url); } catch { return null; }
  const scheme = (parsed.scheme || '').toLowerCase();
  const host = (parsed.hostname || '').toLowerCase();
  const isHttp = scheme === 'http' || scheme === 'https';

  /* An http(s) link from a host that isn't ours is not ours to route.
     This used to fall through to "treat the hostname as the first path segment",
     which is right for `atwe://user/sam` (Linking puts `user` in hostname) and
     badly wrong for a web address: opening the app at `http://localhost/` parsed
     `localhost` as a handle and redirected the HOME SCREEN to /user/localhost.
     On a phone that path is normally dormant — a cold launch has no initial URL —
     but it is live on any build served over http, and it would send a shortened
     or wrapped link to a nonsense profile. */
  if (isHttp && host && !WEB_HOSTS.includes(host)) return null;

  const segs = [
    // Only the app's OWN scheme puts a meaningful segment in `hostname`.
    ...(!isHttp && host ? [host] : []),
    ...String(parsed.path || '').split('/').filter(Boolean),
  ];
  if (!segs.length) return null;
  const [a, b] = segs;

  switch (a) {
    case 'user': return b ? `/user/${encodeURIComponent(b)}` : null;
    case 'post': return b ? `/post/${encodeURIComponent(b)}` : null;
    case 'chat': return b ? `/chat/${encodeURIComponent(b)}` : null;
    case 'listing': return b ? `/listing/${encodeURIComponent(b)}` : null;
    case 'story': return b ? `/story/${encodeURIComponent(b)}` : null;
    case 'wallet': return '/wallet';
    case 'notifications': return '/notifications';
    case 'settings': return '/settings';
    case 'marketplace': return '/marketplace';
    default:
      // A bare /<username> is how the web shares a profile, so treat a single
      // unrecognised segment as a handle rather than dropping it.
      if (segs.length === 1 && /^[a-z0-9_]{2,30}$/i.test(a)) return `/user/${encodeURIComponent(a)}`;
      return null;
  }
}

/** Follow a link now (used when the app is already running). */
export function openUrl(url: string) {
  const to = routeForUrl(url);
  if (to) router.push(to as never);
}
