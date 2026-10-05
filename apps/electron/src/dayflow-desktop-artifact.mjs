import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, open, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DAYFLOW_BUNDLE_IDENTIFIER = 'teleportlabs.com.Dayflow';
export const DAYFLOW_TEAM_ID = 'L75WYD8X4Y';
export const DAYFLOW_VERSION = '2.6.0';
export const DAYFLOW_BUILD = '133';
export const DAYFLOW_ARCHITECTURE = 'arm64';
// This is intentionally an exact requirement, rather than a team-only check. It pins the
// Developer ID intermediates and leaf-purpose OIDs used by the upstream Dayflow release.
export const DAYFLOW_DESIGNATED_REQUIREMENT = 'anchor apple generic and identifier "teleportlabs.com.Dayflow" and certificate leaf[subject.OU] = "L75WYD8X4Y" and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */';

/**
 * @typedef {object} DayflowCommandResult
 * @property {string} stdout
 * @property {string} stderr
 */

/** @typedef {(command: string, args: string[]) => Promise<DayflowCommandResult>} DayflowCommandExecutor */

/**
 * @typedef {object} DayflowDesktopArtifact
 * @property {string} root
 * @property {string} executable
 * @property {string} architecture
 * @property {string} version
 * @property {string} build
 * @property {string} identifier
 * @property {string} teamId
 * @property {string} designatedRequirement
 * @property {string} executableSha256
 */

/**
 * @typedef {object} DayflowArtifactValidationOptions
 * @property {string} [appRoot]
 * @property {string} [targetArch]
 * @property {DayflowCommandExecutor} [execute]
 */

/**
 * @typedef {object} DayflowArtifactStagingOptions
 * @property {string} [resources]
 * @property {string} [appRoot]
 * @property {string} [targetArch]
 * @property {DayflowCommandExecutor} [execute]
 * @property {string} [legalRoot]
 */

/** @typedef {DayflowDesktopArtifact & { appRoot: string, notices: string[] }} StagedDayflowDesktopArtifact */

const legalDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../legal/dayflow');
const noticeName = /^(?:license|licence|notice|notices|copying)(?:[._-].*)?$/i;

/** @param {DayflowCommandResult} result */
function outputOf(result) {
  return `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
}

/**
 * @param {DayflowCommandExecutor} execute
 * @param {string} command
 * @param {string[]} args
 * @param {string} label
 * @returns {Promise<DayflowCommandResult>}
 */
async function checked(execute, command, args, label) {
  try {
    return await execute(command, args);
  } catch (cause) {
    throw new Error(`Dayflow artifact verification failed: ${label}`, { cause });
  }
}

/** @param {string} path @param {string} label */
async function requiredDirectory(path, label) {
  const metadata = await lstat(path).catch((cause) => {
    throw new Error(`Dayflow artifact ${label} is missing: ${path}`, { cause });
  });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Dayflow artifact ${label} must be a real directory: ${path}`);
  }
}

/** @param {Record<string, unknown>} plist @param {string} key @param {string} expected */
function requiredValue(plist, key, expected) {
  if (plist?.[key] !== expected) {
    throw new Error(`Dayflow artifact ${key} mismatch: expected ${expected}, found ${String(plist?.[key])}`);
  }
}

/** @param {string} targetArch */
function expectedArchitecture(targetArch) {
  if (targetArch !== DAYFLOW_ARCHITECTURE) {
    throw new Error(`Dayflow artifact supports only ${DAYFLOW_ARCHITECTURE} packaging; refusing target ${targetArch}`);
  }
  return DAYFLOW_ARCHITECTURE;
}

