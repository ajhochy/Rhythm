import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildAndStageApprovalHelper } from './build-approval-helper.mjs';
import { hardenElectronFuses } from './harden-electron-fuses.mjs';
import { PINNED_HERMES_DESKTOP_SOURCE_COMMIT } from '../src/hermes-desktop-config.mjs';
import { refreshHermesDesktopArtifactIntegrity, resolveHermesDesktopArtifact } from '../src/hermes-desktop-artifact.mjs';
import { EXPECTED_COLONY_ELECTRON_MAJOR, PINNED_COLONY_SOURCE_COMMIT } from '../src/colony-desktop-config.mjs';
import { refreshColonyArtifactIntegrity, resolveColonyArtifact } from '../src/colony-desktop-artifact.mjs';

const run = promisify(execFile);

// Reuse the shipping Flutter artwork, including both normal and Retina representations.
export async function buildRhythmIcns({ appiconsetDir, outDir, run: execute = run }) {
  await mkdir(outDir, { recursive: true });
  const iconPath = resolve(outDir, 'Rhythm.icns');
  const inventoryPath = resolve(outDir, 'Rhythm.icns.json');
  await Promise.all([rm(iconPath, { force: true }), rm(inventoryPath, { force: true })]);
  const temporary = await mkdtemp(resolve(outDir, '.rhythm-icon-'));
  try {
    const contents = JSON.parse(await readFile(resolve(appiconsetDir, 'Contents.json'), 'utf8'));
    const iconset = resolve(temporary, 'Rhythm.iconset');
    await mkdir(iconset);
    const images = [];
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        const entry = contents.images?.find((image) => image.idiom === 'mac' && image.size === `${size}x${size}` && image.scale === `${scale}x`);
        if (!entry || typeof entry.filename !== 'string' || !entry.filename || basename(entry.filename) !== entry.filename) {
          throw new Error(`Required Rhythm artwork missing: ${size}x${size}@${scale}x in Contents.json`);
        }
        const source = resolve(appiconsetDir, entry.filename);
        const png = await readFile(source).catch((cause) => { throw new Error(`Required Rhythm artwork missing: ${source}`, { cause }); });
        const pixels = size * scale;
        if (png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
          || png.toString('ascii', 12, 16) !== 'IHDR' || png.readUInt32BE(16) !== pixels || png.readUInt32BE(20) !== pixels) {
          throw new Error(`Invalid Rhythm artwork: ${entry.filename} must be a ${pixels}x${pixels} PNG`);
        }
        await writeFile(resolve(iconset, name), png);
        images.push({ iconsetName: name, source: entry.filename, pixels, sha256: createHash('sha256').update(png).digest('hex') });
      }
    }
    const generated = resolve(temporary, 'Rhythm.icns');
    try {
      await execute('iconutil', ['-c', 'icns', '-o', generated, iconset]);
    } catch (cause) {
      throw new Error(`Rhythm icon assembly failed: iconutil is required and must accept the complete iconset (${cause.message})`, { cause });
    }
    const icns = await readFile(generated).catch((cause) => { throw new Error('iconutil did not produce Rhythm.icns', { cause }); });
    if (icns.length <= 8 || icns.toString('ascii', 0, 4) !== 'icns' || icns.readUInt32BE(4) !== icns.length) {
      throw new Error('iconutil produced an invalid Rhythm.icns');
    }
    const inventory = { icon: 'Rhythm.icns', sha256: createHash('sha256').update(icns).digest('hex'), images };
    await rename(generated, iconPath);
    await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    return { iconPath, inventoryPath };
  } catch (error) {
    await Promise.all([rm(iconPath, { force: true }), rm(inventoryPath, { force: true })]);
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function stageRhythmIcon({ appiconsetDir, resources, infoPlist, run: execute = run }) {
  const result = await buildRhythmIcns({ appiconsetDir, outDir: resources, run: execute });
  const plist = JSON.parse((await execute('plutil', ['-convert', 'json', '-o', '-', infoPlist])).stdout);
  await execute('plutil', ['-replace', 'CFBundleIconFile', '-string', 'Rhythm', infoPlist]);
  if (Object.hasOwn(plist, 'CFBundleIconName')) {
    await execute('plutil', ['-replace', 'CFBundleIconName', '-string', 'Rhythm', infoPlist]);
  }
  await rm(resolve(resources, 'electron.icns'), { force: true });
  return result;
}

/** Stages the macOS privacy declaration required by Hermes Desktop voice input. */
export async function stageMacPrivacy({ infoPlist, entitlementsPath, run: execute = run }) {
  const entitlements = JSON.parse((await execute('plutil', ['-convert', 'json', '-o', '-', entitlementsPath])).stdout);
  if (entitlements['com.apple.security.device.audio-input'] !== true || Object.hasOwn(entitlements, 'com.apple.security.device.camera')) {
    throw new Error('Rhythm macOS entitlements must grant audio input only for Hermes voice.');
  }
  await execute('plutil', ['-replace', 'NSMicrophoneUsageDescription', '-string', 'Rhythm uses the microphone for Hermes voice input and voice conversations.', infoPlist]);
}

export async function buildAndStageFork({ electronRoot, resources, run: execute = run }) {
  const arch = process.env.RHYTHM_PACKAGE_ARCH || process.arch;
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch) || arch !== process.arch) {
    throw new Error(`Fork packaging requires a native macOS ${arch} build; received ${process.platform}/${process.arch}`);
  }
  const repoRoot = resolve(electronRoot, '../..');
  const forkRoot = resolve(electronRoot, '../opencode_fork/packages/opencode');
  const commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })).stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Cannot determine fork commit');
  const dirty = await execute('git', ['status', '--porcelain', '--', 'apps/opencode_fork'], { cwd: repoRoot });
  if (dirty.stdout.trim()) throw new Error('Fork source must match the checked-out commit');
  const version = `0.0.0-rhythm-${commit}`;
  const source = resolve(forkRoot, `dist/opencode-darwin-${arch}/bin/opencode`);
  // No prebuilt/PATH fallback: a failed or empty build cannot reuse yesterday's engine.
  await rm(resolve(forkRoot, 'dist'), { recursive: true, force: true });
  await execute('bun', ['run', 'build', '--single', '--skip-install'], {
    cwd: forkRoot,
    // The fork embeds a Vite UI too; caller gateway values must not become engine bytes.
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_RHYTHM_'))), OPENCODE_CHANNEL: 'rhythm', OPENCODE_VERSION: version, OPENCODE_RELEASE: '' },
  });
  if (!(await lstat(source)).isFile()) throw new Error('Fork must be a regular executable file');
  await access(source, constants.X_OK).catch(() => { throw new Error('Fork is not executable'); });
  const architecture = (await execute('lipo', ['-archs', source])).stdout.trim();
  if (architecture !== (arch === 'x64' ? 'x86_64' : 'arm64')) {
    throw new Error(`Fork architecture mismatch: expected ${arch}, received ${architecture}`);
  }
  const actual = (await execute(source, ['--version'], { timeout: 30_000 })).stdout.trim();
  if (actual !== version) throw new Error(`Fork identity mismatch: expected ${version}, received ${actual}`);
  const destination = resolve(resources, 'opencode_bin/opencode');
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

