import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import fsDefault from 'node:fs';
import path from 'node:path';

const STORE_PASSWORD_ENV = 'RHYTHM_ANDROID_STORE_PASSWORD';
const GRADLE_STORE_PASSWORD_ENV =
  'ORG_GRADLE_PROJECT_android.injected.signing.store.password';
const GRADLE_KEY_PASSWORD_ENV =
  'ORG_GRADLE_PROJECT_android.injected.signing.key.password';
const GRADLE_STORE_FILE_ENV =
  'ORG_GRADLE_PROJECT_android.injected.signing.store.file';
const GRADLE_KEY_ALIAS_ENV =
  'ORG_GRADLE_PROJECT_android.injected.signing.key.alias';
const GRADLE_STORE_TYPE_ENV =
  'ORG_GRADLE_PROJECT_android.injected.signing.store.type';

export function takeAndroidSigningSecrets(sourceEnv) {
  const keystorePassword = sourceEnv.ANDROID_KEYSTORE_PASSWORD?.trim();
  const keyPassword = sourceEnv.ANDROID_KEY_PASSWORD?.trim();
  delete sourceEnv.ANDROID_KEYSTORE_PASSWORD;
  delete sourceEnv.ANDROID_KEY_PASSWORD;
  if (!keystorePassword) {
    throw new Error(
      'Missing required environment variable: ANDROID_KEYSTORE_PASSWORD',
    );
  }
  if (!keyPassword) {
    throw new Error(
      'Missing required environment variable: ANDROID_KEY_PASSWORD',
    );
  }
  return {
    keystorePassword,
    keyPassword,
    clear() {
      this.keystorePassword = '';
      this.keyPassword = '';
    },
  };
}

function takeAndroidSigningInputs(sourceEnv) {
  const keystorePassword = sourceEnv.ANDROID_KEYSTORE_PASSWORD?.trim();
  const keyPassword = sourceEnv.ANDROID_KEY_PASSWORD?.trim();
  const keyAlias = sourceEnv.ANDROID_KEY_ALIAS?.trim();
  const keystoreSourcePath = sourceEnv.ANDROID_KEYSTORE_PATH?.trim();
  const keystoreBase64 = sourceEnv.ANDROID_KEYSTORE_BASE64
    ?.replace(/\s+/g, '');
  delete sourceEnv.ANDROID_KEYSTORE_PASSWORD;
  delete sourceEnv.ANDROID_KEY_PASSWORD;
  delete sourceEnv.ANDROID_KEY_ALIAS;
  delete sourceEnv.ANDROID_KEYSTORE_PATH;
  delete sourceEnv.ANDROID_KEYSTORE_BASE64;
  if (!keystorePassword) {
    throw new Error(
      'Missing required environment variable: ANDROID_KEYSTORE_PASSWORD',
    );
  }
  if (!keyPassword) {
    throw new Error(
      'Missing required environment variable: ANDROID_KEY_PASSWORD',
    );
  }
  if (!keyAlias) {
    throw new Error(
      'Missing required environment variable: ANDROID_KEY_ALIAS',
    );
  }
  if (!keystoreSourcePath && !keystoreBase64) {
    throw new Error(
      'Missing keystore input. Set either ANDROID_KEYSTORE_PATH or ANDROID_KEYSTORE_BASE64.',
    );
  }
  return {
    keystorePassword,
    keyPassword,
    keyAlias,
    keystoreSourcePath,
    keystoreBase64,
    clear() {
      this.keystorePassword = '';
      this.keyPassword = '';
      this.keystoreSourcePath = '';
      this.keystoreBase64 = '';
    },
  };
}

function buildBaseChildEnvironment(sourceEnv) {
  const allowedNames = new Set([
    'PATH',
    'HOME',
    'TMPDIR',
    'CI',
    'NODE_ENV',
    'JAVA_HOME',
    'ANDROID_HOME',
    'ANDROID_SDK_ROOT',
    'GRADLE_USER_HOME',
    'LANG',
    'LC_ALL',
    'SHELL',
    'USER',
  ]);
  return Object.fromEntries(
    Object.entries(sourceEnv).filter(
      ([name]) =>
        allowedNames.has(name) ||
        name.startsWith('EXPO_PUBLIC_') ||
        name.startsWith('EAS_') ||
        name.startsWith('npm_'),
    ),
  );
}

export function createAndroidSigningPlan({
  keystorePath,
  keyAlias,
  keystorePassword,
  keyPassword,
  storeType,
}) {
  return {
    keytool: {
      args: [
        '-list',
        '-keystore',
        keystorePath,
        '-storepass:env',
        STORE_PASSWORD_ENV,
        '-storetype',
        storeType,
      ],
      env: {
        [STORE_PASSWORD_ENV]: keystorePassword,
      },
    },
    gradle: {
      args: ['bundleRelease', 'assembleRelease'],
      env: {
        [GRADLE_STORE_FILE_ENV]: keystorePath,
        [GRADLE_STORE_PASSWORD_ENV]: keystorePassword,
        [GRADLE_KEY_ALIAS_ENV]: keyAlias,
        [GRADLE_KEY_PASSWORD_ENV]: keyPassword,
        [GRADLE_STORE_TYPE_ENV]: storeType,
      },
    },
  };
}

