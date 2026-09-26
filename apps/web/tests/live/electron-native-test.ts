import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium, test as browserTest, type Page } from '@playwright/test';
import { liveEnvironment } from '../live-environment';

export const nativeElectronTransport = process.env.RHYTHM_LIVE_ELECTRON_TRANSPORT === '1';

export function assertCandidateProcessIdentity(
  pidInfo: string,
  loadedFiles: string,
  executable: string,
  ownerUid: number,
): void {
  const match = pidInfo.trim().match(/^(\d+)\s+[\s\S]+$/);
  const fileLines = loadedFiles.split(/\r?\n/);
  const executableEntry = fileLines.findIndex((line) => line === 'ftxt');
  const loadedExecutable = executableEntry < 0 ? undefined : fileLines[executableEntry + 1]?.slice(1);
  if (!match || Number(match[1]) !== ownerUid ||
      fileLines[executableEntry + 1]?.[0] !== 'n' || loadedExecutable !== executable) {
    throw new Error('Native live smoke PID is not the owned packaged Rhythm executable');
  }
}

export function assertDisposableUserDataRoot(root: string): void {
  if (!root.startsWith('/private/tmp/') && !root.startsWith('/private/var/folders/')) {
    throw new Error('Native live smoke requires disposable userData under /private/tmp or /private/var/folders');
  }
}

export function isExpectedNativeLiveRoute(rawUrl: string, route: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'rhythm:' || url.hostname !== 'app' || url.port || url.pathname !== '/index.html'
        || url.search || url.username || url.password || !url.hash.startsWith('#/')) return false;
    const hashRoute = new URL(url.hash.slice(1), 'https://rhythm-live-route.invalid');
    const expectedPath = route.startsWith('/') ? route : `/${route}`;
    return hashRoute.origin === 'https://rhythm-live-route.invalid'
      && hashRoute.pathname === expectedPath && !hashRoute.hash;
  } catch {
    return false;
  }
}

const sourceBearingRoots = [
  'Contents/Resources/app/src',
  'Contents/Resources/app/web/dist',
] as const;

const hermesSourceExtensions = new Set(['.cjs', '.css', '.html', '.js', '.mjs']);
const embeddedElectronMajor = 40;
const hermesArtifactResolverUrl = new URL('../../../electron/src/hermes-desktop-artifact.mjs', import.meta.url);

function payloadHash(filePath: string): string {
  const info = lstatSync(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid()) {
    throw new Error('Native live smoke candidate payload must contain owned, non-symlink regular files');
  }
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function sourceFileInventory(root: string, include = (_relativePath: string) => true): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (directory: string, relativeDirectory: string) => {
    const directoryInfo = lstatSync(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || directoryInfo.uid !== process.getuid()) {
      throw new Error('Native live smoke candidate payload must contain owned, non-symlink directories');
    }
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(directory, entry.name);
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const info = lstatSync(filePath);
      if (info.isSymbolicLink()) {
        throw new Error('Native live smoke candidate payload must not contain symlinks');
      }
      if (info.isDirectory()) visit(filePath, relativePath);
      else if (info.isFile()) {
        if (include(relativePath)) files.set(relativePath, payloadHash(filePath));
      } else throw new Error('Native live smoke candidate payload contains an unsupported filesystem entry');
    }
  };
  visit(root, '');
  return files;
}

function assertMatchingSourcePayload(candidateApp: string, worktreeApp: string, relativeRoot: string): void {
  const candidateFiles = sourceFileInventory(path.join(candidateApp, relativeRoot));
  const worktreeFiles = sourceFileInventory(path.join(worktreeApp, relativeRoot));
  if (candidateFiles.size !== worktreeFiles.size) {
    throw new Error('Native live smoke installed candidate payload does not match this worktree package');
  }
  for (const [relativePath, worktreeHash] of worktreeFiles) {
    if (candidateFiles.get(relativePath) !== worktreeHash) {
      throw new Error('Native live smoke installed candidate payload does not match this worktree package');
    }
  }
}

function canonicalManifestFiles(files: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}