/** Stage only a verified artifact created by the pinned Hermes fork builder.
 * It deliberately has no ~/.hermes/PATH fallback. */
export async function stageHermesDesktopArtifact({ resources, artifactRoot = process.env.RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR }) {
  if (typeof artifactRoot !== 'string' || !artifactRoot) {
    throw new Error('Hermes Desktop artifact is required for packaging. Build the pinned Hermes fork artifact and set RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR.');
  }
  const artifact = await resolveHermesDesktopArtifact({
    artifactRoot,
    expectedElectronMajor: 40,
    expectedSourceCommit: PINNED_HERMES_DESKTOP_SOURCE_COMMIT,
    allowDirty: false,
  });
  const destination = resolve(resources, 'hermes-desktop');
  await rm(destination, { recursive: true, force: true });
  await cp(artifact.root, destination, { recursive: true, verbatimSymlinks: true });
  await resolveHermesDesktopArtifact({
    artifactRoot: destination,
    expectedElectronMajor: 40,
    expectedSourceCommit: PINNED_HERMES_DESKTOP_SOURCE_COMMIT,
    allowDirty: false,
  });
  return destination;
}

/** Stage only a verified artifact created by the pinned Colony (Bot Crossing) source builder.
 * It deliberately has no development-checkout/PATH fallback, and refuses a payload built for a
 * different packaged Node than this packaging run installs (see packagedNode below). */
