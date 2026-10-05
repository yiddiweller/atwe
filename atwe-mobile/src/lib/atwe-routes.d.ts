/**
 * Types for `atwe-routes.js` — a GENERATED, byte-for-byte copy of the web's route
 * registry (public/atwe-routes.js), written by `node tools/native-links.js`. Never edit
 * the .js by hand: the repo test fails if it differs from the original.
 * Only the parts the app uses are typed.
 */
export type NativeLink =
  | { kind: 'native'; path: string; route: string }
  | { kind: 'resolve'; resolve: 'peer'; value: string; to: string; route: string }
  | { kind: 'notfound'; path: string; route: null }
  | { kind: 'browser'; url: string; route: string | null };

export function nativeLink(url: string): NativeLink | null;
export function usernameShapeError(name: string): string | null;
export function match(pathname: string): { name: string; params: Record<string, string>; alias: boolean } | null;
