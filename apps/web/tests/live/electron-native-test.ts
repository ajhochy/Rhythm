import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
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

function ownedCandidate(): string {
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
  if (!root.startsWith('/private/tmp/') && !root.startsWith('/var/folders/')) {
    throw new Error('Native live smoke requires disposable userData under /private/tmp or /var/folders');
  }
  const info = lstatSync(userData);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) {
    throw new Error('Native live smoke userData must be an owned, non-symlink directory');
  }
  const binary = realpathSync(executable);
  const expectedBinary = realpathSync(path.resolve(import.meta.dirname, '../../../electron/dist/Rhythm.app/Contents/MacOS/Rhythm'));
  if (binary !== expectedBinary) {
    throw new Error('Native live smoke executable must be the packaged candidate from this worktree');
  }
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
    const endpoint = ownedCandidate();
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
