/**
 * #748 — ManagedChromeService
 *
 * Launches and owns a dedicated headless Chrome instance on a known CDP port
 * (default 9222) with a temporary --user-data-dir, polls /json/version until
 * ready, and ensures Chrome is available to the agent bash environment so
 * scripts expecting :9222 connect deterministically.
 *
 * Design goals:
 * - NON-BLOCKING: startup does not delay server listen or session creation.
 * - FAILURE-TOLERANT: if no Chrome binary is found or launch fails, logs a
 *   warning and no-ops gracefully — never throws / crashes startup.
 * - IDEMPOTENT REUSE: probes :9222 before spawning; reuses a healthy
 *   pre-existing Chrome (e.g. from a dev session) without launching a second.
 * - SCOPED SHUTDOWN: only kills Chrome instances WE spawned (tracked PID);
 *   never kills a pre-existing/reused Chrome.
 *
 * PATH note (mirrors opencode_client_service.ts augmentPathForOpencode):
 * GUI-launched .app children on macOS inherit a stripped PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin). Binary discovery uses known macOS app
 * paths first, then a /bin/zsh -l -c login-shell fallback so Homebrew paths
 * (/opt/homebrew/bin) are included, mirroring the Node-discovery strategy.
 */

import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHROME_CDP_PORT = 9222;
const DEFAULT_POLL_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const CHROME_CDP_PORT_ENV = 'CHROME_CDP_PORT';
const CHROME_CDP_URL_ENV = 'CHROME_CDP_URL';

/** Known macOS/Linux Chrome binary paths, in discovery order. */
const KNOWN_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

/** Login-shell command to resolve Chrome via PATH (Homebrew etc.). */
const SHELL_CHROME_CMD =
  "which google-chrome-stable 2>/dev/null || " +
  "which google-chrome 2>/dev/null || " +
  "which chromium-browser 2>/dev/null || " +
  "which chromium 2>/dev/null || " +
  "which chrome 2>/dev/null || " +
  "true";

// ---------------------------------------------------------------------------
// Pure / injectable logic (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Dependency surface for the readiness probe — injected in tests so no real
 * HTTP requests are made.
 */
export interface ChromeReadinessDeps {
  /** Probe the CDP /json/version endpoint. Resolves true on HTTP 200, false otherwise. */
  probeCdpVersion: (port: number) => Promise<boolean>;
  /** Sleep for `ms` milliseconds. */
  waitMs: (ms: number) => Promise<void>;
}

