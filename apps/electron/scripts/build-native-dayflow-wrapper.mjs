#!/usr/bin/env node
// Compile only the tracked Objective-C++ wrapper against immutable accepted inputs.
// No Swift build, staging, signing, installation, or application launch occurs here.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceNames = [
  'NativeDayflowOwnedHostLifecycle.h',
  'NativeDayflowOwnedHostLifecycle.mm',
  'NativeDayflowProductionBridge.mm',
];
const required = [
  'baseline-source-root', 'source-manifest', 'source-manifest-sha256',
  'signing-inputs', 'signing-inputs-sha256', 'stage', 'stage-manifest-sha256',
  'node-headers', 'out',
];

function check(condition, message) {
  if (!condition) throw new Error(message);
}
function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function file(path) {
  check(lstatSync(path).isFile(), `Expected a regular file: ${path}`);
  const data = readFileSync(path);
  return { path, sha256: hash(data), bytes: data.length };
}
function within(path, root) {
  const value = relative(root, path);
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`));
}
function child(root, name) {
  check(typeof name === 'string' && !isAbsolute(name), 'Manifest paths must be relative');
  const path = resolve(root, name);
  check(within(path, root), 'Manifest path escaped its explicit input root');
  return path;
}
function pinnedJSON(path, expected) {
  const entry = file(path);
  check(entry.sha256 === expected, `Pinned JSON hash changed: ${path}`);
  return { entry, value: JSON.parse(readFileSync(path, 'utf8')) };
}
function verifyRows(root, rows) {
  check(new Set(rows.map(row => row.path ?? row.sourceRelative)).size === rows.length,
    'Manifest contains duplicate paths');
  for (const row of rows) {
    const entry = file(child(root, row.path ?? row.sourceRelative));
    check(entry.sha256 === row.sha256 && entry.bytes === row.bytes,
      `Immutable input differs from accepted manifest: ${entry.path}`);
  }
}
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024, ...options,
  });
  check(!result.error && result.status === 0,
    `Command failed: ${executable}\n${result.error?.message ?? ''}${result.stderr ?? ''}`);
  return result.stdout.trim();
}
function headers(root, subpath = '') {
  return readdirSync(join(root, subpath), { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)).flatMap(entry => {
    const path = join(subpath, entry.name);
    if (entry.isDirectory()) return headers(root, path);
    check(entry.isFile(), `Node headers contain a nonregular entry: ${path}`);
    return [{ ...file(join(root, path)), path }];
  });
}

function main() {
  const args = process.argv.slice(2);
  check(args.length === required.length * 2, `Required explicit arguments: ${required.map(k => `--${k}`).join(' ')}`);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, '');
    check(args[index] === `--${key}` && required.includes(key) && !Object.hasOwn(options, key),
      `Invalid or duplicate option: ${args[index]}`);
    options[key] = args[index + 1];
  }
  for (const key of required) {
    check(typeof options[key] === 'string' && options[key].length > 0, `Missing --${key}`);
    if (key.endsWith('sha256')) check(/^[a-f0-9]{64}$/.test(options[key]), `Invalid --${key}`);
    else check(isAbsolute(options[key]), `--${key} must be absolute`);
  }
  check(process.platform === 'darwin', 'This wrapper build requires macOS');
  const baselineRoot = realpathSync(options['baseline-source-root']);
  const stage = realpathSync(options.stage);
  const nodeRoot = realpathSync(options['node-headers']);
  const out = resolve(options.out);
  check(!existsSync(out), 'Output must be a fresh nonexistent directory');
  const canonicalOut = join(realpathSync(dirname(out)), out.split(sep).at(-1));
  check(canonicalOut === out, 'Output parent must be canonical, without a symlink alias');
  for (const root of [baselineRoot, stage, nodeRoot, repoRoot,
    dirname(realpathSync(options['source-manifest'])), dirname(realpathSync(options['signing-inputs']))]) {
    check(!within(out, root), 'Output must be outside the immutable inputs and tracked checkout');
  }
  const sourceManifest = pinnedJSON(options['source-manifest'], options['source-manifest-sha256']);
  const signing = pinnedJSON(options['signing-inputs'], options['signing-inputs-sha256']);
  check(sourceManifest.value.files.length === 749, 'Expected the exact accepted 749-file source manifest');
  check(signing.value.files.length === 280 && signing.value.payloadCount === 280,
    'Expected the exact accepted 280-file stage manifest');
  check(realpathSync(signing.value.stage) === stage &&
    signing.value.stageManifestSha256 === options['stage-manifest-sha256'],
    'Explicit stage is not the accepted signing input');
  const stageManifestPath = join(stage, 'MANIFEST.sha256');
  function verifyImmutableInputs() {
    pinnedJSON(options['source-manifest'], sourceManifest.entry.sha256);
    pinnedJSON(options['signing-inputs'], signing.entry.sha256);
    verifyRows(baselineRoot, sourceManifest.value.files);
    verifyRows(stage, signing.value.files);
    check(file(stageManifestPath).sha256 === options['stage-manifest-sha256'], 'Pinned stage MANIFEST changed');
    check(file(signing.value.sidecar.source).sha256 === signing.value.sidecar.sha256, 'Pinned wrapper sidecar changed');
  }
  verifyImmutableInputs();
  const wrapperSources = sourceNames.map(name => {
    const path = `apps/electron/native/dayflow-host/${name}`;
    const baseline = sourceManifest.value.files.find(row => row.path === `Host/${name}`);
    check(baseline, 'Accepted source manifest lacks a baseline wrapper file');
    return { ...file(join(repoRoot, path)), path,
      baseline: { path: baseline.path, sha256: baseline.sha256, bytes: baseline.bytes } };
  });
  const nodeHeaders = headers(nodeRoot);
  for (const name of ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h']) {
    check(nodeHeaders.some(row => row.path === name), `Missing cached Node-API header: ${name}`);
  }
  const pinnedLibrary = file(join(stage, 'libNativeDayflowProductionUI.dylib'));
  const compilerPath = command('xcrun', ['--find', 'clang++']);
  const sdkPath = command('xcrun', ['--show-sdk-path']);
  const sourceCommit = command('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
  const buildScript = 'apps/electron/scripts/build-native-dayflow-wrapper.mjs';
  const buildScriptInput = file(join(repoRoot, buildScript));
  const dirty = command('git', ['status', '--porcelain'], { cwd: repoRoot });
  const addonPath = join(out, 'native_dayflow_production.node');
  const compilerArgs = [
    '-mmacosx-version-min=14.0', '-Werror=unguarded-availability-new', '-std=c++17',
    '-fobjc-arc', '-fmodules', `-fmodules-cache-path=${join(out, 'module-cache')}`,
    '-isysroot', sdkPath, '-bundle',
    join(repoRoot, 'apps/electron/native/dayflow-host/NativeDayflowProductionBridge.mm'),
    join(repoRoot, 'apps/electron/native/dayflow-host/NativeDayflowOwnedHostLifecycle.mm'),
    '-I', nodeRoot, '-L', stage, '-lNativeDayflowProductionUI',
    '-framework', 'AppKit', '-framework', 'Foundation',
    '-Wl,-rpath,@loader_path',
    '-Wl,-rpath,@loader_path/../../DerivedData/swiftpm-production/arm64-apple-macosx/debug',
    '-undefined', 'dynamic_lookup', '-o', addonPath,
  ];
  mkdirSync(out);
  mkdirSync(join(out, 'module-cache'));
  command(compilerPath, compilerArgs);
  verifyImmutableInputs();
  for (const row of wrapperSources) check(file(join(repoRoot, row.path)).sha256 === row.sha256,
    'Tracked source changed during compilation');
  check(JSON.stringify(headers(nodeRoot)) === JSON.stringify(nodeHeaders), 'Cached Node headers changed during compilation');
  check(file(join(repoRoot, buildScript)).sha256 === buildScriptInput.sha256, 'Build script changed during compilation');
  check(command('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }) === sourceCommit &&
    command('git', ['status', '--porcelain'], { cwd: repoRoot }) === dirty,
    'Wrapper Git provenance changed during compilation');
  const receipt = {
    schemaVersion: 1, kind: 'compile-only-native-dayflow-wrapper',
    sourceCommit, sourceTreeDirty: dirty.length > 0, wrapperSources,
    baselineSourceManifest: { path: sourceManifest.entry.path, sha256: sourceManifest.entry.sha256, files: 749 },
    baselineSigningInputs: { path: signing.entry.path, sha256: signing.entry.sha256, payloadCount: 280 },
    pinnedStage: { path: stage, manifestSha256: options['stage-manifest-sha256'] },
    pinnedLibrary, addon: file(addonPath),
    compiler: { ...file(realpathSync(compilerPath)), version: command(compilerPath, ['--version']) },
    sdk: { path: sdkPath, version: command('xcrun', ['--show-sdk-version']),
      settingsSha256: file(join(sdkPath, 'SDKSettings.json')).sha256 },
    nodeHeaderRoot: nodeRoot, nodeHeaders,
    buildScript: { ...buildScriptInput, path: buildScript },
    command: { executable: compilerPath, args: compilerArgs },
    linkage: command('otool', ['-L', addonPath]),
    immutableInputsVerifiedBeforeAndAfter: true,
  };
  const receiptPath = join(out, 'native-dayflow-wrapper-build-receipt.json');
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(`Wrapper-only build receipt: ${receiptPath}`);
}
try { main(); }
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
