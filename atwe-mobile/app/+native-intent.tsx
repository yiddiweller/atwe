import { systemPath } from '@/lib/deeplinks';

/**
 * Every URL the system hands the app — a universal link from atwe.com, an atwe://
 * link, an Android app link — passes through here BEFORE expo-router routes it, so a
 * canonical web address lands on its native screen instead of the router's
 * "Unmatched Route" page. The decision is the shared route registry's (route batch 10);
 * see src/lib/deeplinks.ts. It must never throw: a throw here can crash the app.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try { return systemPath(path, initial); } catch { return initial ? '/' : ''; }
}
