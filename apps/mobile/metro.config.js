const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const appVariant = process.env.EXPO_APP_VARIANT || 'production';
const e2eMode = process.env.EXPO_PUBLIC_E2E_MODE === '1';
if (e2eMode && appVariant !== 'development') {
  throw new Error(
    'The E2E Metro runtime is allowed only with EXPO_APP_VARIANT=development.',
  );
}
const runtimeVariant = e2eMode
  ? 'mobile-runtime.e2e.ts'
  : appVariant === 'development'
    ? 'mobile-runtime.development.ts'
    : 'mobile-runtime.production.ts';
const runtimePath = path.resolve(
  __dirname,
  'lib',
  'runtime',
  runtimeVariant,
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@rhythm/mobile-runtime') {
    return context.resolveRequest(context, runtimePath, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
