#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDayflowDesktopArtifact } from '../src/dayflow-desktop-artifact.mjs';

const executeFile = promisify(execFile);
const captureGateReason = 'OS capture permission/runtime capture qualification not performed by this verifier';
const dayflowSegments = ['Contents', 'Resources', 'dayflow-desktop', 'Dayflow.app'];
const legalSegments = ['Contents', 'Resources', 'dayflow-desktop', 'legal'];

async function defaultExecute(command, args) {
  return executeFile(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

function outputOf(result) {
  return `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
}

async function checked(execute, command, args, label) {
  try {
    return await execute(command, args);
  } catch (cause) {
    throw new Error(`Packaged Dayflow verification failed: ${label}`, { cause });
  }
}

async function realPathType(path, type, label) {
  const metadata = await lstat(path).catch((cause) => {
    throw new Error(`Packaged Dayflow verification failed: ${label} is missing: ${path}`, { cause });
  });
  if (metadata.isSymbolicLink() || (type === 'directory' ? !metadata.isDirectory() : !metadata.isFile())) {
    throw new Error(`Packaged Dayflow verification failed: ${label} must be a real ${type}: ${path}`);
  }
  return metadata;
}

function containedPath(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..');
}

async function realDescendant(root, segments, finalType, label) {
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    if (!containedPath(root, current)) {
      throw new Error(`Packaged Dayflow verification failed: ${label} escapes the outer app root`);
    }
    await realPathType(current, index === segments.length - 1 ? finalType : 'directory', label);
  }
  return current;
}

function plistValue(plist, key, label) {
  const value = plist?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Packaged Dayflow verification failed: ${label} has no usable ${key}`);
  }
  return value;
}

function safeExecutableBasename(plist, label) {
  const executable = plistValue(plist, 'CFBundleExecutable', label);
  if (
    executable === '.'
    || executable === '..'
    || executable.includes('/')
    || executable.includes('\\')
    || executable.includes('\0')
  ) {
    throw new Error(`Packaged Dayflow verification failed: ${label} CFBundleExecutable must be a single safe basename`);
  }
  return executable;
}

