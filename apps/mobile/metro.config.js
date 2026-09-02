const { withNxMetro } = require('@nx/expo');
const { getDefaultConfig } = require('@expo/metro-config');
const { mergeConfig } = require('metro-config');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const customConfig = {
  cacheVersion: '@bigmind/mobile',
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...sourceExts, 'cjs', 'mjs', 'svg'],
  },
};

const metroConfig = withNxMetro(mergeConfig(defaultConfig, customConfig), {
  // Change this to true to see debugging info.
  // Useful if you have issues resolving modules
  debug: false,
  // all the file extensions used for imports other than 'ts', 'tsx', 'js', 'jsx', 'json'
  extensions: [],
  // Specify folders to watch, in addition to Nx defaults (workspace libraries and node_modules)
  watchFolders: [],
});

// `withNxMetro` forces `projectRoot` to the Nx workspace root so that module
// resolution paths are workspace-relative (Expo SDK 54+). However, that breaks
// (1) Babel config lookup, which makes @expo/metro-config silently inject an
// extra `babel-preset-expo` on top of this project's `.babelrc.js` (causing
// "Duplicate __self prop" errors in development) and
// (2) asset serving, where paths like `assets/images/icon.png` from `app.json`
// are resolved against `projectRoot`, i.e. `/workspace/assets/...` (404).
//
// Pointing `projectRoot` back at this app directory is the standard Expo setup
// and still works with the Nx resolver (it falls back to the workspace root
// internally via `@nx/devkit`'s `workspaceRoot`).
metroConfig.projectRoot = __dirname;

module.exports = metroConfig;
