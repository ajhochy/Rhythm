// Launch the real packaged Rhythm.app and attach Playwright over CDP.
// ponytail: hardened fuses disable Node inspection, so `_electron.launch` cannot work;
// the app owns its runtime (api_server :4001, engine :4096) exactly as a user launch does.
import { test as base, chromium, type Browser, type Page } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

export const RUNTIME_PORTS = [4001, 4096, 4002];
const appPath = process.env.RHYTHM_PACKAGED_APP ?? '';
// Real HOME and the app's own profile: the Keychain-backed sign-in only persists under the
// user's real HOME, so the smoke reuses the normal saved session. It touches real local data;
// the port check below guarantees the installed app is not running alongside it.
// RHYTHM_SMOKE_USER_DATA swaps in a separate profile (sign in once via test:packaged:login).
const fixtureManifest = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const fixture = fixtureManifest ? readQualificationFixture(fixtureManifest, process.env.RHYTHM_FEATURE_EXPECTED_REVISION) : undefined;
if (fixture && process.env.RHYTHM_SMOKE_USER_DATA && process.env.RHYTHM_SMOKE_USER_DATA !== fixture.userDataPath)
  throw new Error('Qualification fixture Chromium profile differs');
const userData = fixture?.userDataPath ?? process.env.RHYTHM_SMOKE_USER_DATA
  ?? path.join(homedir(), 'Library/Application Support/rhythm-electron-shell');
export const loginMode = process.env.RHYTHM_SMOKE_LOGIN === '1';