function codesignValue(details, name, label) {
  const match = outputOf(details).match(new RegExp(`^${name}=([^\\r\\n]+)$`, 'm'));
  if (!match?.[1]) {
    throw new Error(`Packaged Dayflow verification failed: ${label} has no usable ${name}`);
  }
  return match[1].trim();
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

function checkExpectedIdentity(actual, expectedIdentity) {
  if (expectedIdentity === undefined) return;
  if (!expectedIdentity || typeof expectedIdentity !== 'object' || Array.isArray(expectedIdentity)) {
    throw new TypeError('expectedIdentity must be an object when supplied');
  }
  const exactFields = ['identifier', 'teamId', 'version', 'build'];
  for (const field of exactFields) {
    if (expectedIdentity[field] !== undefined && expectedIdentity[field] !== actual[field]) {
      throw new Error(`Packaged Dayflow verification failed: expected outer app ${field} ${expectedIdentity[field]}, found ${actual[field]}`);
    }
  }
  if (expectedIdentity.architecture !== undefined && !actual.architectures.includes(expectedIdentity.architecture)) {
    throw new Error(`Packaged Dayflow verification failed: expected outer app architecture ${expectedIdentity.architecture}, found ${actual.architectures.join(' ')}`);
  }
}

async function inspectOuterApp({ appRoot, execute, expectedIdentity }) {
  const infoPlist = await realDescendant(appRoot, ['Contents', 'Info.plist'], 'file', 'outer Info.plist');
  const infoResult = await checked(execute, 'plutil', ['-convert', 'json', '-o', '-', infoPlist], 'outer Info.plist could not be read');
  let plist;
  try {
    plist = JSON.parse(infoResult.stdout);
  } catch (cause) {
    throw new Error('Packaged Dayflow verification failed: outer Info.plist is not valid JSON', { cause });
  }

  const executableName = safeExecutableBasename(plist, 'outer Info.plist');
  const executable = await realDescendant(appRoot, ['Contents', 'MacOS', executableName], 'file', 'outer executable');
  const details = await checked(execute, 'codesign', ['-d', '--verbose=4', appRoot], 'outer Rhythm signing identity inspection failed');
  const lipo = await checked(execute, 'lipo', ['-archs', executable], 'outer Rhythm architecture inspection failed');
  const architectures = lipo.stdout.trim().split(/\s+/).filter(Boolean);
  if (architectures.length === 0) throw new Error('Packaged Dayflow verification failed: outer Rhythm has no executable architecture');

  const outerApp = {
    version: plistValue(plist, 'CFBundleShortVersionString', 'outer Info.plist'),
    build: plistValue(plist, 'CFBundleVersion', 'outer Info.plist'),
    identifier: codesignValue(details, 'Identifier', 'outer Rhythm signing details'),
    teamId: codesignValue(details, 'TeamIdentifier', 'outer Rhythm signing details'),
    architectures,
    executableSha256: await sha256(executable),
  };
  const cdHash = outputOf(details).match(/^CDHash=([^\r\n]+)$/m)?.[1]?.trim();
  if (cdHash) outerApp.cdHash = cdHash;
  checkExpectedIdentity(outerApp, expectedIdentity);
  await checked(execute, 'codesign', ['--verify', '--deep', '--strict', appRoot], 'outer Rhythm signature verification failed');
  return outerApp;
}

async function requireLegalFiles(appRoot) {
  const root = await realDescendant(appRoot, legalSegments, 'directory', 'Dayflow legal directory');
  const requiredFiles = ['LICENSE', 'NOTICES.md', 'notice-sources.json', 'THIRD-PARTY-NOTICES.txt'];
  for (const name of requiredFiles) {
    await realDescendant(root, [name], 'file', `Dayflow legal ${name}`);
  }
  const sourceLicenses = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => /^LICENSE-.+\.txt$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (sourceLicenses.length === 0) {
    throw new Error('Packaged Dayflow verification failed: Dayflow legal LICENSE-*.txt source file is missing');
  }
  for (const name of sourceLicenses) {
    await realDescendant(root, [name], 'file', `Dayflow legal ${name}`);
  }
  return {
    root: legalSegments.join('/'),
    LICENSE: true,
    'NOTICES.md': true,
    'notice-sources.json': true,
    'THIRD-PARTY-NOTICES.txt': true,
    sourceLicenses,
  };
}

/**
 * Verify a packaged Rhythm.app without launching it or changing any signature.
 * `execute` is injectable only for controlled synthetic fixture tests; macOS tools
 * are the authority for real signature and Gatekeeper results.
 */
export async function verifyPackagedDayflow({
  appRoot,
  execute = defaultExecute,
  expectedIdentity,
} = {}) {
  if (typeof appRoot !== 'string' || !appRoot.trim() || !isAbsolute(appRoot)) {
    throw new Error('Packaged Dayflow verification requires an explicit absolute Rhythm.app path');
  }
  if (typeof execute !== 'function') throw new TypeError('Packaged Dayflow verification requires a command executor');

  const root = resolve(appRoot);
  await realPathType(root, 'directory', 'outer app root');
  const dayflowRoot = await realDescendant(root, dayflowSegments, 'directory', 'bundled Dayflow root');
  const legalFiles = await requireLegalFiles(root);
  const outerApp = await inspectOuterApp({ appRoot: root, execute, expectedIdentity });
  const dayflow = await validateDayflowDesktopArtifact({
    appRoot: dayflowRoot,
    targetArch: 'arm64',
    execute,
  });
  if (dayflow.architecture === 'arm64' && !outerApp.architectures.includes('arm64')) {
    throw new Error('Packaged Dayflow verification failed: outer Rhythm must contain arm64 because bundled Dayflow is arm64');
  }

  return {
    status: 'verified',
    scope: 'packaged_integrity_only',
    appRoot: root,
    version: outerApp.version,
    build: outerApp.build,
    id: outerApp.identifier,
    team: outerApp.teamId,
    architecture: outerApp.architectures,
    executableContentHash: outerApp.executableSha256,
    outerApp,
    outerSignature: { status: 'verified', command: 'codesign --verify --deep --strict' },
    upstreamDayflow: {
      present: true,
      path: dayflowSegments.join('/'),
      signature: 'verified',
      version: dayflow.version,
      build: dayflow.build,
      identifier: dayflow.identifier,
      teamId: dayflow.teamId,
      architecture: dayflow.architecture,
      executableSha256: dayflow.executableSha256,
    },
    legalFiles,
    captureGate: 'not_tested',
    captureGateReason,
  };
}

async function writeReceipt(receipt, receiptPath) {
  if (!isAbsolute(receiptPath)) throw new Error('Receipt path must be explicit and absolute');
  await realPathType(dirname(receiptPath), 'directory', 'receipt parent directory');
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

function parseCli(argv) {
  const expectedIdentity = {};
  let appRoot;
  let receiptPath;
  const options = new Map([
    ['--app', (value) => { appRoot = value; }],
    ['--receipt', (value) => { receiptPath = value; }],
    ['--expected-identifier', (value) => { expectedIdentity.identifier = value; }],
    ['--expected-team-id', (value) => { expectedIdentity.teamId = value; }],
    ['--expected-version', (value) => { expectedIdentity.version = value; }],
    ['--expected-build', (value) => { expectedIdentity.build = value; }],
    ['--expected-architecture', (value) => { expectedIdentity.architecture = value; }],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const set = options.get(option);
    if (!set || index + 1 >= argv.length) throw new Error(`Unknown or incomplete option: ${option}`);
    set(argv[index + 1]);
    index += 1;
  }
  return { appRoot, receiptPath, expectedIdentity: Object.keys(expectedIdentity).length ? expectedIdentity : undefined };
}

async function main() {
  try {
    const { appRoot, receiptPath, expectedIdentity } = parseCli(process.argv.slice(2));
    const receipt = await verifyPackagedDayflow({ appRoot, expectedIdentity });
    if (receiptPath) await writeReceipt(receipt, receiptPath);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (cause) {
    process.stdout.write(`${JSON.stringify({ status: 'failed', error: cause instanceof Error ? cause.message : String(cause) })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
