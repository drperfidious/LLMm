const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

//const localPackagePaths = ['localpath/code/llama.rn'];

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */

const defaultConfig = getDefaultConfig(__dirname);
const {assetExts, sourceExts} = defaultConfig.resolver;
const useDebugPhonemizeShim =
  process.env.CONFIGURATION === 'Debug' ||
  process.env.POCKETPAL_SHIM_PHONEMIZE === '1';

const config = {
  resolver: {
    //nodeModulesPaths: [...localPackagePaths], // update to resolver
    assetExts: assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg'],
    resolveRequest: (context, moduleName, platform) => {
      if (useDebugPhonemizeShim && moduleName === 'phonemize') {
        return {
          type: 'sourceFile',
          filePath: path.join(__dirname, 'src/shims/phonemizeDebugShim.ts'),
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  transformer: {
    babelTransformerPath: require.resolve(
      'react-native-svg-transformer/react-native',
    ),
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
    // Make sure decorators are properly transformed
    enableBabelRuntime: true,
  },
  //watchFolders: [...localPackagePaths],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