function clearPlanSecrets(plan) {
  for (const key of Object.keys(plan.keytool.env)) {
    delete plan.keytool.env[key];
  }
  for (const key of Object.keys(plan.gradle.env)) {
    delete plan.gradle.env[key];
  }
}

export function withAndroidSigningSecrets(
  sourceEnv,
  config,
  callback,
) {
  const secrets = takeAndroidSigningSecrets(sourceEnv);
  const plan = createAndroidSigningPlan({ ...config, ...secrets });
  try {
    return callback(plan);
  } finally {
    clearPlanSecrets(plan);
    secrets.clear();
  }
}

export function runAndroidSigningCommand(
  spawn,
  logger,
  command,
  args,
  options,
) {
  const result = spawn(command, args, options);
  if (result.status !== 0) {
    logger(`Command failed: ${command}`);
    throw new Error('Android signing command failed');
  }
  return result;
}

export function redactSigningOutput(value, secrets) {
  let redacted = String(value);
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

function parseAliases(stdout) {
  const aliases = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match =
      line.match(/Alias name:\s*(.+)/i) ||
      line.match(/^\s*alias:\s*(.+)/i);
    if (match) aliases.push(match[1].trim());
  }
  return aliases;
}

export function runAndroidReleaseBuild({
  cwd = process.cwd(),
  env = process.env,
  fs = fsDefault,
  spawn = spawnSync,
  logger = console,
} = {}) {
  const inputs = takeAndroidSigningInputs(env);
  const baseChildEnv = buildBaseChildEnvironment(env);
  const androidDir = path.join(cwd, 'android');
  const keystorePath = path.join(androidDir, 'release.keystore');
  const spawnedPlans = [];
  let succeeded = false;

  const runStage = (stage, command, args, options) => {
    try {
      return runAndroidSigningCommand(
        spawn,
        (message) => logger.error(message),
        command,
        args,
        options,
      );
    } catch {
      throw new Error(`${stage} failed`);
    }
  };

  try {
    runStage(
      'Android prebuild',
      'npx',
      ['expo', 'prebuild', '--platform', 'android', '--non-interactive', '--clean'],
      {
        cwd,
        stdio: 'inherit',
        env: { ...baseChildEnv, EXPO_APP_VARIANT: 'production' },
      },
    );

    fs.mkdirSync(androidDir, { recursive: true });
    if (inputs.keystoreSourcePath) {
      if (!fs.existsSync(inputs.keystoreSourcePath)) {
        throw new Error('Configured keystore file does not exist');
      }
      fs.copyFileSync(inputs.keystoreSourcePath, keystorePath);
    } else {
      if (!inputs.keystoreBase64 || inputs.keystoreBase64.length < 100) {
        throw new Error(
          'ANDROID_KEYSTORE_BASE64 is too short to be a valid keystore payload.',
        );
      }
      fs.writeFileSync(
        keystorePath,
        Buffer.from(inputs.keystoreBase64, 'base64'),
        { mode: 0o600 },
      );
    }
    fs.chmodSync(keystorePath, 0o600);
    const size = fs.statSync(keystorePath).size;
    if (size < 100) {
      throw new Error(
        `Decoded keystore is too small (${size} bytes).`,
      );
    }

    let validation;
    const failures = [];
    for (const storeType of ['pkcs12', 'jks']) {
      const plan = createAndroidSigningPlan({
        keystorePath,
        keyAlias: inputs.keyAlias,
        keystorePassword: inputs.keystorePassword,
        keyPassword: inputs.keyPassword,
        storeType,
      });
      spawnedPlans.push(plan);
      const result = spawn('keytool', plan.keytool.args, {
        cwd: androidDir,
        encoding: 'utf8',
        env: { ...baseChildEnv, ...plan.keytool.env },
      });
      if (result.status === 0) {
        validation = { storeType, aliases: parseAliases(result.stdout || '') };
        break;
      }
      failures.push(
        redactSigningOutput(result.stderr || '', [
          inputs.keystorePassword,
          inputs.keyPassword,
        ]),
      );
    }
    if (!validation) {
      for (const failure of failures) {
        if (failure) logger.error(failure.split(/\r?\n/).slice(0, 50).join('\n'));
      }
      throw new Error('Keystore validation failed');
    }
    if (
      validation.aliases.length > 0 &&
      !validation.aliases.includes(inputs.keyAlias)
    ) {
      throw new Error('Configured Android key alias was not found');
    }

    const effectiveKeyPassword =
      validation.storeType === 'pkcs12'
        ? inputs.keystorePassword
        : inputs.keyPassword;
    const signingPlan = createAndroidSigningPlan({
      keystorePath,
      keyAlias: inputs.keyAlias,
      keystorePassword: inputs.keystorePassword,
      keyPassword: effectiveKeyPassword,
      storeType: validation.storeType,
    });
    spawnedPlans.push(signingPlan);
    runStage(
      'Android Gradle release build',
      './gradlew',
      signingPlan.gradle.args,
      {
        cwd: androidDir,
        stdio: 'inherit',
        env: { ...baseChildEnv, ...signingPlan.gradle.env },
      },
    );
    succeeded = true;
  } finally {
    for (const plan of spawnedPlans) {
      clearPlanSecrets(plan);
    }
    inputs.clear();
    try {
      fs.rmSync(keystorePath, { force: true });
    } catch (error) {
      throw new Error(
        `Android keystore cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (succeeded) logger.log('Android production build complete.');
}