async function validateHermesArtifactManifest(artifactRoot: string, expectedSourceCommit?: string): Promise<string> {
  const { resolveHermesDesktopArtifact } = await import(hermesArtifactResolverUrl.href) as {
    resolveHermesDesktopArtifact: (options: {
      artifactRoot: string;
      expectedElectronMajor: number;
      expectedSourceCommit?: string;
    }) => Promise<{ manifest: Record<string, unknown> }>;
  };
  const artifact = await resolveHermesDesktopArtifact({
    artifactRoot,
    expectedElectronMajor: embeddedElectronMajor,
    expectedSourceCommit,
  });
  const manifest = artifact.manifest;
  return JSON.stringify({
    electronMajor: manifest.electronMajor,
    files: canonicalManifestFiles(manifest.files as Record<string, unknown>),
    product: manifest.product,
    schemaVersion: manifest.schemaVersion,
    sourceCommit: manifest.sourceCommit,
  });
}

export function assertCandidateExecutablePath(candidateBinary: string, worktreeBinary: string, installedCandidateBinary: string): void {
  const candidate = path.resolve(candidateBinary);
  if (candidate !== path.resolve(worktreeBinary) && candidate !== path.resolve(installedCandidateBinary)) {
    throw new Error('Native live smoke executable must be this worktree package or the exact installed qualification candidate');
  }
}

/**
 * Allows either this worktree's packaged binary or the exact installed
 * qualification candidate, but only when its source-bearing payload is byte
 * identical to the worktree package being reviewed.
 */
export async function assertCandidatePayloadIdentity(
  candidateBinary: string,
  worktreeBinary: string,
  installedCandidateBinary?: string,
): Promise<void> {
  const candidate = realpathSync(candidateBinary);
  const worktree = realpathSync(worktreeBinary);

  if (candidate === worktree) return;
  const installed = installedCandidateBinary ? realpathSync(installedCandidateBinary) : undefined;
  if (!installed || candidate !== installed) {
    throw new Error('Native live smoke executable must be this worktree package or the exact installed qualification candidate');
  }

  const candidateApp = path.resolve(candidate, '../../..');
  const worktreeApp = path.resolve(worktree, '../../..');
  for (const relativeRoot of sourceBearingRoots) {
    assertMatchingSourcePayload(candidateApp, worktreeApp, relativeRoot);
  }
  const worktreeManifest = await validateHermesArtifactManifest(path.join(worktreeApp, 'Contents/Resources/hermes-desktop'));
  const expectedSourceCommit = JSON.parse(worktreeManifest).sourceCommit as string;
  if (await validateHermesArtifactManifest(path.join(candidateApp, 'Contents/Resources/hermes-desktop'), expectedSourceCommit) !== worktreeManifest) {
    throw new Error('Native live smoke installed candidate manifest does not match this worktree package');
  }
  const isHermesSourceFile = (relativePath: string) => hermesSourceExtensions.has(path.extname(relativePath));
  const candidateHermesSources = sourceFileInventory(path.join(candidateApp, 'Contents/Resources/hermes-desktop'), isHermesSourceFile);
  const worktreeHermesSources = sourceFileInventory(path.join(worktreeApp, 'Contents/Resources/hermes-desktop'), isHermesSourceFile);
  if (candidateHermesSources.size !== worktreeHermesSources.size) {
    throw new Error('Native live smoke installed candidate Hermes source payload does not match this worktree package');
  }
  for (const [relativePath, worktreeHash] of worktreeHermesSources) {
    if (candidateHermesSources.get(relativePath) !== worktreeHash) {
      throw new Error('Native live smoke installed candidate Hermes source payload does not match this worktree package');
    }
  }
}

