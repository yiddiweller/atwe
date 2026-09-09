import appJson from '../../app.json';

/**
 * The app's version, from the ONE place that decides it.
 *
 * It used to come from `Constants.expoConfig?.version`, which is the runtime
 * manifest — and the manifest is not always the file: a web export reported
 * `0.1.0`, a number that appears in neither app.json (0.5.0) nor package.json
 * (0.2.0), so a bug report arrived stamped with a version that never existed.
 * A version on a support ticket is the first thing anybody checks; one that is
 * wrong is worse than none.
 *
 * Reading app.json directly removes the guessing — Metro bundles JSON, so this
 * is the literal string EAS builds from. `package.json`'s version is kept in
 * step with it for the same reason: two fields that can disagree eventually do.
 */
export const APP_VERSION: string = appJson.expo.version;

/** What TestFlight shows beside it. EAS auto-increments the real one, so this
 *  is only the local baseline and is deliberately not shown on its own. */
export const IOS_BUILD: string | undefined = appJson.expo.ios?.buildNumber;

/**
 * YEAR-STYLE VERSIONS — the founder's scheme, 9 Sep 2026.
 *
 *   26.8 Beta   now, on every real app (iPhone, Android, desktop)
 *   27.0        beginning of 2027 — all platforms done, official public release, NO "Beta"
 *   28.0        1 Jan 2028 — Atwe Inc officially begins, with the marketing campaign
 *
 * The year leads, the way iOS 26 does, so a version says WHEN rather than how many
 * releases have happened. **The WEB APP has no version at all** — a website is always
 * the newest one — only a build number; do not add one back.
 *
 * `app.json` carries the store-safe three-part form (`26.8.0`) because npm's own
 * `version` field must be valid semver and the two files are deliberately kept
 * identical. What a person SEES is derived from it here rather than typed a second
 * time — this repo has been bitten more than once by a literal that stopped tracking
 * what it was derived from.
 */

/** The word after the number. Empty string from 27.0 onwards — that is the whole
 *  change when the public release lands; nothing else here moves. */
export const RELEASE_CHANNEL: string = 'Beta';

/** `26.8.0` -> `26.8`. A trailing `.0` patch is store bookkeeping, not something to
 *  show; `26.8.1` keeps its patch, because then it means something. */
const trimPatch = (v: string): string => v.replace(/^(\d+\.\d+)\.0$/, '$1');

/** What the app shows a person: `26.8 Beta`, then `27.0`. */
export const VERSION_LABEL: string =
  (trimPatch(APP_VERSION) + (RELEASE_CHANNEL ? ' ' + RELEASE_CHANNEL : '')).trim();