export async function stageColonyArtifact({ resources, artifactRoot = process.env.RHYTHM_COLONY_ARTIFACT_DIR }) {
  if (typeof artifactRoot !== 'string' || !artifactRoot) {
    throw new Error('Colony artifact is required for packaging. Build the pinned Colony artifact and set RHYTHM_COLONY_ARTIFACT_DIR.');
  }
  const artifact = await resolveColonyArtifact({
    artifactRoot,
    expectedElectronMajor: EXPECTED_COLONY_ELECTRON_MAJOR,
    expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT,
    allowDirty: false,
  });
  // The packaged Node is process.execPath copied verbatim (see packagedNode below), so the
  // running packager's own Node version IS the packaged Node's version.
  if (artifact.manifest.nodeVersion !== process.versions.node) {
    throw new Error(`Colony artifact Node version mismatch: expected ${process.versions.node}, found ${String(artifact.manifest.nodeVersion)}`);
  }
  const destination = resolve(resources, 'colony-desktop');
  await rm(destination, { recursive: true, force: true });
  await cp(artifact.root, destination, { recursive: true, verbatimSymlinks: true });
  await resolveColonyArtifact({
    artifactRoot: destination,
    expectedElectronMajor: EXPECTED_COLONY_ELECTRON_MAJOR,
    expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT,
    allowDirty: false,
  });
  return destination;
}

// Importing the assembly boundary for controlled-input tests must not build the app.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageNodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (packageNodeMajor !== 22) throw new Error(`Electron release packaging requires Node 22; received ${process.versions.node}`);
const sourceApp = resolve(electronRoot, 'node_modules/electron/dist/Electron.app');
const distRoot = resolve(electronRoot, 'dist');
const artifact = resolve(distRoot, 'Rhythm.app');
// Official Electron tooling recognizes the framework only inside a .app bundle.
const stagingArtifact = resolve(distRoot, '.Rhythm.tmp.app');
const resources = resolve(stagingArtifact, 'Contents/Resources');
const packagedApp = resolve(resources, 'app');
const packagedShared = resolve(resources, 'shared');
const apiServerSource = resolve(electronRoot, '../api_server');
const packagedApiServer = resolve(resources, 'api_server');
const packagedNode = resolve(resources, 'node/bin/node');
const infoPlist = resolve(stagingArtifact, 'Contents/Info.plist');
const releaseVersion = process.env.RELEASE_VERSION?.trim() || '0.1.0';
if (!/^\d+(?:\.\d+){0,2}$/.test(releaseVersion)) {
  throw new Error(`RELEASE_VERSION must contain one to three numeric components: ${releaseVersion}`);
}
const rendererBuildEnvironment = { ...process.env };
// TEST-ONLY: Vite gateway values remain supported by `npm run dev` and Playwright. A shipping
// renderer must start from a neutral environment, then receive only the non-secret live-mode
// invariant; caller-supplied bases and tokens must never become artifact bytes.
for (const key of [
  'VITE_RHYTHM_GATEWAY_MODE',
  'VITE_RHYTHM_API_BASE',
  'VITE_RHYTHM_ENGINE_BASE',
  'VITE_RHYTHM_PRODUCTION_API_BASE',
  'VITE_RHYTHM_EXPECTED_API_BASE',
  'VITE_RHYTHM_EXPECTED_ENGINE_BASE',
  'VITE_RHYTHM_LIVE_TOKEN',
]) delete rendererBuildEnvironment[key];
rendererBuildEnvironment.VITE_RHYTHM_GATEWAY_MODE = 'live';