async function ownedCandidate(): Promise<string> {
  const userData = process.env.RHYTHM_LIVE_ELECTRON_USER_DATA;
  const executable = process.env.RHYTHM_LIVE_ELECTRON_EXECUTABLE;
  const cdpUrl = process.env.RHYTHM_LIVE_ELECTRON_CDP_URL;
  const expectedPid = Number(process.env.RHYTHM_LIVE_ELECTRON_PID);
  if (process.env.RHYTHM_LIVE_E2E !== '1' || !process.env.RHYTHM_LIVE_TOKEN?.trim()) {
    throw new Error('Native live smoke requires RHYTHM_LIVE_E2E=1 and an APIRequest-only RHYTHM_LIVE_TOKEN');
  }
  if (!userData || !path.isAbsolute(userData) || !executable || !path.isAbsolute(executable) ||
      !cdpUrl || !Number.isSafeInteger(expectedPid) || expectedPid <= 0) {
    throw new Error('Native live smoke requires absolute userData/executable paths, loopback CDP URL, and candidate PID');
  }
  const root = realpathSync(userData);
  assertDisposableUserDataRoot(root);
  const info = lstatSync(userData);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) {
    throw new Error('Native live smoke userData must be an owned, non-symlink directory');
  }
  const expectedBinaryPath = path.resolve(import.meta.dirname, '../../../electron/dist/Rhythm.app/Contents/MacOS/Rhythm');
  const installedCandidate = path.resolve(homedir(), 'Applications', 'Rhythm Mega Desktop Candidate.app', 'Contents', 'MacOS', 'Rhythm');
  assertCandidateExecutablePath(executable, expectedBinaryPath, installedCandidate);
  const binary = realpathSync(executable);
  const expectedBinary = realpathSync(expectedBinaryPath);
  await assertCandidatePayloadIdentity(binary, expectedBinary, installedCandidate);
  const endpoint = new URL(cdpUrl);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      !endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash ||
      endpoint.username || endpoint.password) {
    throw new Error('Native live smoke CDP URL must be plain http://127.0.0.1:<port>');
  }
  const portFile = path.join(root, 'DevToolsActivePort');
  const portInfo = lstatSync(portFile);
  if (!portInfo.isFile() || portInfo.isSymbolicLink() || portInfo.uid !== process.getuid()) {
    throw new Error('Native live smoke requires an owned DevToolsActivePort file in candidate userData');
  }
  const activePort = Number(readFileSync(portFile, 'utf8').split(/\r?\n/, 1)[0]);
  if (activePort !== Number(endpoint.port)) {
    throw new Error('Native live smoke CDP port does not match candidate userData');
  }
  const listeners = execFileSync('lsof', ['-nP', `-iTCP:${activePort}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
    .trim().split(/\s+/).filter(Boolean);
  if (listeners.length !== 1 || Number(listeners[0]) !== expectedPid) {
    throw new Error('Native live smoke CDP listener does not match the parent-owned candidate PID');
  }
  const pidInfo = execFileSync('ps', ['-p', String(expectedPid), '-o', 'uid=', '-o', 'command='], { encoding: 'utf8' }).trim();
  const loadedFiles = execFileSync('lsof', ['-a', '-p', String(expectedPid), '-d', 'txt', '-Fn'], { encoding: 'utf8' });
  assertCandidateProcessIdentity(pidInfo, loadedFiles, binary, process.getuid()!);
  return cdpUrl;
}

const electronTest = browserTest.extend<{ page: Page }, { nativePage: Page }>({
  nativePage: [async ({}, use) => {
    const endpoint = await ownedCandidate();
    // This is a parent-owned process. Do not call browser.close()/context.close()/page.close().
    // The worker's process exit releases its CDP socket without closing Electron.
    const connection = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
    const candidates = connection.contexts().flatMap((context) => context.pages())
      .filter((page) => /^rhythm:\/\/app\/index\.html(?:#.*)?$/.test(page.url()));
    if (candidates.length !== 1) throw new Error('Native live smoke requires exactly one existing Rhythm app page');
    const page = candidates[0];
    const environment = liveEnvironment();
    const host = await page.evaluate(() => {
      const shell = (window as Window & { rhythmShell?: {
        gateway?: { apiBase?: string; engineBase?: string; productionApiBase?: string };
        auth?: { currentSession?: unknown };
      } }).rhythmShell;
      return { gateway: shell?.gateway, hasSessionBridge: typeof shell?.auth?.currentSession === 'function' };
    });
    if (!host.hasSessionBridge || host.gateway?.apiBase !== environment.apiBase ||
        host.gateway?.engineBase !== environment.engineBase ||
        host.gateway?.productionApiBase !== environment.productionApiBase) {
      throw new Error('Native live smoke attached to a Rhythm page with a different host gateway or no auth bridge');
    }
    if (!(await page.locator('#main-content').isVisible())) {
      throw new Error('Native live smoke requires the existing page to be authenticated before attachment');
    }
    const originalHash = new URL(page.url()).hash;
    try {
      await use(page);
    } finally {
      if (!page.isClosed()) await page.evaluate((hash) => { window.location.hash = hash; }, originalHash);
    }
  }, { scope: 'worker' }],
  page: async ({ nativePage }, use) => { await use(nativePage); },
});

export const test = nativeElectronTransport ? electronTest : browserTest;
