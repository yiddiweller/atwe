module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo (SDK 54+) auto-includes the Reanimated / Worklets babel
  // plugin when those packages are installed — no manual plugin entry needed.
  // (Adding 'react-native-reanimated/plugin' manually breaks on SDK 54, since
  // Reanimated 4 moved it to 'react-native-worklets/plugin'.)
  return {
    presets: ['babel-preset-expo'],
  };
};