export function listeningPid(port: number): string {
  try {
    return execFileSync('/usr/sbin/lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 5_000 }).trim();
  } catch { return ''; }
}

export function bundleVersion(app: string): string {
  return execFileSync('/usr/bin/defaults', ['read', path.join(app, 'Contents/Info.plist'), 'CFBundleShortVersionString'], { encoding: 'utf8' }).trim();
}

export type PackagedApp = {
  page: Page;
  child: ChildProcess;
  appPath: string;
  pageErrors: string[];
  output(): string;
  /** Idempotent: SIGTERM (graceful quit), escalate to SIGKILL after 15s. */
  quit(): Promise<{ code: number | null; signal: string | null }>;
};

async function launch(): Promise<{ app: PackagedApp; browser: Browser }> {
  if (fixtureManifest) readQualificationFixture(fixtureManifest, process.env.RHYTHM_FEATURE_EXPECTED_REVISION);
  if (!appPath || !existsSync(path.join(appPath, 'Contents/MacOS/Rhythm'))) {
    throw new Error(`Set RHYTHM_PACKAGED_APP to a Rhythm.app bundle (got "${appPath}")`);
  }
  const expectedRevision = process.env.RHYTHM_FEATURE_EXPECTED_REVISION;
  if (expectedRevision) {
    const identityPath = path.join(appPath, 'Contents/Resources/api_server/build-identity.json');
    const identity = existsSync(identityPath) ? JSON.parse(readFileSync(identityPath, 'utf8')) : null;
    if (identity?.schemaVersion !== 1 || identity.sourceRevision !== expectedRevision) {
      throw new Error(`UNVERIFIED: bundle must be built from mega ${expectedRevision}; refusing to launch it against the real profile`);
    }
    const engineVersion = execFileSync(path.join(appPath, 'Contents/Resources/opencode_bin/opencode'), ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim();
    if (engineVersion !== `0.0.0-rhythm-${expectedRevision}`) throw new Error('UNVERIFIED: bundled engine does not match the mega revision');
  }
  // A second instance would adopt a running Rhythm's runtime and its real data.
  const busy = RUNTIME_PORTS.filter((port) => listeningPid(port));
  if (busy.length) throw new Error(`Ports ${busy.join(', ')} are in use. Quit Rhythm (and any dev api_server/engine) before the packaged smoke.`);

  mkdirSync(userData, { recursive: true, mode: 0o700 });
  rmSync(path.join(userData, 'DevToolsActivePort'), { force: true });

  // Log to a file, not a pipe: the app must never write into a pipe this runner has closed.
  const logPath = path.join(tmpdir(), 'rhythm-packaged-smoke.log');
  const log = openSync(logPath, 'w');
  const child = spawn(path.join(appPath, 'Contents/MacOS/Rhythm'), ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], {
    env: { ...process.env, RHYTHM_SHELL_USER_DATA: userData },
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  const running = () => child.exitCode === null && child.signalCode === null;
  const stop = async () => {
    if (running()) {
      child.kill('SIGTERM');
      for (let i = 0; i < 150 && running(); i++) await delay(100);
      if (running()) child.kill('SIGKILL');
      for (let i = 0; i < 50 && running(); i++) await delay(100);
    }
    return { code: child.exitCode, signal: child.signalCode };
  };
  const output = () => { try { return readFileSync(logPath, 'utf8').slice(-65_536); } catch { return ''; } };
  try {
    return await attach(child, userData, output, stop);
  } catch (error) {
    await stop();
    throw error;
  }
}

async function attach(
  child: ChildProcess, userData: string, output: () => string,
  stop: () => Promise<{ code: number | null; signal: string | null }>,
): Promise<{ app: PackagedApp; browser: Browser }> {
  let endpoint = '';
  for (let i = 0; i < 300 && !endpoint; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Rhythm exited before CDP was ready\n${output()}`);
    endpoint = output().match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/\S+)/)?.[1] ?? '';
    const activePort = path.join(userData, 'DevToolsActivePort');
    if (!endpoint && existsSync(activePort)) {
      const [port, wsPath] = readFileSync(activePort, 'utf8').trim().split('\n');
      if (port && wsPath) endpoint = `ws://127.0.0.1:${port}${wsPath}`;
    }
    if (!endpoint) await delay(100);
  }
  if (!endpoint) throw new Error(`Packaged Chromium never exposed CDP\n${output()}`);

  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  const context = browser.contexts()[0];
  let page = context.pages().find((candidate) => candidate.url().startsWith('rhythm://app'));
  // The window opens after the runtime is ready (45s budget, longer on a quarantined first launch).
  for (let i = 0; !page && i < 900; i++) {
    await delay(100);
    page = context.pages().find((candidate) => candidate.url().startsWith('rhythm://app'));
  }
  if (!page) {
    await browser.close().catch(() => {});
    throw new Error(`No rhythm://app window after 90s. Pages: ${context.pages().map((p) => p.url()).join(', ')}\n${output().slice(-3000)}`);
  }
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const quit = async () => { await browser.close().catch(() => {}); return stop(); };
  return { app: { page, child, appPath, pageErrors, output, quit }, browser };
}

/** Wait for the main UI; in login mode, give the human time to finish Google sign-in once. */
export async function waitForSignedIn(page: Page) {
  const signIn = page.getByRole('heading', { name: 'Sign in to Rhythm' });
  const main = page.locator('#main-content');
  const fatal = page.getByRole('heading', { name: 'Live gateway could not start', exact: true });
  await main.or(signIn).or(fatal).first().waitFor({ timeout: 90_000 });
  if (await main.isVisible()) return;
  if (await fatal.isVisible()) throw new Error(`Packaged startup failed: ${await page.getByRole('alert').innerText()}`);
  if (!loginMode) {
    throw new Error('UNVERIFIED: the smoke profile is not signed in. Run `npm run test:packaged:login` once and complete Google sign-in.');
  }
  console.log('\n>>> Click "Continue with Google" in the Rhythm window and finish sign-in (5 minutes)...\n');
  await main.waitFor({ timeout: 300_000 });
}

export const test = base.extend<{ page: Page }, { packaged: PackagedApp }>({
  packaged: [async ({}, use) => {
    const { app } = await launch();
    try { await use(app); } finally { await app.quit(); }
  }, { scope: 'worker', timeout: 120_000 }],
  page: async ({ packaged }, use) => { await use(packaged.page); },
});
export { expect } from '@playwright/test';