/** @param {string} path */
async function sha256(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Validates the immutable upstream Dayflow application. `execute` is injectable solely for
 * deterministic command-construction tests; only the real macOS tools establish trust.
 */
/**
 * @param {DayflowArtifactValidationOptions} [options]
 * @returns {Promise<DayflowDesktopArtifact>}
 */
export async function validateDayflowDesktopArtifact({
  appRoot = process.env.RHYTHM_DAYFLOW_APP_DIR,
  targetArch = process.arch,
  execute,
} = {}) {
  if (typeof appRoot !== 'string' || !appRoot.trim()) {
    throw new Error('Dayflow desktop artifact is required for packaging. Set RHYTHM_DAYFLOW_APP_DIR to the signed Dayflow.app.');
  }
  if (typeof execute !== 'function') throw new TypeError('Dayflow artifact validation requires a command executor');

  const root = resolve(appRoot);
  const architecture = expectedArchitecture(targetArch);
  await requiredDirectory(root, 'root');
  const infoPlist = resolve(root, 'Contents/Info.plist');
  const executable = resolve(root, 'Contents/MacOS/Dayflow');
  const info = await checked(execute, 'plutil', ['-convert', 'json', '-o', '-', infoPlist], 'Info.plist could not be read');
  /** @type {Record<string, unknown>} */
  let plist;
  try {
    plist = JSON.parse(info.stdout);
  } catch (cause) {
    throw new Error('Dayflow artifact Info.plist is not valid JSON', { cause });
  }
  requiredValue(plist, 'CFBundleIdentifier', DAYFLOW_BUNDLE_IDENTIFIER);
  requiredValue(plist, 'CFBundleShortVersionString', DAYFLOW_VERSION);
  requiredValue(plist, 'CFBundleVersion', DAYFLOW_BUILD);

  const details = await checked(execute, 'codesign', ['-d', '--verbose=4', root], 'codesign identity inspection failed');
  const detailsOutput = outputOf(details);
  if (!detailsOutput.includes(`Identifier=${DAYFLOW_BUNDLE_IDENTIFIER}`)) {
    throw new Error(`Dayflow artifact signing identifier mismatch: expected ${DAYFLOW_BUNDLE_IDENTIFIER}`);
  }
  if (!detailsOutput.includes(`TeamIdentifier=${DAYFLOW_TEAM_ID}`)) {
    throw new Error(`Dayflow artifact signing team mismatch: expected ${DAYFLOW_TEAM_ID}`);
  }
  const lipo = await checked(execute, 'lipo', ['-archs', executable], 'architecture inspection failed');
  if (lipo.stdout.trim() !== architecture) {
    throw new Error(`Dayflow artifact architecture mismatch: expected ${architecture}, found ${lipo.stdout.trim() || 'none'}`);
  }
  // codesign interprets a bare -R argument as a requirement-file path. The leading `=` makes
  // this an exact inline requirement expression (codesign(1), requirement source syntax).
  await checked(execute, 'codesign', ['--verify', '--deep', '--strict', '-R', `=${DAYFLOW_DESIGNATED_REQUIREMENT}`, root], 'exact designated requirement verification failed');
  await checked(execute, 'spctl', ['--assess', '--type', 'execute', '--verbose', root], 'Gatekeeper assessment failed');
  return {
    root,
    executable,
    architecture,
    version: DAYFLOW_VERSION,
    build: DAYFLOW_BUILD,
    identifier: DAYFLOW_BUNDLE_IDENTIFIER,
    teamId: DAYFLOW_TEAM_ID,
    designatedRequirement: DAYFLOW_DESIGNATED_REQUIREMENT,
    executableSha256: await sha256(executable),
  };
}

/** @param {string} root @param {string} candidate */
function containedPath(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

/** True for the foreign app and every descendant, never for its Resource siblings. */
/** @param {string} candidate @param {string} appRoot */
export function isDayflowDesktopSubtree(candidate, appRoot) {
  return containedPath(resolve(appRoot), resolve(candidate));
}

// Mach-O magic numbers (32/64-bit, fat/universal, both endiannesses).
const MACHO_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

/** @param {string} path */
export async function isMachO(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    return bytesRead === 4 && MACHO_MAGIC.has(buffer.readUInt32BE(0));
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/**
 * Finds nested native signing targets without following symlinks. A sibling symlink may point
 * into Dayflow.app; testing Mach-O magic through that alias would otherwise re-sign foreign code.
 */
/**
 * @param {string} root
 * @param {{ excludedRoots?: string[] }} [options]
 * @returns {Promise<string[]>}
 */
export async function findNestedCodeSignTargets(root, { excludedRoots = [] } = {}) {
  /** @type {string[]} */
  const targets = [];
  /** @param {string} directory */
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      // Do this before either traversal or isMachO(): isMachO follows a symlink target.
      if (entry.isSymbolicLink()) continue;
      if (excludedRoots.some((excludedRoot) => isDayflowDesktopSubtree(full, excludedRoot))) continue;
      if (entry.isDirectory()) {
        if (entry.name.endsWith('.app') || entry.name.endsWith('.framework')) targets.push(full);
        await walk(full);
      } else if (/\.(dylib|so|node)$/.test(entry.name) || await isMachO(full)) {
        targets.push(full);
      }
    }
  }
  await walk(root);
  return targets.sort((left, right) => right.split('/').length - left.split('/').length);
}

/** @param {string} appRoot @param {string} noticesRoot @returns {Promise<string[]>} */
async function copyBundledNotices(appRoot, noticesRoot) {
  /** @type {string[]} */
  const notices = [];
  /** @param {string} directory */
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && noticeName.test(entry.name)) notices.push(path);
    }
  }
  await visit(appRoot);
  for (const source of notices) {
    const destination = resolve(noticesRoot, relative(appRoot, source));
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { dereference: false, preserveTimestamps: true, verbatimSymlinks: true });
  }
  return notices.map((notice) => relative(appRoot, notice).split(sep).join('/')).sort();
}

