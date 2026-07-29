import type { ExpoConfig } from 'expo/config';
import {
  withAndroidManifest,
  withInfoPlist,
} from '@expo/config-plugins';

function env(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const appVariant = env('EXPO_APP_VARIANT') ?? 'production';
if (appVariant !== 'production' && appVariant !== 'development') {
  throw new Error(
    `Unsupported EXPO_APP_VARIANT "${appVariant}". Expected "production" or "development".`,
  );
}

const isDevelopmentVariant = appVariant === 'development';
const isE2EMode = env('EXPO_PUBLIC_E2E_MODE') === '1';
const allowLocalHttp = isDevelopmentVariant || isE2EMode;
const e2eServerUrl = env('EXPO_PUBLIC_E2E_SERVER_URL');
const googleMobileClientId = env('EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID');
const googleMobileRedirectUri = env('EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI');
const googleRedirectScheme = googleMobileRedirectUri?.match(/^([a-z][a-z0-9+.-]*):/i)?.[1];
const rhythmCloudUrl = env('EXPO_PUBLIC_RHYTHM_CLOUD_URL');
const productionCloudOrigin = 'https://api.vcrcapps.com';
const googleClientSuffix = '.apps.googleusercontent.com';

if (isE2EMode && !isDevelopmentVariant) {
  throw new Error(
    'EXPO_PUBLIC_E2E_MODE is forbidden for production mobile builds.',
  );
}
if (isE2EMode && !e2eServerUrl) {
  throw new Error(
    'EXPO_PUBLIC_E2E_SERVER_URL is required when EXPO_PUBLIC_E2E_MODE=1.',
  );
}

if (!isDevelopmentVariant) {
  if (e2eServerUrl) {
    throw new Error(
      'EXPO_PUBLIC_E2E_SERVER_URL is forbidden for production mobile builds.',
    );
  }
  if (
    !googleMobileClientId ||
    !/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(
      googleMobileClientId,
    )
  ) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID must be an exact Google mobile OAuth client ID for production.',
    );
  }
  const clientStem = googleMobileClientId.slice(0, -googleClientSuffix.length);
  const expectedRedirectUri =
    `com.googleusercontent.apps.${clientStem}:/oauthredirect`;
  if (googleMobileRedirectUri !== expectedRedirectUri) {
    throw new Error(
      `EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI must exactly match ${expectedRedirectUri}.`,
    );
  }
  let cloudUrl: URL;
  try {
    cloudUrl = new URL(rhythmCloudUrl ?? '');
  } catch {
    throw new Error(
      `EXPO_PUBLIC_RHYTHM_CLOUD_URL must be the approved HTTPS origin ${productionCloudOrigin}.`,
    );
  }
  if (
    cloudUrl.origin !== productionCloudOrigin ||
    cloudUrl.protocol !== 'https:' ||
    cloudUrl.username ||
    cloudUrl.password ||
    (cloudUrl.pathname !== '' && cloudUrl.pathname !== '/') ||
    cloudUrl.search ||
    cloudUrl.hash
  ) {
    throw new Error(
      `EXPO_PUBLIC_RHYTHM_CLOUD_URL must be the approved HTTPS origin ${productionCloudOrigin}.`,
    );
  }
}

const defaultAndroidPackage = 'app.getopencode';
const releaseAndroidPackage = env('EXPO_ANDROID_PACKAGE') ?? defaultAndroidPackage;
const developmentAndroidPackage = env('EXPO_ANDROID_PACKAGE_DEV') ?? `${releaseAndroidPackage}.dev`;
const androidPackage = isDevelopmentVariant ? developmentAndroidPackage : releaseAndroidPackage;
const releaseIosBundleIdentifier = 'org.visaliacrc.rhythm.agents';
const developmentIosBundleIdentifier = `${releaseIosBundleIdentifier}.dev`;
const iosBundleIdentifier = isDevelopmentVariant
  ? developmentIosBundleIdentifier
  : releaseIosBundleIdentifier;

const withTransportSecurity = (config: ExpoConfig) => {
  const withIos = withInfoPlist(config, (modConfig) => {
    if (allowLocalHttp) {
      modConfig.modResults.NSAppTransportSecurity = {
        // Development and E2E clients pair to a Mac by LAN/Tailscale IP,
        // not only localhost.
        NSAllowsArbitraryLoads: true,
      };
    } else {
      // expo-dev-client and some native plugins add permissive development
      // defaults during introspection. Production must remove them after all
      // plugins have run.
      delete modConfig.modResults.NSAppTransportSecurity;
    }
    return modConfig;
  });

  return withAndroidManifest(withIos, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:usesCleartextTraffic'] = allowLocalHttp
        ? 'true'
        : 'false';
    }
    return modConfig;
  });
};

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
      backgroundColor: "#FFFFFF"
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
    // Prebuild writes this into the generated Xcode project's
    // DEVELOPMENT_TEAM build setting. Without it a local `xcodebuild
    // archive` fails with "Signing for RhythmAgents requires a development
    // team" — EAS injects credentials remotely, so only local builds notice.
    appleTeamId: env('EXPO_APPLE_TEAM_ID') ?? '56Q69NYP9H',
    buildNumber: '1',
    supportsTablet: false,
    infoPlist: allowLocalHttp
      ? {
          NSAppTransportSecurity: {
            NSAllowsArbitraryLoads: true,
          },
        }
      : {},
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
    withTransportSecurity as unknown as string,
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