await mkdir(distRoot, { recursive: true });
await Promise.all([
  rm(artifact, { recursive: true, force: true }),
  rm(stagingArtifact, { recursive: true, force: true }),
  rm(resolve(distRoot, '.Rhythm.app.tmp'), { recursive: true, force: true }),
]);
try {
await buildAndStageFork({ electronRoot, resources });
const electronArch = (await run('lipo', ['-archs', resolve(sourceApp, 'Contents/MacOS/Electron')])).stdout.trim();
if (electronArch !== (process.arch === 'x64' ? 'x86_64' : 'arm64')) {
  throw new Error(`Electron architecture mismatch: ${electronArch}`);
}
await run('npm', ['--prefix', '../web', 'run', 'build'], {
  cwd: electronRoot,
  env: rendererBuildEnvironment,
});
await run('npm', ['--prefix', '../api_server', 'run', 'build'], { cwd: electronRoot });
await cp(sourceApp, stagingArtifact, { recursive: true, verbatimSymlinks: true });
await stageHermesDesktopArtifact({ resources });
await stageColonyArtifact({ resources });
await stageRhythmIcon({
  appiconsetDir: resolve(electronRoot, '../desktop_flutter/macos/Runner/Assets.xcassets/AppIcon.appiconset'),
  resources,
  infoPlist,
});
await stageMacPrivacy({ infoPlist, entitlementsPath: resolve(electronRoot, 'entitlements/mac.plist') });
await buildAndStageApprovalHelper({ electronRoot, resources });
await mkdir(resolve(packagedApp, 'src'), { recursive: true });
await mkdir(packagedShared, { recursive: true });
await mkdir(packagedApiServer, { recursive: true });
await Promise.all([
  // Ship every runtime module in src/ (the renderer and main load them by path and import);
  // a hand-maintained list silently dropped new modules. build-config.mjs is generated below.
  cp(resolve(electronRoot, 'src'), resolve(packagedApp, 'src'), {
    recursive: true,
    filter: (source) => !source.endsWith('.d.mts') && basename(source) !== 'build-config.mjs',
  }),
  cp(resolve(electronRoot, 'package.json'), resolve(packagedApp, 'package.json')),
  cp(resolve(electronRoot, '../shared/production-api-base.mjs'), resolve(packagedShared, 'production-api-base.mjs')),
  cp(resolve(electronRoot, '../web/dist'), resolve(packagedApp, 'web/dist'), { recursive: true }),
  ...['dist', 'scripts', 'opencode_plugins', 'config_seeds', 'vendor', 'resources'].map((entry) =>
    cp(resolve(apiServerSource, entry), resolve(packagedApiServer, entry), { recursive: true })),
  cp(resolve(apiServerSource, 'package.json'), resolve(packagedApiServer, 'package.json')),
  cp(resolve(apiServerSource, 'package-lock.json'), resolve(packagedApiServer, 'package-lock.json')),
  cp(resolve(electronRoot, '../../.mcp-roles'), resolve(packagedApiServer, '.mcp-roles'), { recursive: true }),
  writeFile(resolve(packagedApp, 'src/build-config.mjs'), [
    '// Generated by package-mac.mjs. The OAuth client ID is public; no client secret is embedded.',
    `export const GOOGLE_DESKTOP_CLIENT_ID = ${JSON.stringify(process.env.GOOGLE_DESKTOP_CLIENT_ID?.trim() ?? '')};`,
    "export const RHYTHM_AUTH_API_BASE = 'https://api.vcrcapps.com';",
    '',
  ].join('\n')),
]);

// Match the shipping Flutter bundle: install production dependencies in the detached payload.
// better-sqlite3 13 ships N-API prebuilds, so rebuilding it for this Node is unnecessary.
// Fail the build, not the first launch, if any module main/preload reach is missing.
await assertPackagedModuleGraph(resolve(packagedApp, 'src'), ['main.mjs', 'preload.cjs', 'hermes-view-preload.cjs']);

await run('npm', ['install', '--omit=dev'], {
  cwd: packagedApiServer,
  env: { ...process.env, SKIP_BETTER_SQLITE3_REBUILD: '1' },
});
await run('npm', ['install', '--omit=dev'], { cwd: resolve(packagedApiServer, 'config_seeds/tools') });
await rm(resolve(packagedApiServer, '.node-runtime.json'), { force: true });

const betterSqlitePrebuilds = [
  'darwin-arm64.node',
  'darwin-x64.node',
  'linux-arm64.node',
  'linux-x64.node',
  'linuxmusl-arm64.node',
  'linuxmusl-x64.node',
  'win32-arm64.node',
  'win32-x64.node',
];
const betterSqlitePrebuildDir = resolve(packagedApiServer, 'node_modules/better-sqlite3/prebuilds');
const targetBetterSqlitePrebuild = `darwin-${process.arch}.node`;
await Promise.all(betterSqlitePrebuilds
  .filter((name) => name !== targetBetterSqlitePrebuild)
  .map((name) => rm(resolve(betterSqlitePrebuildDir, name), { force: true })));
await access(resolve(betterSqlitePrebuildDir, targetBetterSqlitePrebuild)).catch((cause) => {
  throw new Error(`Missing better-sqlite3 prebuild for packaged architecture: ${targetBetterSqlitePrebuild}`, { cause });
});

await mkdir(dirname(packagedNode), { recursive: true });
await cp(process.execPath, packagedNode);
await chmod(packagedNode, 0o755);
// Probe native addons in separate processes. Loading node-pty after creating a better-sqlite3
// Statement can force that Statement's GC during Node 24 addon teardown and abort inside
// RemoveEnvironmentCleanupHook even though each addon is ABI-correct.
await run(packagedNode, ['-e', [
  `const root=${JSON.stringify(packagedApiServer)};`,
  "const Database=require(root+'/node_modules/better-sqlite3');",
  "const db=new Database(':memory:');",
  "if(db.prepare('select 1 as x').get().x!==1)process.exit(1);",
].join('')]);
await run(packagedNode, ['-e', [
  `const root=${JSON.stringify(packagedApiServer)};`,
  "require(root+'/node_modules/node-pty');",
].join('')]);
// Colony's embedded worker requires node:sqlite; probe it with the exact packaged Node (COL-09).
await run(packagedNode, ['-e', "require('node:sqlite')"]);
await rename(
  resolve(stagingArtifact, 'Contents/MacOS/Electron'),
  resolve(stagingArtifact, 'Contents/MacOS/Rhythm'),
);
for (const [key, value] of [
  ['CFBundleExecutable', 'Rhythm'],
  ['CFBundleIdentifier', 'com.rhythm.desktop'],
  ['CFBundleName', 'Rhythm'],
  ['CFBundleDisplayName', 'Rhythm'],
  ['CFBundleShortVersionString', releaseVersion],
  ['CFBundleVersion', releaseVersion],
]) {
  await run('plutil', ['-replace', key, '-string', value, infoPlist]);
}

const approvalHelper = resolve(resources, 'human-approval/rhythm-approval-signer');
await hardenElectronFuses(resolve(stagingArtifact, 'Contents/MacOS/Rhythm'));
await run('codesign', ['--force', '--identifier', 'com.rhythm.desktop.approval-signer', '--sign', '-', approvalHelper]);
await run('codesign', ['--verify', '--strict', approvalHelper]);
await run('codesign', ['--force', '--deep', '--sign', '-', stagingArtifact]);
const stagedHermesArtifact = resolve(resources, 'hermes-desktop');
await refreshHermesDesktopArtifactIntegrity({ artifactRoot: stagedHermesArtifact });
await resolveHermesDesktopArtifact({
  artifactRoot: stagedHermesArtifact,
  expectedElectronMajor: 40,
  expectedSourceCommit: PINNED_HERMES_DESKTOP_SOURCE_COMMIT,
  allowDirty: false,
});
const stagedColonyArtifact = resolve(resources, 'colony-desktop');
await refreshColonyArtifactIntegrity({ artifactRoot: stagedColonyArtifact });
await resolveColonyArtifact({
  artifactRoot: stagedColonyArtifact,
  expectedElectronMajor: EXPECTED_COLONY_ELECTRON_MAJOR,
  expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT,
  allowDirty: false,
});
// The deep pass has sealed nested native binaries. The manifest refreshes above
// change resources, so re-seal only the outer app without re-signing it.
await run('codesign', ['--force', '--sign', '-', stagingArtifact]);
await rename(stagingArtifact, artifact);
process.stdout.write(`Packaged ${artifact} with an ad-hoc signature.\n`);
} finally {
  await rm(stagingArtifact, { recursive: true, force: true });
}
}

export async function assertPackagedModuleGraph(srcDir, entries) {
  const seen = new Set();
  const queue = entries.map((entry) => resolve(srcDir, entry));
  const missing = [];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      missing.push(file);
      continue;
    }
    for (const match of text.matchAll(/(?:\bfrom|\bimport\(|\brequire\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      queue.push(resolve(dirname(file), match[1]));
    }
  }
  if (missing.length) {
    throw new Error(`Packaged app is missing runtime modules: ${missing.join(', ')}`);
  }
}

