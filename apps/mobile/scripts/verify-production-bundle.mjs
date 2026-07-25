import { spawnSync } from 'node:child_process';
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const approvedCloudOrigin = 'https://api.vcrcapps.com';
const requiredProductionEnv = [
  'EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI',
  'EXPO_PUBLIC_RHYTHM_CLOUD_URL',
];
const productionEnv = {
  ...process.env,
  EXPO_APP_VARIANT: 'production',
  EXPO_PUBLIC_E2E_MODE: '',
  EXPO_PUBLIC_E2E_SERVER_URL: '',
};

function fail(message) {
  throw new Error(`[production-bundle] ${message}`);
}

for (const name of requiredProductionEnv) {
  if (!productionEnv[name]?.trim()) {
    fail(`${name} is required.`);
  }
}
if (productionEnv.EXPO_PUBLIC_RHYTHM_CLOUD_URL !== approvedCloudOrigin) {
  fail(
    `EXPO_PUBLIC_RHYTHM_CLOUD_URL must be ${approvedCloudOrigin}.`,
  );
}

function run(args, options = {}) {
  const result = spawnSync('npx', args, {
    cwd: options.cwd ?? appRoot,
    encoding: 'utf8',
    env: productionEnv,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(
      `${args.join(' ')} failed with exit ${result.status ?? 'unknown'}; ` +
        'resolve the production configuration or generated output before release.',
    );
  }
  return result.stdout;
}

function filesBelow(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function combinedText(root) {
  return filesBelow(root)
    .map((path) => readFileSync(path).toString('latin1'))
    .join('\n');
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'rhythm-production-verify-'));

try {
  const introspected = JSON.parse(
    run(['expo', 'config', '--type', 'introspect', '--json']),
  );
  if (
    introspected.extra?.e2eMode !== false ||
    introspected.extra?.e2eServerUrl !== undefined
  ) {
    fail('resolved production config contains a test gateway override.');
  }
  const infoPlist =
    introspected.ios?.infoPlist ?? {};
  const ats = infoPlist.NSAppTransportSecurity;
  if (
    ats?.NSAllowsArbitraryLoads === true ||
    ats?.NSAllowsLocalNetworking === true ||
    Object.keys(ats?.NSExceptionDomains ?? {}).length > 0
  ) {
    fail('resolved production iOS config contains an insecure ATS bypass.');
  }

  const exportRoot = join(temporaryRoot, 'export');
  run([
    'expo',
    'export',
    '--clear',
    '--platform',
    'ios',
    '--output-dir',
    exportRoot,
  ]);
  const exportedText = combinedText(exportRoot);
  const forbiddenBundleMarkers = [
    ['E2E cloud credential', 'e2e-cloud-session'],
    ['fake user identity', 'mobile-e2e@example.com'],
    ['test control transport', '__control'],
    ['test Device credential', 'e2e-device-token'],
    ['test gateway override', 'EXPO_PUBLIC_E2E_SERVER_URL'],
    ['test gateway override', 'e2eServerUrl'],
    ['test pairing action', 'pair-simulate-qr'],
    ['test identity cache scope', 'e2e-user'],
    ['development cleartext engine', 'http://127.0.0.1:4096'],
  ];
  for (const [label, marker] of forbiddenBundleMarkers) {
    if (exportedText.includes(marker)) {
      fail(`exported production bundle contains ${label}.`);
    }
  }
  for (const [label, value] of [
    ['Google mobile client ID', productionEnv.EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID],
    [
      'Google mobile redirect URI',
      productionEnv.EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI,
    ],
    ['approved Rhythm Cloud origin', approvedCloudOrigin],
  ]) {
    if (!exportedText.includes(value)) {
      fail(`exported production bundle is missing ${label}.`);
    }
  }

  const nativeProject = join(temporaryRoot, 'native-project');
  cpSync(appRoot, nativeProject, {
    recursive: true,
    filter(source) {
      const path = relative(appRoot, source);
      if (!path) return true;
      const first = path.split('/')[0];
      return ![
        '.expo',
        '.git',
        'android',
        'dist',
        'dist-e2e',
        'ios',
        'node_modules',
      ].includes(first);
    },
  });
  const nodeModules = join(appRoot, 'node_modules');
  if (!lstatSync(nodeModules).isDirectory() && !lstatSync(nodeModules).isSymbolicLink()) {
    fail('node_modules is unavailable for native production introspection.');
  }
  symlinkSync(nodeModules, join(nativeProject, 'node_modules'), 'dir');
  run(
    ['expo', 'prebuild', '--clean', '--no-install', '--platform', 'all'],
    { cwd: nativeProject },
  );

  const manifests = filesBelow(join(nativeProject, 'android')).filter(
    (path) => path.endsWith('AndroidManifest.xml'),
  );
  const applicationManifest = manifests.find((path) =>
    path.endsWith('app/src/main/AndroidManifest.xml'),
  );
  if (!applicationManifest) {
    fail('generated production AndroidManifest.xml is missing.');
  }
  const androidManifest = readFileSync(applicationManifest, 'utf8');
  if (
    !/android:usesCleartextTraffic="false"/.test(androidManifest) ||
    /android:usesCleartextTraffic="true"/.test(androidManifest)
  ) {
    fail('generated production Android manifest permits cleartext traffic.');
  }

  const plists = filesBelow(join(nativeProject, 'ios')).filter((path) =>
    path.endsWith('Info.plist'),
  );
  const appPlist = plists.find((path) =>
    readFileSync(path, 'utf8').includes('CFBundleURLTypes'),
  );
  if (!appPlist) {
    fail('generated production iOS Info.plist is missing.');
  }
  const plistText = readFileSync(appPlist, 'utf8');
  if (
    plistText.includes('NSAllowsArbitraryLoads') ||
    plistText.includes('NSAllowsLocalNetworking') ||
    plistText.includes('NSExceptionAllowsInsecureHTTPLoads')
  ) {
    fail('generated production iOS Info.plist contains an ATS bypass.');
  }

  console.log(
    'Production bundle and generated iOS/Android transport configuration verified.',
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
