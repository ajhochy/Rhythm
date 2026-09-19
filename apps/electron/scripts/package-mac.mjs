import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildAndStageApprovalHelper } from './build-approval-helper.mjs';
import { hardenElectronFuses } from './harden-electron-fuses.mjs';

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
      await execute('iconutil', ['-c', 'icns', iconset, '-o', generated]);
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
await stageRhythmIcon({
  appiconsetDir: resolve(electronRoot, '../desktop_flutter/macos/Runner/Assets.xcassets/AppIcon.appiconset'),
  resources,
  infoPlist,
});
await buildAndStageApprovalHelper({ electronRoot, resources });
await mkdir(resolve(packagedApp, 'src'), { recursive: true });
await mkdir(packagedShared, { recursive: true });
await mkdir(packagedApiServer, { recursive: true });
await Promise.all([
  cp(resolve(electronRoot, 'src/main.mjs'), resolve(packagedApp, 'src/main.mjs')),
  cp(resolve(electronRoot, 'src/policy.mjs'), resolve(packagedApp, 'src/policy.mjs')),
  cp(resolve(electronRoot, 'src/production-api-config.mjs'), resolve(packagedApp, 'src/production-api-config.mjs')),
  cp(resolve(electronRoot, 'src/runtime-config.mjs'), resolve(packagedApp, 'src/runtime-config.mjs')),
  cp(resolve(electronRoot, 'src/artifact-frame-protocol.mjs'), resolve(packagedApp, 'src/artifact-frame-protocol.mjs')),
  cp(resolve(electronRoot, 'src/security-smoke-receipt.mjs'), resolve(packagedApp, 'src/security-smoke-receipt.mjs')),
  cp(resolve(electronRoot, 'src/preload.cjs'), resolve(packagedApp, 'src/preload.cjs')),
  cp(resolve(electronRoot, 'src/google-oauth-core.mjs'), resolve(packagedApp, 'src/google-oauth-core.mjs')),
  cp(resolve(electronRoot, 'src/desktop-google-oauth.mjs'), resolve(packagedApp, 'src/desktop-google-oauth.mjs')),
  cp(resolve(electronRoot, 'src/agent-server.mjs'), resolve(packagedApp, 'src/agent-server.mjs')),
  cp(resolve(electronRoot, 'src/human-approval-main-signer.mjs'), resolve(packagedApp, 'src/human-approval-main-signer.mjs')),
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

// Match the shipping Flutter bundle: install production dependencies in the detached payload,
// letting api_server's postinstall rebuild better-sqlite3 against this exact Node runtime.
await run('npm', ['install', '--omit=dev'], { cwd: packagedApiServer });
await run('npm', ['install', '--omit=dev'], { cwd: resolve(packagedApiServer, 'config_seeds/tools') });
await rm(resolve(packagedApiServer, '.node-runtime.json'), { force: true });

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
// node-gyp emits rebuild metadata with nondeterministic dependency ordering. The runtime needs the
// compiled Release addon, not these regeneration inputs; remove them before signing so identical
// source and Node 22 inputs produce identical bundle bytes.
await Promise.all([
  rm(resolve(packagedApiServer, 'node_modules/better-sqlite3/build/Makefile'), { force: true }),
  rm(resolve(packagedApiServer, 'node_modules/better-sqlite3/build/config.gypi'), { force: true }),
]);

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
await rename(stagingArtifact, artifact);
process.stdout.write(`Packaged ${artifact} with an ad-hoc signature.\n`);
} finally {
  await rm(stagingArtifact, { recursive: true, force: true });
}
}
