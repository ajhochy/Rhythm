import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const source = await readFile(
  new URL('../../scripts/build-android-release.mjs', import.meta.url),
  'utf8',
);
const securitySource = await readFile(
  new URL('../../scripts/android-signing-security.mjs', import.meta.url),
  'utf8',
).catch(() => '');
const allSource = `${source}\n${securitySource}`;
const securityModule = await import(
  new URL('../../scripts/android-signing-security.mjs', import.meta.url)
).catch(() => ({}));

test('issue-1225-c1: spawned Android signing argv never contains passwords', () => {
  // Regression caught: process listings expose store/key passwords supplied
  // through keytool and Gradle command-line arguments.
  const createPlan = securityModule.createAndroidSigningPlan;
  assert.equal(typeof createPlan, 'function');
  const plan = createPlan({
    keystorePath: '/tmp/release.keystore',
    keyAlias: 'release',
    keystorePassword: 'STORE_SENTINEL_9f83',
    keyPassword: 'KEY_SENTINEL_2d14',
    storeType: 'jks',
  });
  const argv = JSON.stringify([plan.keytool.args, plan.gradle.args]);
  assert.equal(argv.includes('STORE_SENTINEL_9f83'), false);
  assert.equal(argv.includes('KEY_SENTINEL_2d14'), false);
  assert.deepEqual(plan.keytool.args.slice(3, 5), [
    '-storepass:env',
    'RHYTHM_ANDROID_STORE_PASSWORD',
  ]);
});

test('issue-1225-c2: signing secrets use child-only environment and are scrubbed from the build process', () => {
  // Regression caught: release credentials remain in the long-lived Node
  // process environment and are inherited by unrelated child processes.
  const withSecrets = securityModule.withAndroidSigningSecrets;
  assert.equal(typeof withSecrets, 'function');
  const sourceEnv = {
    ANDROID_KEYSTORE_PASSWORD: 'STORE_SENTINEL_9f83',
    ANDROID_KEY_PASSWORD: 'KEY_SENTINEL_2d14',
  };
  let capturedPlan;
  withSecrets(sourceEnv, {
    keystorePath: '/tmp/release.keystore',
    keyAlias: 'release',
    storeType: 'jks',
  }, (plan) => {
    capturedPlan = plan;
    assert.equal(
      plan.gradle.env[
        'ORG_GRADLE_PROJECT_android.injected.signing.store.password'
      ],
      'STORE_SENTINEL_9f83',
    );
  });
  assert.equal('ANDROID_KEYSTORE_PASSWORD' in sourceEnv, false);
  assert.equal('ANDROID_KEY_PASSWORD' in sourceEnv, false);
  assert.equal(JSON.stringify(capturedPlan).includes('STORE_SENTINEL_9f83'), false);
  assert.equal(JSON.stringify(capturedPlan).includes('KEY_SENTINEL_2d14'), false);
});

test('issue-1225-c3: failed Android build output redacts signing secrets and argv', () => {
  // Regression caught: run() interpolates the full args array into an error,
  // echoing credentials into CI logs after a child failure.
  const runCommand = securityModule.runAndroidSigningCommand;
  assert.equal(typeof runCommand, 'function');
  const logs = [];
  assert.throws(
    () => runCommand(
      () => ({ status: 1 }),
      (message) => logs.push(message),
      './gradlew',
      ['assembleRelease', 'STORE_SENTINEL_9f83'],
      {},
    ),
    /Android signing command failed/,
  );
  const output = logs.join('\n');
  assert.equal(output.includes('STORE_SENTINEL_9f83'), false);
  assert.equal(output.includes('assembleRelease'), false);
  assert.equal(output, 'Command failed: ./gradlew');
});

