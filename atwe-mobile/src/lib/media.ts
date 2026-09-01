import { API_URL } from '@/api/config';

/**
 * Make a server-hosted media path usable on a phone.
 *
 * The backend does NOT ship stored photos inline. Anything over 2KB is rewritten
 * by `mediaRef()` into a signed, RELATIVE path — `/api/media/<kind>/<id>/<idx>/<sig>`
 * — which is exactly right in a browser and completely wrong here: React Native
 * has no document origin, so `<Image source={{ uri: '/api/media/…' }} />` resolves
 * to nothing and renders blank. Every real photo in the app arrives that way
 * (avatars, post images, DM and group media, story media, listing covers,
 * banners), so a relative path must be joined to the API base before it is used.
 *
 * Everything else passes through untouched: a `data:` URL (small images and the
 * signed-in account's own avatar still come inline), an absolute `http(s)` URL
 * (remote demo photos, Tenor GIFs), and a protocol-relative `//host/…`, which is
 * likewise meaningless without a document and is given https.
 *
 * Returns `undefined` rather than `''` for nothing, so a caller can hand it
 * straight to a `source` prop and have the image simply not render.
 */
export function mediaUri(v?: string | null): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  if (v.startsWith('//')) return `https:${v}`;
  if (v.startsWith('/')) return `${API_URL}${v}`;
  return v;
}
