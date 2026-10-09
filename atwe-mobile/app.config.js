// ONE CODEBASE, TWO iPHONE APPS: Atwe and Atwe Beta.
//
// Expo reads app.json first and hands its `expo` object to this function as
// `config`. Whatever this returns is the app that gets built.
//
// PRODUCTION (every build, unless told otherwise): app.json exactly as written,
// untouched. Atwe, com.atwe.app, the atwe:// scheme, https://atwe.com, the
// atwe.com universal links, the existing App Store Connect app.
//
// BETA (only when the build profile sets APP_VARIANT=beta, which only the
// `beta` profile in eas.json does): a SEPARATE app, Atwe Beta.
//
//   name                  Atwe Beta
//   iOS bundle id         com.atwe.app.beta
//   Android package       com.atwe.app.beta
//   scheme                atwe-beta://
//   server                https://beta.atwe.com
//   universal links       none (the associatedDomains key is REMOVED)
//   Android app links     none (the intentFilters key is REMOVED)
//
// Different bundle id = a different app to the phone, so Atwe Beta installs
// BESIDE the real Atwe instead of replacing it, keeps its own sign-in, and can
// never be mistaken for it. It goes to its own App Store Connect app
// (submit.beta in eas.json) and is for private TestFlight testing only: it is
// NEVER submitted for review or released on the App Store.
//
// Three details are deliberate:
//   * The keys are DELETED, not emptied. An empty associatedDomains list still
//     writes an (empty) Associated Domains entitlement into the beta app, and
//     the beta app must claim no atwe.com links at all. Only the production
//     app may open atwe.com links.
//   * The scheme is a DIFFERENT word, not a missing one. Two installed apps
//     claiming atwe:// would leave iOS free to open either, and an app with no
//     scheme makes expo-linking throw on every launch of a release build.
//   * An APP_VARIANT this file does not know stops the build instead of
//     guessing. A typo must never quietly produce some third identity.
//
// Kept to plain JavaScript with no imports so test/release-config.test.js can
// load it and check both results without installing anything.

const BETA = {
  name: 'Atwe Beta',
  scheme: 'atwe-beta',
  bundleIdentifier: 'com.atwe.app.beta',
  androidPackage: 'com.atwe.app.beta',
  apiUrl: 'https://beta.atwe.com',
};

// A copy of `obj` without `key`: the key is gone, not set to undefined or [].
const without = (obj, key) => {
  const copy = { ...obj };
  delete copy[key];
  return copy;
};

module.exports = ({ config }) => {
  const variant = process.env.APP_VARIANT;

  // Production: app.json, unchanged.
  if (!variant) return config;

  if (variant !== 'beta') {
    throw new Error(
      `app.config.js: unknown APP_VARIANT "${variant}". The only variant is "beta" ` +
        '(set by the beta build profile in eas.json). Leave it unset for the production app.',
    );
  }

  return {
    ...config,
    name: BETA.name,
    scheme: BETA.scheme,
    ios: {
      ...without(config.ios || {}, 'associatedDomains'),
      bundleIdentifier: BETA.bundleIdentifier,
    },
    android: {
      ...without(config.android || {}, 'intentFilters'),
      package: BETA.androidPackage,
    },
    extra: {
      ...config.extra,
      apiUrl: BETA.apiUrl,
    },
  };
};
