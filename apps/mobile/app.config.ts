import type { ExpoConfig } from 'expo/config';
import { withAndroidManifest } from '@expo/config-plugins';

function env(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const appVariant = env('EXPO_APP_VARIANT') ?? 'production';
const isDevelopmentVariant = appVariant === 'development';
const isE2EMode = env('EXPO_PUBLIC_E2E_MODE') === '1';
const e2eServerUrl = env('EXPO_PUBLIC_E2E_SERVER_URL');
const googleMobileRedirectUri = env('EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI');
const googleRedirectScheme = googleMobileRedirectUri?.match(/^([a-z][a-z0-9+.-]*):/i)?.[1];
const defaultAndroidPackage = 'app.getopencode';
const releaseAndroidPackage = env('EXPO_ANDROID_PACKAGE') ?? defaultAndroidPackage;
const developmentAndroidPackage = env('EXPO_ANDROID_PACKAGE_DEV') ?? `${releaseAndroidPackage}.dev`;
const androidPackage = isDevelopmentVariant ? developmentAndroidPackage : releaseAndroidPackage;
const releaseIosBundleIdentifier = 'org.visaliacrc.rhythm.agents';
const developmentIosBundleIdentifier = `${releaseIosBundleIdentifier}.dev`;
const iosBundleIdentifier = isDevelopmentVariant
  ? developmentIosBundleIdentifier
  : releaseIosBundleIdentifier;

const withCleartextTraffic = (config: ExpoConfig) => withAndroidManifest(config, (config) => {
  const application = config.modResults.manifest.application?.[0];
  if (application) application.$['android:usesCleartextTraffic'] = 'true';
  return config;
});

const config: ExpoConfig = {
  name: isDevelopmentVariant ? 'Rhythm Agents Dev' : 'Rhythm Agents',
  slug: 'rhythm-mobile',
  owner: 'ajhochys-team',
  version: '1.0.8',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: googleRedirectScheme
    ? ['rhythmagents', googleRedirectScheme]
    : 'rhythmagents',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  android: {
    package: androidPackage,
    versionCode: 7,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: "#202020"
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  ios: {
    bundleIdentifier: iosBundleIdentifier,
    buildNumber: '1',
    supportsTablet: false,
    infoPlist: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-camera',
      {
        cameraPermission: 'Allow $(PRODUCT_NAME) to scan a one-time Mac pairing code.',
        barcodeScannerEnabled: true,
      },
    ],
    'expo-notifications',
    'expo-background-task',
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Allow $(PRODUCT_NAME) to access the microphone for voice input.',
        speechRecognitionPermission: 'Allow $(PRODUCT_NAME) to convert speech to text on your device.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox', 'com.google.android.as'],
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          backgroundColor: '#000000',
        },
      },
    ],
    withCleartextTraffic as unknown as string,
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    e2eMode: isE2EMode,
    e2eServerUrl,
    eas: { projectId: 'bd873c89-2fe2-45db-805c-ab819e582e5c' },
  },
};

export default config;