test('issue-1225-c4: source guard rejects secret-bearing spawn and failure logging', () => {
  // Regression caught: future maintenance restores -P password arguments or
  // keytool's literal password argument without tripping CI.
  assert.match(allSource, /ANDROID_KEYSTORE_PASSWORD/);
  assert.match(allSource, /ANDROID_KEY_PASSWORD/);
  assert.doesNotMatch(allSource, /`-Pandroid\.injected\.signing\.(?:store|key)\.password=/);
  assert.doesNotMatch(allSource, /args\.join\(['"] ['"]\)/);
});

test('issue-1225-c5: production orchestration scrubs all signing inputs before prebuild', async () => {
  // Regression caught: Expo prebuild inherits base64 keystore material and
  // local signing paths even though it does not need either.
  assert.equal(
    typeof securityModule.runAndroidReleaseBuild,
    'function',
  );
  const root = await mkdtemp(path.join(os.tmpdir(), 'rhythm-signing-contract-'));
  const source = path.join(root, 'source.keystore');
  await writeFile(source, Buffer.alloc(256, 1));
  const env = {
    PATH: process.env.PATH,
    ANDROID_KEYSTORE_PASSWORD: 'STORE_SENTINEL_9f83',
    ANDROID_KEY_PASSWORD: 'KEY_SENTINEL_2d14',
    ANDROID_KEY_ALIAS: 'release',
    ANDROID_KEYSTORE_PATH: source,
    ANDROID_KEYSTORE_BASE64: Buffer.alloc(256, 2).toString('base64'),
  };
  const calls = [];
  assert.throws(
    () => securityModule.runAndroidReleaseBuild({
      cwd: root,
      env,
      fs,
      spawn: (command, args, options) => {
        calls.push({ command, args, env: options.env });
        return { status: 1, stdout: '', stderr: '' };
      },
      logger: { log() {}, warn() {}, error() {} },
    }),
    /prebuild/i,
  );
  assert.equal('ANDROID_KEYSTORE_PASSWORD' in env, false);
  assert.equal('ANDROID_KEY_PASSWORD' in env, false);
  assert.equal('ANDROID_KEYSTORE_PATH' in env, false);
  assert.equal('ANDROID_KEYSTORE_BASE64' in env, false);
  assert.equal(
    JSON.stringify(calls[0].env).includes('STORE_SENTINEL_9f83'),
    false,
  );
  assert.equal(JSON.stringify(calls[0].env).includes(source), false);
});

for (const failureStage of ['keytool', 'gradle']) {
  test(`issue-1225-c6: ${failureStage} failure removes generated release.keystore`, async () => {
    // Regression caught: failure exits before cleanup and leaves private
    // signing material in the generated Android tree.
    const root = await mkdtemp(path.join(os.tmpdir(), 'rhythm-signing-cleanup-'));
    const source = path.join(root, 'source.keystore');
    await writeFile(source, Buffer.alloc(256, 3));
    const env = {
      PATH: process.env.PATH,
      ANDROID_KEYSTORE_PASSWORD: 'STORE_SENTINEL_9f83',
      ANDROID_KEY_PASSWORD: 'KEY_SENTINEL_2d14',
      ANDROID_KEY_ALIAS: 'release',
      ANDROID_KEYSTORE_PATH: source,
    };
    let keytoolCalls = 0;
    assert.throws(() => securityModule.runAndroidReleaseBuild({
      cwd: root,
      env,
      fs,
      spawn: (command, args) => {
        if (command === 'npx') return { status: 0, stdout: '', stderr: '' };
        if (command === 'keytool') {
          keytoolCalls += 1;
          if (failureStage === 'keytool') {
            return { status: 1, stdout: '', stderr: 'bad keystore' };
          }
          return {
            status: 0,
            stdout: 'Alias name: release',
            stderr: '',
          };
        }
        if (command === './gradlew' && failureStage === 'gradle') {
          return { status: 1, stdout: '', stderr: 'gradle failed' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      logger: { log() {}, warn() {}, error() {} },
    }));
    assert.ok(keytoolCalls >= 1);
    assert.equal(
      fs.existsSync(path.join(root, 'android', 'release.keystore')),
      false,
    );
  });
}

test('issue-1225-c7: successful production orchestration removes generated release.keystore', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rhythm-signing-success-'));
  const source = path.join(root, 'source.keystore');
  await writeFile(source, Buffer.alloc(256, 4));
  const env = {
    PATH: process.env.PATH,
    ANDROID_KEYSTORE_PASSWORD: 'STORE_SENTINEL_9f83',
    ANDROID_KEY_PASSWORD: 'KEY_SENTINEL_2d14',
    ANDROID_KEY_ALIAS: 'release',
    ANDROID_KEYSTORE_PATH: source,
  };
  securityModule.runAndroidReleaseBuild({
    cwd: root,
    env,
    fs,
    spawn: (command) =>
      command === 'keytool'
        ? { status: 0, stdout: 'Alias name: release', stderr: '' }
        : { status: 0, stdout: '', stderr: '' },
    logger: { log() {}, warn() {}, error() {} },
  });
  assert.equal(
    fs.existsSync(path.join(root, 'android', 'release.keystore')),
    false,
  );
});