/** @param {string} sourceRoot @param {string} destinationRoot */
async function copyLegalDirectory(sourceRoot, destinationRoot) {
  await requiredDirectory(sourceRoot, 'legal directory');
  /** @param {string} directory */
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const source = resolve(directory, entry.name);
      const destination = resolve(destinationRoot, relative(sourceRoot, source));
      if (entry.isDirectory()) {
        await visit(source);
      } else if (entry.isFile()) {
        await mkdir(dirname(destination), { recursive: true });
        await cp(source, destination, { dereference: false, preserveTimestamps: true, verbatimSymlinks: true });
      }
    }
  }
  await visit(sourceRoot);
}

/**
 * Stages a verified, unchanged upstream bundle and legal material outside that bundle. No home,
 * PATH, data, configuration, credential, or user-directory fallback is permitted.
 */
/**
 * @param {DayflowArtifactStagingOptions} [options]
 * @returns {Promise<StagedDayflowDesktopArtifact>}
 */
export async function stageDayflowDesktopArtifact({
  resources,
  appRoot = process.env.RHYTHM_DAYFLOW_APP_DIR,
  targetArch = process.arch,
  execute,
  legalRoot = legalDirectory,
} = {}) {
  if (typeof resources !== 'string' || !resources) throw new TypeError('Dayflow staging requires a Resources directory');
  const source = await validateDayflowDesktopArtifact({ appRoot, targetArch, execute });
  const root = resolve(resources, 'dayflow-desktop');
  const destination = resolve(root, 'Dayflow.app');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  // `dereference: false` plus verbatim symlinks keeps the upstream signed tree byte-for-byte in
  // structure; verification below is the authority, not this copy operation or its manifest.
  await cp(source.root, destination, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  const staged = await validateDayflowDesktopArtifact({ appRoot: destination, targetArch, execute });
  const stagedLegalRoot = resolve(root, 'legal');
  await copyLegalDirectory(legalRoot, stagedLegalRoot);
  const notices = await copyBundledNotices(destination, resolve(stagedLegalRoot, 'upstream-app-notices'));
  return { ...staged, root, appRoot: destination, notices };
}
