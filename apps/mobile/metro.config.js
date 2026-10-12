/**
 * MoneyMart mobile — Metro bundler configuration.
 *
 * Two things Metro must be told explicitly in a pnpm monorepo:
 *  1. where the shared workspace packages live (@moneymart/tokens, @moneymart/types)
 *  2. how to resolve `react-native-web` subpaths, because pnpm links it into
 *     apps/mobile/node_modules while Metro resolves some imports from packages
 *     inside the .pnpm store, where that symlink is not on the walk-up path.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so edits to shared packages hot-reload the app.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Follow pnpm's symlinked store rather than treating links as opaque.
config.resolver.unstable_enableSymlinks = true;

// 4. Pin react-native-web (including every subpath) to its real location so
//    imports from inside the pnpm store resolve without a symlink walk-up.
const reactNativeWeb = path.dirname(require.resolve('react-native-web/package.json'));
const previousResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-web' || moduleName.startsWith('react-native-web/')) {
    const subpath = moduleName.replace(/^react-native-web\/?/, '');
    const target = subpath ? path.join(reactNativeWeb, subpath) : reactNativeWeb;
    return context.resolveRequest(context, target, platform);
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

// 5. Shared packages ship TypeScript source, so Metro must compile them too.
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx'];

// 6. Keep build output out of the bundle graph.
config.resolver.blockList = [/.*\/\.next\/.*/, /.*\/dist\/assets\/.*/];

module.exports = config;
