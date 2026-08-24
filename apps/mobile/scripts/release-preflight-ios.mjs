import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const easCliVersion = '21.2.0';
const expectedProjectId = 'bd873c89-2fe2-45db-805c-ab819e582e5c';
const approvedCloudOrigin = 'https://api.vcrcapps.com';
const nonInteractiveEnvironment = {
  ...process.env,
  CI: '1',
};

function fail(message) {
  throw new Error(`[release-preflight] ${message}`);
}

function runEas(args) {
  const result = spawnSync(
    'npm',
    [
      'exec',
      '--yes',
      `--package=eas-cli@${easCliVersion}`,
      '--',
      'eas',
      ...args,
    ],
    {
      cwd: appRoot,
      encoding: 'utf8',
      env: nonInteractiveEnvironment,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    fail(
      `EAS ${args[0]} failed in non-interactive mode. Provide a valid EXPO_TOKEN or authenticate EAS before release.`,
    );
  }
  return `${result.stdout}\n${result.stderr}`;
}

if ((process.env.EXPO_APP_VARIANT ?? 'production') !== 'production') {
  fail('EXPO_APP_VARIANT=production is required.');
}
if (process.env.EXPO_PUBLIC_E2E_MODE === '1') {
  fail('E2E mode is forbidden for an iOS production release.');
}
if (
  process.env.EXPO_PUBLIC_RHYTHM_CLOUD_URL !== approvedCloudOrigin
) {
  fail(
    `EXPO_PUBLIC_RHYTHM_CLOUD_URL must be ${approvedCloudOrigin}.`,
  );
}
for (const name of [
  'EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI',
]) {
  if (!process.env[name]?.trim()) fail(`${name} is required.`);
}

const easConfig = JSON.parse(
  readFileSync(join(appRoot, 'eas.json'), 'utf8'),
);
if (easConfig.cli?.version !== easCliVersion) {
  fail(`eas.json must pin EAS CLI ${easCliVersion}.`);
}
if (easConfig.build?.production?.credentialsSource !== 'remote') {
  fail(
    'The production profile must use authenticated remote Apple credentials.',
  );
}

const packageJson = JSON.parse(
  readFileSync(join(appRoot, 'package.json'), 'utf8'),
);
const productionCommand = packageJson.scripts?.['eas:production:ios'] ?? '';
if (
  !productionCommand.includes(`eas-cli@${easCliVersion}`) ||
  !productionCommand.includes('--non-interactive') ||
  !productionCommand.includes('--freeze-credentials') ||
  !productionCommand.includes('--auto-submit-with-profile production')
) {
  fail(
    'The production EAS command must be version-pinned, non-interactive, freeze remote Apple credentials, and auto-submit its exact artifact.',
  );
}
if (!easConfig.submit?.production?.ios) {
  fail('eas.json must define the repository-owned production iOS submit profile.');
}
// An empty `ios: {}` satisfied the check above but makes `eas submit
// --non-interactive` prompt for the App Store app, which fails in CI (#1175).
if (!easConfig.submit.production.ios.ascAppId?.toString().trim()) {
  fail(
    'eas.json submit.production.ios must set ascAppId, or non-interactive TestFlight submit prompts and fails.',
  );
}

runEas(['whoami']);
const projectInfo = runEas(['project:info']);
if (!projectInfo.includes(expectedProjectId)) {
  fail(
    `Authenticated EAS project does not match required projectId ${expectedProjectId}.`,
  );
}

console.log(
  'Authenticated EAS identity, project ID, and remote Apple credential prerequisites verified.',
);