export const defaultReadinessDeps: ChromeReadinessDeps = {
  probeCdpVersion: (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const req = http.get(
        { hostname: '127.0.0.1', port, path: '/json/version', timeout: 1000 },
        (res) => {
          res.resume(); // drain
          resolve(res.statusCode === 200);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    }),
  waitMs: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Build the Chrome launch args for the given port and user-data-dir.
 * Pure function — tested without spawning.
 */
export function buildChromeArgs(port: number, userDataDir: string): string[] {
  return [
    `--headless=new`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
  ];
}

/**
 * Locate the Chrome binary using the priority order:
 *   1. RHYTHM_CHROME_BIN env override (if set and exists)
 *   2. Known macOS/Linux app paths (existsSync checks)
 *   3. Login-shell resolution via /bin/zsh -l -c 'which ...'
 *
 * Returns the binary path, or null if none found. Never throws.
 */
export function findChromeBinary(
  deps: {
    envGet?: (key: string) => string | undefined;
    fsExists?: (p: string) => boolean;
    shellResolve?: () => string | null;
  } = {},
): string | null {
  const envGet = deps.envGet ?? ((k) => process.env[k]);
  const fsExists = deps.fsExists ?? existsSync;
  const shellResolve = deps.shellResolve ?? _defaultShellResolve;

  // 1. Env override
  const envBin = envGet('RHYTHM_CHROME_BIN');
  if (envBin) {
    if (fsExists(envBin)) {
      return envBin;
    }
    logger.warn(
      `[ManagedChrome] RHYTHM_CHROME_BIN=${envBin} does not exist — ignoring override`,
    );
  }

  // 2. Known fixed paths
  for (const p of KNOWN_CHROME_PATHS) {
    if (fsExists(p)) {
      return p;
    }
  }

  // 3. Login-shell PATH resolution
  const resolved = shellResolve();
  if (resolved) return resolved;

  return null;
}

/** Default login-shell resolver — runs /bin/zsh -l -c 'which ...' */
function _defaultShellResolve(): string | null {
  try {
    const result = execFileSync('/bin/zsh', ['-l', '-c', SHELL_CHROME_CMD], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    if (result && existsSync(result)) {
      return result;
    }
  } catch {
    // shell not available or which failed — silently ignore
  }
  return null;
}

/**
 * Poll the CDP endpoint until it responds 200 or the timeout expires.
 * Returns true when ready, false on timeout.
 */
export async function waitForChromeReady(
  port: number,
  timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  deps: ChromeReadinessDeps = defaultReadinessDeps,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await deps.probeCdpVersion(port)) return true;
    await deps.waitMs(intervalMs);
  }
  return false;
}

// ---------------------------------------------------------------------------
// ManagedChromeService — lifecycle manager
// ---------------------------------------------------------------------------

/**
 * Optional injectable dependencies for ManagedChromeService (used in tests).
 * Production code uses defaults for all fields.
 */
export interface ManagedChromeServiceDeps {
  /**
   * Override binary discovery. If provided, this function is called instead of
   * the default findChromeBinary(). Useful for mocking in tests without
   * triggering real shell execution.
   */
  findBinary?: () => string | null;
}

export class ManagedChromeService {
  private _port: number;
  private _chromeBin: string | null = null;
  private _childProcess: ChildProcess | null = null;
  private _userDataDir: string | null = null;
  /** true when Chrome was already running before we probed — we don't own it. */
  private _reused = false;
  private _ready = false;
  private _startPromise: Promise<void> | null = null;
  private _findBinary: () => string | null;

  constructor(port: number = CHROME_CDP_PORT, serviceDeps: ManagedChromeServiceDeps = {}) {
    this._port = port;
    this._findBinary = serviceDeps.findBinary ?? findChromeBinary;
  }

  get isReady(): boolean {
    return this._ready;
  }

  get port(): number {
    return this._port;
  }

  /**
   * Returns once Chrome is ready (or the start attempt has resolved). Safe to
   * call multiple times — idempotent after first call.
   */
  async ensureReady(
    deps: ChromeReadinessDeps = defaultReadinessDeps,
  ): Promise<boolean> {
    if (this._ready) return true;
    if (!this._startPromise) {
      this._startPromise = this._start(deps);
    }
    await this._startPromise;
    return this._ready;
  }

  /**
   * Internal start routine. Probe for existing Chrome first; if found, reuse.
   * Otherwise locate binary and spawn. Never throws — failures are logged and
   * _ready stays false.
   */
  private async _start(
    deps: ChromeReadinessDeps = defaultReadinessDeps,
  ): Promise<void> {
    // Step 1: Probe for a pre-existing healthy Chrome on the port.
    if (await deps.probeCdpVersion(this._port)) {
      logger.info(
        `[ManagedChrome] healthy Chrome already on :${this._port} — reusing (will not kill on shutdown)`,
      );
      this._reused = true;
      this._ready = true;
      return;
    }

    // Step 2: Locate the Chrome binary.
    const bin = this._findBinary();
    if (!bin) {
      logger.warn(
        '[ManagedChrome] No Chrome binary found. ' +
          'Agent tasks requiring CDP on :9222 will not have a managed browser. ' +
          'Install Google Chrome or set RHYTHM_CHROME_BIN to the binary path.',
      );
      return;
    }
    this._chromeBin = bin;

    // Step 3: Create a temp user-data-dir.
    let userDataDir: string;
    try {
      userDataDir = mkdtempSync(join(tmpdir(), 'rhythm-chrome-'));
    } catch (err) {
      logger.error(
        `[ManagedChrome] Failed to create temp user-data-dir: ${String(err)}`,
      );
      return;
    }
    this._userDataDir = userDataDir;

    // Step 4: Spawn headless Chrome.
    const args = buildChromeArgs(this._port, userDataDir);
    logger.info(
      `[ManagedChrome] Launching headless Chrome: ${bin} ${args.slice(0, 2).join(' ')} …`,
    );
    try {
      const child = spawn(bin, args, {
        detached: false,
        stdio: 'ignore',
      });
      this._childProcess = child;

      child.on('error', (err) => {
        logger.warn(`[ManagedChrome] Chrome subprocess error: ${err.message}`);
        this._ready = false;
      });
      child.on('exit', (code, signal) => {
        logger.info(
          `[ManagedChrome] Chrome exited (code=${code} signal=${signal})`,
        );
        this._ready = false;
        this._childProcess = null;
      });
    } catch (err) {
      logger.error(`[ManagedChrome] Failed to spawn Chrome: ${String(err)}`);
      this._cleanupUserDataDir();
      return;
    }

    // Step 5: Poll for readiness.
    const ready = await waitForChromeReady(this._port, DEFAULT_POLL_TIMEOUT_MS, DEFAULT_POLL_INTERVAL_MS, deps);
    if (ready) {
      this._ready = true;
      logger.info(
        `[ManagedChrome] Chrome is ready on :${this._port} (PID ${this._childProcess?.pid ?? 'unknown'})`,
      );
    } else {
      logger.warn(
        `[ManagedChrome] Chrome did not become ready on :${this._port} within ${DEFAULT_POLL_TIMEOUT_MS}ms — agent CDP tasks may fail`,
      );
      // Kill the unresponsive child to avoid a zombie.
      this._killOwnedChrome();
    }
  }

  /**
   * Expose CDP env vars into the given environment object so subprocesses
   * (e.g. the opencode engine bash context) see CHROME_CDP_PORT and
   * CHROME_CDP_URL without having to hard-code ports.
   *
   * Call this after Chrome is ready to inject into the engine's env dict.
   */
  injectEnvVars(env: Record<string, string>): void {
    env[CHROME_CDP_PORT_ENV] = String(this._port);
    env[CHROME_CDP_URL_ENV] = `http://127.0.0.1:${this._port}`;
  }

  /**
   * Set CDP env vars on process.env so any child process inheriting the
   * current environment picks them up (e.g. when opencode engine is
   * spawned after Chrome is ready).
   */
  setProcessEnvVars(): void {
    process.env[CHROME_CDP_PORT_ENV] = String(this._port);
    process.env[CHROME_CDP_URL_ENV] = `http://127.0.0.1:${this._port}`;
  }

  /**
   * Graceful shutdown. Only kills Chrome instances WE spawned (tracks PID).
   * A pre-existing/reused Chrome is left untouched.
   */
  shutdown(): void {
    if (this._reused) {
      logger.info('[ManagedChrome] Reused pre-existing Chrome — not killing on shutdown');
      return;
    }
    this._killOwnedChrome();
    this._cleanupUserDataDir();
  }

  private _killOwnedChrome(): void {
    const child = this._childProcess;
    if (!child) return;
    const pid = child.pid;
    try {
      child.kill('SIGTERM');
      logger.info(`[ManagedChrome] Sent SIGTERM to Chrome PID ${pid}`);
    } catch (err) {
      logger.warn(`[ManagedChrome] Failed to SIGTERM Chrome PID ${pid}: ${String(err)}`);
    }
    this._childProcess = null;
    this._ready = false;
  }

  private _cleanupUserDataDir(): void {
    if (!this._userDataDir) return;
    try {
      rmSync(this._userDataDir, { recursive: true, force: true });
      logger.info(`[ManagedChrome] Cleaned up temp user-data-dir: ${this._userDataDir}`);
    } catch (err) {
      logger.warn(`[ManagedChrome] Failed to clean up temp dir: ${String(err)}`);
    }
    this._userDataDir = null;
  }
}

// ---------------------------------------------------------------------------
// Singleton instance (exported for server.ts wiring)
// ---------------------------------------------------------------------------

export const managedChromeService = new ManagedChromeService(CHROME_CDP_PORT);
