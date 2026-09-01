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
