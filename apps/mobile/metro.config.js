// Expo's default config auto-detects the monorepo (watch folders, workspace
// node_modules). The custom resolveRequest below lets Metro consume workspace
// TypeScript source that uses NodeNext-style `./file.js` relative imports
// (the tsc ESM convention): resolve normally first, and on failure retry with
// the `.js` suffix stripped so Metro finds the `.ts` source.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    if (
      moduleName.endsWith(".js") &&
      (moduleName.startsWith("./") || moduleName.startsWith("../"))
    ) {
      return resolve(context, moduleName.slice(0, -3), platform);
    }
    throw error;
  }
};

module.exports = config;
