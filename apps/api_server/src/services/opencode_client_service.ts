import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { promisify } from 'util';
import type { OpencodeClient, Event } from '@opencode-ai/sdk';
import { logger } from '../utils/logger';
import { OpencodeAuthStore } from './opencode_auth_store';
import { AppError } from '../errors/app_error';
import {
  CURATED_MCP_SERVERS,
  type CuratedMcpServer,
  type CuratedTokenProvider,
} from '../config/curated_mcp_servers';
import { ensureGeminiProjectConfig } from './gemini_project_config';
import { expandMcpAllowlist } from './mcp_allowlist_expander';
import { capMcpAllowlistForProvider } from './gemini_tool_cap';
import {
  ensureOmlxProviderConfig,
  detectAndUnloadCompetingOllamaModel,
} from './local_omlx_provider';

/**
 * MCP-6 — resolves a FRESH OAuth access token for a curated server's
 * `tokenProvider`. Implementations reuse Rhythm's existing
 * `ensureFresh*Account` refresh path (see opencode_mcp_routes.ts wiring).
 * Returns the access token string, or `null` when no account is connected
 * (no row / no token) so the bridge can SKIP that server cleanly.
 */
export type CuratedTokenResolver = (
  provider: CuratedTokenProvider,
) => Promise<string | null>;

/**
 * Run a command and capture stdout. `execFile` is required lazily (not bound at
 * module load) so importers that partially-mock `child_process` in tests —
 * e.g. one that only exports `execSync` — do not crash at import time on a
 * missing `execFile` export (#655).
 */
async function runCommand(file: string, args: string[]): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFile } = require('child_process') as typeof import('child_process');
  const { stdout } = await promisify(execFile)(file, args);
  return stdout;
}

/**
 * #856 — 'reloading' is a transient state entered by
 * {@link OpencodeClientService.reloadCredentials} while the engine is being
 * bounced after a provider auth change (e.g. a Claude account switch writes
 * fresh tokens to auth.json). Surfaced via `statusMessage` so callers show a
 * brief "reloading credentials…" message instead of opaque 401s during the
 * bounce window.
 */
type EngineStatus = 'uninitialized' | 'ready' | 'error' | 'reloading';

/**
 * Providers that are usable over loopback without an auth-store credential.
 * `omlx` (#868) is the Apple-Silicon-native oMLX provider — optional/feature-
 * flagged, but once its opencode.json entry exists it needs no OAuth/API-key
 * credential either, exactly like `ollama`.
 */
const KEYLESS_LOCAL_PROVIDER_IDS = new Set(['ollama', 'omlx']);

/**
 * The fixed TCP port the bundled opencode engine listens on. The SDK's
 * `createOpencode()` spawns `opencode serve` on this port by default, and the
 * Flutter client + ws_gateway assume it is fixed (see #655 — making it dynamic
 * would ripple through more surfaces than the kill-stale approach).
 */
export const OPENCODE_ENGINE_PORT = 4096;

/**
 * Injectable boundary for the OS calls that {@link reclaimStalePortForOpencode}
 * makes. Real implementations shell out to `lsof` / `ps` / `kill`; tests pass
 * doubles so the stale-detection logic can be exercised without real processes.
 */
export interface StalePortDeps {
  /** `lsof -iTCP:<port> -sTCP:LISTEN -t` — the PID listening on `port`, or null. */
  lookupPidOnPort(port: number): Promise<number | null>;
  /** `ps -o command= -p <pid>` — the full command line of `pid`, or '' if gone. */
  getCommandForPid(pid: number): Promise<string>;
  /** Send `signal` to `pid` (process.kill). */
  killPid(pid: number, signal: string): Promise<void>;
  /** True when nothing is listening on `port`. */
  isPortFree(port: number): Promise<boolean>;
  /** Sleep `ms` milliseconds (injected so tests don't actually wait). */
  waitMs(ms: number): Promise<void>;
}

export interface ReclaimResult {
  /** True when a stale opencode process was found and killed. */
  reclaimed: boolean;
  /** The PID that was reclaimed, when `reclaimed` is true. */
  killedPid?: number;
  /** Set on a non-fatal note (e.g. port freed but kill races); usually unset. */
  error?: string;
}

/**
 * Heuristic: is `command` a stale `opencode serve` process for our engine?
 * Matches the opencode binary plus a `serve` subcommand. The port match is
 * intentionally loose (the orphan may print `--port 4096`, `--port=4096`, or
 * carry the port elsewhere) — we only act when the command is unmistakably
 * an opencode server, never a foreign process.
 */
function isStaleOpencodeCommand(command: string, port: number): boolean {
  const cmd = command.toLowerCase();
  if (!cmd.includes('opencode')) return false;
  // `opencode serve` is how the SDK spawns the engine. Guard against matching
  // e.g. an editor that merely has "opencode" in its path by requiring `serve`.
  if (!cmd.includes('serve')) return false;
  // If the command mentions a port at all, it must be ours; if it mentions no
  // port, still treat an `opencode serve` as ours (it defaults to our port).
  const portMatch = cmd.match(/--port[ =](\d+)/);
  if (portMatch) return Number(portMatch[1]) === port;
  return true;
}

const defaultStalePortDeps: StalePortDeps = {
  async lookupPidOnPort(port) {
    try {
      const stdout = await runCommand('lsof', [
        `-iTCP:${port}`,
        '-sTCP:LISTEN',
        '-t',
      ]);
      const pid = parseInt(stdout.trim().split(/\s+/)[0] ?? '', 10);
      return Number.isInteger(pid) ? pid : null;
    } catch {
      // lsof exits non-zero when nothing is listening — treat as free port.
      return null;
    }
  },
  async getCommandForPid(pid) {
    try {
      const stdout = await runCommand('ps', ['-o', 'command=', '-p', String(pid)]);
      return stdout.trim();
    } catch {
      return '';
    }
  },
  async killPid(pid, signal) {
    try {
      process.kill(pid, signal as NodeJS.Signals);
    } catch {
      // ESRCH (already gone) is fine — the goal is a free port.
    }
  },
  async isPortFree(port) {
    const pid = await this.lookupPidOnPort(port);
    return pid === null;
  },
  async waitMs(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  },
};

/**
 * #655 — Defense-in-depth before spawning the opencode engine on a fixed port.
 *
 * If a stale `opencode serve` orphan (e.g. reparented to launchd after the
 * api_server was SIGKILLed / Force-Quit) is squatting on `port`, the SDK's
 * fresh spawn fails to bind and exits code 1 ("engine not ready"). This probes
 * the port and, when the holder is unmistakably a stale opencode server,
 * SIGTERMs it (then SIGKILLs after a short grace) and waits for the port to
 * free. If the holder is a NON-opencode process it is left untouched and a
 * clear error is thrown naming the occupying PID + command.
 *
 * @throws Error when a non-opencode process holds the port, or when a stale
 *   opencode process could not be reclaimed within the grace window.
 */
export async function reclaimStalePortForOpencode(
  port: number = OPENCODE_ENGINE_PORT,
  deps: StalePortDeps = defaultStalePortDeps,
): Promise<ReclaimResult> {
  const pid = await deps.lookupPidOnPort(port);
  if (pid === null) {
    return { reclaimed: false };
  }

  const command = await deps.getCommandForPid(pid);

  if (!isStaleOpencodeCommand(command, port)) {
    throw new Error(
      `Port ${port} is held by a non-opencode process (PID ${pid}: ${command || '<unknown command>'}). ` +
        `Refusing to kill it. Free the port and relaunch, or stop the occupying process.`,
    );
  }

  logger.info(
    `[OpencodeClientService] reclaiming stale opencode orphan on :${port} (PID ${pid})`,
  );

  // SIGTERM, then SIGKILL after a grace period, polling for the port to free.
  const signals: Array<NodeJS.Signals> = ['SIGTERM', 'SIGKILL'];
  for (const signal of signals) {
    await deps.killPid(pid, signal);
    // Poll up to ~1s for the port to free after each signal.
    for (let i = 0; i < 10; i++) {
      if (await deps.isPortFree(port)) {
        logger.info(
          `[OpencodeClientService] reclaimed :${port} from stale opencode PID ${pid} via ${signal}`,
        );
        return { reclaimed: true, killedPid: pid };
      }
      await deps.waitMs(100);
    }
  }

  // Final check after both signals + grace.
  if (await deps.isPortFree(port)) {
    return { reclaimed: true, killedPid: pid };
  }

  throw new Error(
    `Failed to reclaim port ${port} from stale opencode process (PID ${pid}) after SIGTERM and SIGKILL.`,
  );
}

/**
 * The exact `@ajhochy/rhythm-mcp-server` version this build of Rhythm was
 * shipped/tested against, read once from `apps/mcp_server/package.json`.
 * Single source of truth for the pinned-fallback command (issue #814) — bump
 * `apps/mcp_server/package.json`'s `version` and this pin tracks it
 * automatically; no second place to edit.
 *
 * Resolution order mirrors {@link augmentPathForOpencode}'s bundled-binary
 * probe: try the compiled/dev-module-relative candidate paths, using the
 * first one whose package.json actually exists. `__dirname/../../../mcp_server`
 * resolves correctly from BOTH `apps/api_server/dist/services` (bundled
 * release) and `apps/api_server/src/services` (dev via tsx/vitest, no
 * dist/), because `dist`/`src` and `mcp_server` are siblings under `apps/`.
 * A flattened `dist/` (two levels up) is probed as a defensive fallback.
 * Returns `undefined` (never throws) when no package.json can be found or
 * parsed, so callers can fall back to a bare, unpinned spec rather than
 * crash (see {@link resolveRhythmMcpCommand}).
 */
export function readRhythmMcpServerVersion(): string | undefined {
  const candidates = [
    // dist/services or src/services → apps/mcp_server (dev + bundled release)
    join(__dirname, '..', '..', '..', 'mcp_server', 'package.json'),
    // Flattened dist/ variant
    join(__dirname, '..', '..', 'mcp_server', 'package.json'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
        version?: unknown;
      };
      if (typeof parsed.version === 'string' && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // Fall through to the next candidate / the undefined fallback below.
    }
  }
  return undefined;
}

/**
 * Issue #814 — resolve the argv used to launch the rhythm MCP server, never a
 * bare unversioned package spec.
 *
 * Problem: `npx -y @ajhochy/rhythm-mcp-server` (no version) lets a STALE
 * GLOBAL install of the package shadow the version the app was built/tested
 * against — observed in the wild (a stale global 0.6.0 shadowed a published
 * 0.6.1). `npx` also requires network access at launch time, which is fragile
 * offline.
 *
 * Resolution order (first match wins), mirroring
 * {@link augmentPathForOpencode}'s bundled-vs-PATH precedence:
 *   1. `RHYTHM_MCP_SERVER_BIN` dev override — an explicit absolute path to a
 *      built `dist/index.js` entrypoint, for pointing at a locally-built
 *      mcp_server without a release build (parity with
 *      RHYTHM_OPENCODE_BIN[_DIR] for the fork engine).
 *   2. A BUNDLED mcp_server payload shipped inside the app bundle
 *      (`Contents/Resources/mcp_server/dist/index.js`, sibling of the
 *      bundled `api_server` and `opencode_bin` — see desktop_release.yml's
 *      "Bundle rhythm MCP server into app" step). Launched by absolute path
 *      via `node` — no npx, no global, no network.
 *   3. FALLBACK (dev, or a release predating the bundling step): an EXPLICIT
 *      PINNED version spec `@ajhochy/rhythm-mcp-server@<version>` sourced
 *      from {@link readRhythmMcpServerVersion}, so a stale global install can
 *      never shadow it. Only when the version cannot be resolved at all do
 *      we fall back to the historical bare spec (logged as a WARN — this
 *      should not happen in a checked-out monorepo).
 */
export function resolveRhythmMcpCommand(): string[] {
  const devBinPath = process.env.RHYTHM_MCP_SERVER_BIN?.trim();
  if (devBinPath) {
    if (existsSync(devBinPath)) {
      logger.info(
        `[OpencodeClientService] RHYTHM_MCP_SERVER_BIN override active — rhythm MCP will launch from ${devBinPath}`,
      );
      return ['node', devBinPath];
    }
    logger.warn(
      `[WARN] RHYTHM_MCP_SERVER_BIN="${devBinPath}" does not exist — ignoring override`,
    );
  }

  const candidateBundledEntrypoints = [
    // Bundled release layout: Resources/api_server/dist/services → Resources/mcp_server
    join(__dirname, '..', '..', '..', 'mcp_server', 'dist', 'index.js'),
    // Flattened dist/ variant
    join(__dirname, '..', '..', 'mcp_server', 'dist', 'index.js'),
  ];
  const bundledEntrypoint = candidateBundledEntrypoints.find((p) =>
    existsSync(p),
  );
  if (bundledEntrypoint) {
    return ['node', bundledEntrypoint];
  }

  const pinnedVersion = readRhythmMcpServerVersion();
  if (pinnedVersion) {
    return ['npx', '-y', `@ajhochy/rhythm-mcp-server@${pinnedVersion}`];
  }

  logger.warn(
    '[WARN] rhythm MCP: no bundled payload and no resolvable mcp_server/package.json version — ' +
      'falling back to an unpinned npx spec, which a stale global install can shadow',
  );
  return ['npx', '-y', '@ajhochy/rhythm-mcp-server'];
}

/**
 * Directories the SDK's `cross-spawn("opencode")` may need on PATH. GUI-spawned
 * .app children on macOS only inherit `/usr/bin:/bin:/usr/sbin:/sbin` — none of
 * which contain the opencode binary. Idempotent: prepends each dir at most once.
 *
 * When running inside the bundled .app the Rhythm fork binary lives at
 *   Contents/Resources/opencode_bin/opencode
 * THIS module is compiled to
 *   Contents/Resources/api_server/dist/services/opencode_client_service.js
 * so __dirname resolves to …/api_server/dist/services and the opencode_bin dir
 * is THREE levels up from there (…/dist/services → …/Resources). To stay robust
 * against future changes to the compiled-output nesting we probe the known
 * candidate depths and use the first one whose `opencode` binary actually
 * exists. When the bundled binary is present its directory is prepended FIRST
 * so the forked engine always shadows any stock opencode on PATH. In local
 * `flutter run` / `npm run dev` development none of the candidates exist; in
 * that case a WARN is logged and the existing PATH fallbacks are used as-is.
 *
 * Issue #855 finding: in day-to-day dev (`npm run dev` via tsx, no `dist/`),
 * NEITHER candidate above ever exists, so every dev session silently falls
 * back to whatever `opencode` is on the ambient PATH — almost always the
 * stock upstream binary a developer installed globally (e.g. `~/.opencode/bin`
 * from the official installer), which carries NONE of the Rhythm fork's
 * per-session MCP/skill allowlist patches. The api_server-side allowlist push
 * (ws_gateway → opencode_client_service.updateSessionAllowlist) can be
 * perfectly correct and still appear to do nothing against a stock engine,
 * because stock `resolveTools` has no `filterMcpToolsByAllowlist` gate at all —
 * every MCP tool schema is injected regardless of what session state says.
 * This is a `find the right binary on PATH` gap, not a scoping-logic bug.
 *
 * `RHYTHM_OPENCODE_BIN_DIR` (a directory containing an `opencode` executable)
 * or `RHYTHM_OPENCODE_BIN` (a full path to the executable itself) let a
 * developer point a plain `npm run dev` / `flutter run` session at a locally
 * built fork binary (`cd apps/opencode_fork/packages/opencode && bun run build
 * --single`, see docs/ai/testing-guide.md "Running the fork engine in dev")
 * WITHOUT needing a signed release build or manually exporting PATH in every
 * new terminal. When set, the resolved directory is prepended FIRST — ahead of
 * even the bundled-release opencode_bin dir — so an explicit dev override
 * always wins. Unset (the default) leaves today's behavior byte-for-byte
 * unchanged.
 */
export function augmentPathForOpencode(): void {
  const extras: string[] = [];

  // Issue #855 — highest-priority override: an explicit dev pointer at a
  // locally built fork binary. Checked BEFORE the bundled-release path so a
  // developer's override always wins, including inside a signed dev build.
  const devBinPath = process.env.RHYTHM_OPENCODE_BIN?.trim();
  const devBinDirEnv = process.env.RHYTHM_OPENCODE_BIN_DIR?.trim();
  let devBinDir: string | undefined;
  if (devBinPath) {
    if (existsSync(devBinPath)) {
      devBinDir = join(devBinPath, '..');
    } else {
      logger.warn(
        `[WARN] RHYTHM_OPENCODE_BIN="${devBinPath}" does not exist — ignoring override`,
      );
    }
  } else if (devBinDirEnv) {
    if (existsSync(join(devBinDirEnv, 'opencode'))) {
      devBinDir = devBinDirEnv;
    } else {
      logger.warn(
        `[WARN] RHYTHM_OPENCODE_BIN_DIR="${devBinDirEnv}" has no "opencode" executable — ignoring override`,
      );
    }
  }
  if (devBinDir) {
    extras.push(devBinDir);
    logger.info(
      `[OpencodeClientService] RHYTHM_OPENCODE_BIN${devBinPath ? '' : '_DIR'} override active — engine will spawn from ${devBinDir}`,
    );
  }

  // Probe candidate locations of the bundled opencode_bin dir relative to the
  // compiled module. dist/services (bundle today) is three levels up; a
  // flattened dist/ would be two — pick whichever actually holds the binary.
  const candidateBinDirs = [
    join(__dirname, '..', '..', '..', 'opencode_bin'), // dist/services → Resources
    join(__dirname, '..', '..', 'opencode_bin'), // dist          → Resources
  ];
  const bundledBinDir = candidateBinDirs.find((d) =>
    existsSync(join(d, 'opencode')),
  );

  if (bundledBinDir) {
    extras.push(bundledBinDir);
  } else if (!devBinDir) {
    logger.warn(
      `[WARN] bundled opencode fork not found near ${__dirname}; falling back to PATH opencode (patch may be inactive)`,
    );
  }

  extras.push(
    join(homedir(), '.opencode', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  );

  const current = (process.env.PATH ?? '').split(':');
  const missing = extras.filter((d) => !current.includes(d));
  if (missing.length > 0) {
    process.env.PATH = [...missing, ...current].filter(Boolean).join(':');
  }

  // Issue #855 — unambiguous startup signal for which engine will actually be
  // spawned and whether the fork's scoping patches are expected to be active.
  // Read this log any time MCP allowlist scoping seems inactive: if it says
  // "stock PATH — scoping inactive", the fix is to build the fork and set
  // RHYTHM_OPENCODE_BIN[_DIR], not to re-audit the allowlist push logic.
  if (devBinDir) {
    logger.info(
      `[OpencodeClientService] engine: ${join(devBinDir, 'opencode')} (dev override — fork patches expected active)`,
    );
  } else if (bundledBinDir) {
    logger.info(
      `[OpencodeClientService] engine: ${join(bundledBinDir, 'opencode')} (bundled fork build — fork patches expected active)`,
    );
  } else {
    logger.info(
      `[OpencodeClientService] engine: opencode resolved from PATH (stock PATH — scoping inactive unless RHYTHM_OPENCODE_BIN[_DIR] is set)`,
    );
  }
}

type OpencodeServerHandle = { url: string; close(): void };

export class OpencodeClientService {
  private status: EngineStatus = 'uninitialized';
  private client: OpencodeClient | null = null;
  private server: OpencodeServerHandle | null = null;
  private error: Error | null = null;
  private authStore = new OpencodeAuthStore();
  /** Set to true by the shutdown handler before dispose() is called. */
  private _shuttingDown = false;

  /**
   * Test-only seam (#765). The real SDK client is normally created inside
   * {@link initialize} via a runtime `import('@opencode-ai/sdk')` that vitest
   * cannot intercept (the import is built through `new Function` to dodge the
   * CJS transformer). To exercise the REAL {@link createSession} body — and
   * therefore the real `expandMcpAllowlist` allowlist that goes on the wire —
   * against a faithful fake SDK transport, tests inject a stand-in client and
   * mark the engine ready. Only the network boundary (`session.create`) is
   * faked; the scope-derivation logic under test runs unchanged.
   *
   * Never called in production. Keep this the ONLY way tests reach `this.client`.
   */
  __setTestClient(client: OpencodeClient): void {
    this.client = client;
    this.status = 'ready';
    this.error = null;
  }

  /**
   * #723 — Names of MCP servers removed in this engine process but still
   * reported by the running engine's `mcp.status()` from its in-memory state
   * (the engine only drops them on restart). `listMcp()` filters these out so
   * a removed server's row disappears immediately — config (opencode.json) is
   * the source of truth for presence. Re-adding a server (addMcp /
   * ensure*Mcp* persistence) clears its name from this set so it reappears.
   */
  private _removedPendingRestart = new Set<string>();

  /** #723 — record a server removed-but-still-reported-by-engine. */
  private markMcpRemoved(name: string): void {
    this._removedPendingRestart.add(name);
  }

  /**
   * #723 — clear a server from the removed-pending-restart set (it has been
   * (re-)persisted, so it should surface again). No-op when not present.
   */
  private markMcpPresent(name: string): void {
    this._removedPendingRestart.delete(name);
  }

  get isReady(): boolean {
    return this.status === 'ready';
  }

  /**
   * Indirection around `this.status` used where TypeScript's control-flow
   * narrowing would otherwise (incorrectly) hold a property read to a
   * literal type assigned earlier in the same method, across intervening
   * calls that reassign it (e.g. {@link reloadCredentials}'s
   * `this.status = 'reloading'` → `this.dispose()` → `this.initialize()`
   * sequence). Going through a method call forces a fresh read.
   */
  private currentStatusForLogging(): EngineStatus {
    return this.status;
  }

  /**
   * Ensure the engine is ready, auto-reinitializing if it was previously
   * disposed or never initialized. Returns true once ready, false if
   * initialization fails or if the engine is in intentional shutdown.
   *
   * Safe to call during normal operation (no-op when already ready).
   * During shutdown (dispose called by the shutdown handler), the
   * `_shuttingDown` flag prevents wasteful re-initialization.
   */
  async ensureReady(): Promise<boolean> {
    const currentStatus = this.status;
    if (currentStatus === 'ready') return true;
    if (this._shuttingDown) {
      logger.info('[WARN] [OpencodeClientService] ensureReady called during shutdown — skipping');
      return false;
    }
    logger.info(
      '[OpencodeClientService] ensureReady: status=%s — attempting re-initialization',
      this.status,
    );
    try {
      await this.initialize();
    } catch {
      return false;
    }
    // initialize() may have changed this.status — check again.
    return this.status === 'ready';
  }

  get statusMessage(): string {
    if (this.status === 'ready') return 'Opencode SDK ready';
    if (this.status === 'error')
      return `Opencode SDK error: ${this.error?.message}`;
    // #856 — surfaced during reloadCredentials()'s dispose+reinit bounce so
    // callers show a brief, honest status instead of opaque 401s.
    if (this.status === 'reloading') return 'Reloading credentials…';
    return 'Opencode SDK not initialized';
  }

  async initialize(config?: { directory?: string }): Promise<void> {
    // If already ready, skip (idempotent). If already initializing, wait.
    if (this.status === 'ready') return;
    if (this._initializing) {
      // Wait for the in-flight initialization to complete.
      await this._initPromise;
      return;
    }
    this._initializing = true;
    this._initPromise = this._initializeImpl(config);
    try {
      await this._initPromise;
    } finally {
      this._initializing = false;
    }
  }
  private _initializing = false;
  private _initPromise: Promise<void> | null = null;

  /**
   * #746 — Timestamp (ms since epoch) when _initializeImpl completed
   * successfully. Exported via engineReadyAt() for the curator throttle guard.
   */
  private _engineReadyAt: number | null = null;

  /**
   * #746 — Returns the epoch-ms timestamp when the engine became ready, or
   * null if it has not yet initialized. Used by queueSkillExtraction to skip
   * curator work during the warm-up window after cold launch.
   */
  get engineReadyAt(): number | null {
    return this._engineReadyAt;
  }

  private async _initializeImpl(config?: { directory?: string }): Promise<void> {
    const t0 = Date.now();
    try {
      // Phase 1: augment PATH so the bundled opencode binary is discoverable.
      const t1 = Date.now();
      augmentPathForOpencode();
      logger.info(`[Opencode][timing] augmentPath took ${Date.now() - t1}ms`);

      // Phase 2: dynamic import of the ESM-only SDK.
      // Dynamic import — SDK is ESM-only, api_server uses CommonJS.
      // TS with module:commonjs rewrites `import()` to `require()`, which
      // fails on ESM-only packages. The `Function` wrapper hides the call
      // from the TS transformer so Node executes a real dynamic import.
      const t2 = Date.now();
      const dynamicImport = new Function('s', 'return import(s)') as (
        s: string,
      ) => Promise<unknown>;
      const mod = (await dynamicImport('@opencode-ai/sdk')) as {
        createOpencode: (opts?: Record<string, unknown>) => Promise<{
          client: OpencodeClient;
          server: OpencodeServerHandle;
        }>;
        createOpencodeClient: (config?: {
          baseUrl?: string;
          directory?: string;
        }) => OpencodeClient;
      };
      logger.info(`[Opencode][timing] SDK import took ${Date.now() - t2}ms`);

      // Phase 3: ensure Gemini Code Assist projectId is on disk in opencode.json
      // BEFORE createOpencode() spawns the engine — the opencode-gemini-auth
      // plugin reads provider.google.options.projectId at provider-registration
      // time, so it must be persisted first or the google provider won't
      // register for Workspace accounts. Never throws; logs and continues.
      const t3 = Date.now();
      const geminiCfg = ensureGeminiProjectConfig();
      logger.info(
        `[OpencodeClientService] ensured Gemini Code Assist projectId=${geminiCfg.projectId} (changed=${geminiCfg.changed})`,
      );
      logger.info(`[Opencode][timing] geminiProjectConfig took ${Date.now() - t3}ms`);

      // Phase 3b (#868): ensure the OPTIONAL oMLX provider + constrained
      // `local` agent profile are on disk BEFORE createOpencode() spawns the
      // engine (same ordering reason as Phase 3 — the engine reads
      // opencode.json's `provider`/`agent` blocks at startup). No-ops
      // entirely unless RHYTHM_LOCAL_OMLX_ENABLED=true — cloud/default
      // profiles are unaffected either way. Never throws; logs and continues.
      const t3b = Date.now();
      const omlxCfg = ensureOmlxProviderConfig();
      if (omlxCfg.enabled) {
        logger.info(
          `[OpencodeClientService] ensured oMLX provider (${omlxCfg.providerId}/${omlxCfg.modelId}) + '${omlxCfg.agentId}' agent (changed=${omlxCfg.changed})`,
        );
        // #868 — a 32 GB Apple Silicon Mac can't hold both a large Ollama
        // model and the oMLX model in Metal memory at once. Detect + (best
        // effort) unload the configured competing Ollama model before the
        // engine spawns. Never throws / never blocks startup either way.
        const unloadResult = await detectAndUnloadCompetingOllamaModel();
        if (unloadResult.detected && !unloadResult.unloaded) {
          logger.warn(
            `[OpencodeClientService] oMLX enabled but Ollama model '${unloadResult.model}' is still loaded — run '${unloadResult.action}' to free Metal memory before using the local agent`,
          );
        }
      }
      logger.info(`[Opencode][timing] omlxProviderConfig took ${Date.now() - t3b}ms`);

      // Phase 4: reclaim stale port.
      // #655 — Before spawning, reclaim :4096 from a stale opencode orphan
      // (e.g. one reparented to launchd after a Force-Quit / SIGKILL). A bound
      // port makes the SDK's fresh spawn exit code 1 ("engine not ready"). A
      // non-opencode holder throws a clear error (caught below → status=error
      // with the occupying PID/command) instead of the opaque exit-code-1.
      const t4 = Date.now();
      await reclaimStalePortForOpencode();
      logger.info(`[Opencode][timing] reclaimStalePort took ${Date.now() - t4}ms`);

      // Phase 5: spawn the opencode engine and wait for readiness.
      // Use createOpencode which starts an in-process Opencode server.
      // `server.close()` is the only documented way to stop the spawned
      // opencode subprocess on :4096 — we MUST hold this handle for clean
      // shutdown (see dispose()).
      const t5 = Date.now();
      const { client, server } = await mod.createOpencode({});
      logger.info(`[Opencode][timing] createOpencode (engine spawn) took ${Date.now() - t5}ms`);

      this.client = client;
      this.server = server;
      this.status = 'ready';
      this.error = null;
      logger.info('[OpencodeClientService] SDK initialized');

      // Phase 6: restore persisted auth credentials.
      // auth.json is written by client.auth.set() from previous runs but
      // createOpencode() starts a clean server that doesn't auto-load it.
      const t6 = Date.now();
      await this.restoreAuth();
      logger.info(`[Opencode][timing] restoreAuth took ${Date.now() - t6}ms`);

      this._engineReadyAt = Date.now();
      logger.info(`[Opencode][timing] total _initializeImpl took ${Date.now() - t0}ms`);
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        '[OpencodeClientService] Failed to initialize:',
        this.error,
      );
    }
  }

  /**
   * Restore persisted auth credentials from auth.json into the fresh SDK
   * instance. createOpencode() starts a clean server that doesn't auto-load
   * the file — without this, session.create() returns "Unauthorized".
   */
  private async restoreAuth(): Promise<void> {
    const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
    if (!existsSync(authPath)) return;
    try {
      const raw = readFileSync(authPath, 'utf8');
      const parsed: Record<string, unknown> = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      let restored = 0;
      for (const [providerId, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry !== 'object') continue;
        const creds = entry as Record<string, unknown>;
        const type = creds.type;
        if (type === 'api' && typeof creds.key === 'string') {
          await this.setAuth(providerId, creds.key);
          restored++;
        } else if (type === 'oauth') {
          const access = creds.access;
          const refresh = creds.refresh;
          const expires = creds.expires;
          if (typeof access === 'string' && typeof refresh === 'string' && typeof expires === 'number') {
            await this.setOAuthCredentials(providerId, { access, refresh, expires });
            restored++;
          }
        }
      }
      if (restored > 0) {
        logger.info(`[OpencodeClientService] restored auth for ${restored} provider(s)`);
      }
    } catch (err) {
      logger.error('[OpencodeClientService] restoreAuth failed:', err);
    }
  }

  /** List all user-defined commands from the SDK (for the slash-command popover). */
  async listCommands(): Promise<Array<{ name: string; description?: string }>> {
    if (!this.client) return [];
    try {
      const raw = await this.client.command.list();
      const commands = raw.data ?? [];
      return commands.map((c) => ({ name: c.name, description: c.description }));
    } catch (err) {
      logger.warn('[OpencodeClientService] listCommands failed:', err);
      return [];
    }
  }

  /** List all provider IDs available in the SDK catalog (not auth state). */
  async listProviders(): Promise<string[]> {
    if (!this.client) return [];
    try {
      const raw = await this.client.config.providers();
      const providers = raw.data?.providers ?? [];
      return providers.map((p) => p.id);
    } catch (err) {
      logger.error('[OpencodeClientService] listProviders failed:', err);
      return [];
    }
  }

  /** Returns provider IDs that are actually authed (per auth.json). */
  async listAuthedProviders(): Promise<string[]> {
    const connected = new Set(this.authStore.listAuthedProviders());
    if (!this.client) return [...connected];

    try {
      const raw = await this.client.config.providers();
      for (const provider of raw.data?.providers ?? []) {
        if (KEYLESS_LOCAL_PROVIDER_IDS.has(provider.id)) {
          connected.add(provider.id);
        }
      }
    } catch (err) {
      logger.warn(
        '[OpencodeClientService] keyless local provider discovery failed:',
        err,
      );
    }
    return [...connected];
  }

  /** Get available models for a provider */
  async listModels(
    providerId: string,
  ): Promise<Array<{ id: string; name?: string; contextLimit?: number }>> {
    if (!this.client) return [];
    try {
      const raw = await this.client.config.providers();
      const providers = raw.data?.providers ?? [];
      const provider = providers.find((p) => p.id === providerId);
      const models = provider?.models;
      if (Array.isArray(models)) {
        return models.map((m) => ({
          id: m.id,
          name: m.name,
          ...(m.limit?.context != null ? { contextLimit: m.limit.context } : {}),
        }));
      }
      if (models && typeof models === 'object') {
        return Object.entries(models).map(([id, model]) => ({
          id: model.id ?? id,
          name: model.name,
          ...(model.limit?.context != null ? { contextLimit: model.limit.context } : {}),
        }));
      }
      return [];
    } catch (err) {
      logger.error(`[OpencodeClientService] listModels failed for ${providerId}:`, err);
      return [];
    }
  }

  /** Set auth credentials for a provider via API key */
  async setAuth(providerId: string, apiKey: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      const raw = await this.client.auth.set({
        path: { id: providerId },
        body: { type: 'api', key: apiKey },
      });
      return raw.data === true;
    } catch (err) {
      logger.error(`[OpencodeClientService] setAuth failed for ${providerId}:`, err);
      return false;
    }
  }

  /**
   * Create a new Opencode session with an optional working directory.
   *
   * C1 — MCP role gating (init-time):
   * The opencode SDK's session.create() accepts only { title, directory } — there
   * is no per-session tool allowlist parameter in the current SDK version (v1.14.x).
   * When `mcpRoleConfig` is provided the resolved allowlist is PASSED THROUGH as a
   * parameter here so callers (controller, tests) can spy on it; the SDK call itself
   * does not forward it (documented limitation). The allowlist is persisted on the
   * agent_sessions row and the WS gateway uses it as the init-time scope gate.
   *
   * Fallback note (per issue C1 "Ambiguity flag for reviewer"):
   *   The SDK cannot accept a per-session allowlist at init time. We use the
   *   "store on session row + WS gateway enforcement" path rather than writing a
   *   per-session .mcp.json file (which would scope to the cwd directory, not to
   *   the session, and would affect all concurrent sessions sharing that cwd).
   *
   * #884 — Gemini function-declaration cap:
   *   When `providerId` is `'google'`, the expanded allowlist is passed through
   *   {@link capMcpAllowlistForProvider} before being placed on the body. This
   *   is a no-op for every other provider (including when `providerId` is
   *   omitted, e.g. a caller that hasn't resolved a model yet) — see
   *   `gemini_tool_cap.ts` for the trim policy and cap constants.
   */
  async createSession(
    title: string,
    directory?: string,
    mcpRoleConfig?: {
      role: string;
      mcpServers: Record<string, unknown>;
      allowedToolsJson: string;
    },
    // #775 (skill-scope): permitted skill NAMES for this session. When provided
    // (non-empty), the fork scopes the model's available skills to this set —
    // the skill analogue of mcpRoleConfig. Undefined/empty = unrestricted.
    skillAllowlist?: string[],
    // #884 — resolved provider ID for this session's turn, when known at
    // create time (e.g. agent_runner resolves the model before calling
    // createSession). Undefined means "provider not yet known" — the cap is
    // skipped (same as any non-google provider) and can still be applied
    // later via `updateSessionAllowlist` once resolved.
    providerId?: string | null,
  ): Promise<{ id: string } | null> {
    if (!this.client) return null;

    // mcp-scope-04: expand the McpRoleConfig into a flat { servers[], tools[] }
    // allowlist and pass it as `mcpAllowlist` on the session.create POST body.
    // The forked opencode engine (apps/opencode_fork) reads this field to scope
    // MCP tools to only the profile's allowed set for this session.
    //
    // SDK-type decision (R3): the hand-written @types/opencode-ai-sdk.d.ts does
    // NOT declare this field (extending it risks false-green drift — see postmortem
    // 2026-06-13). We pass it via an untyped body cast.
    // TODO: once the upstream SDK supports per-session allowlists natively, remove
    //       this cast and update the d.ts instead.
    let mcpAllowlist: { servers: string[]; tools: string[] } | undefined;
    if (mcpRoleConfig) {
      try {
        mcpAllowlist = expandMcpAllowlist(mcpRoleConfig);
        // #884 — trim to Gemini's function-declaration cap when this session's
        // turn is routed to `google`. No-op for every other provider.
        const capResult = capMcpAllowlistForProvider(mcpAllowlist, providerId);
        mcpAllowlist = capResult.allowlist;
        if (capResult.trimmed) {
          logger.warn(capResult.warning ?? '[GeminiToolCap] allowlist trimmed');
        }
        logger.info(
          '[OpencodeClientService] createSession: mcpRole=%s allowlist servers=%s tools=%s',
          mcpRoleConfig.role,
          mcpAllowlist.servers.join(',') || '(none)',
          mcpAllowlist.tools.join(',') || '(none)',
        );
      } catch (expandErr) {
        logger.warn(
          '[OpencodeClientService] createSession: expandMcpAllowlist failed for role=%s — omitting mcpAllowlist',
          mcpRoleConfig.role,
          expandErr,
        );
      }
    }

    try {
      const body: Record<string, unknown> = { title };
      if (mcpAllowlist !== undefined) {
        body.mcpAllowlist = mcpAllowlist;
      }
      // #775 (skill-scope): pass the per-session skill allowlist on the create body.
      // The fork reads `skillAllowlist.skills` to scope the model's available skills.
      if (skillAllowlist !== undefined && skillAllowlist.length > 0) {
        body.skillAllowlist = { skills: skillAllowlist };
        logger.info(
          '[OpencodeClientService] createSession: skillAllowlist skills=%s',
          skillAllowlist.join(',') || '(none)',
        );
      }
      const raw = await (this.client.session.create as (opts: {
        body: Record<string, unknown>;
        query?: { directory?: string };
      }) => Promise<{ data?: { id?: string }; error?: unknown }>)({
        body,
        ...(directory ? { query: { directory } } : {}),
      });
      const id = raw.data?.id;
      if (!id) {
        logger.error(
          '[OpencodeClientService] createSession failed: SDK returned %s %s',
          raw.error ? `error="${JSON.stringify(raw.error)}"` : 'no id',
          raw.data ? `data=${JSON.stringify(raw.data).slice(0, 200)}` : '',
        );
      }
      return id ? { id } : null;
    } catch (err) {
      logger.error('[OpencodeClientService] createSession failed:', err);
      return null;
    }
  }

  /**
   * PATCH /session/:id with { mcpAllowlist: { servers, tools } }.
   * Updates the fork session's MCP allowlist so the next prompt uses it.
   * Called by ws_gateway when the per-turn agent drives scope on an existing session.
   *
   * Uses direct fetch rather than the SDK client because the SDK's generated body
   * type only includes `title` (generated before mcp-scope support was added), and
   * the fork's URL is known at this.baseUrl.
   *
   * Issue #855: this method takes the SAME `McpRoleConfig` shape createSession()
   * accepts and expands it via the SAME `expandMcpAllowlist` helper — NOT a raw
   * `servers: string[]` that a caller might derive by naively JSON.parsing
   * `mcpRoleConfig.allowedToolsJson`. That raw field is the UNEXPANDED profile
   * JSON and can be either a bare server-name array OR a tools-map object
   * (`{"canva":["tool1"]}`) depending on how the profile's allowed_mcps_json was
   * authored (see agent_profile_scope.ts `_buildMcpRoleConfig`). Parsing the
   * tools-map form and passing it straight through as `servers` sends the fork's
   * strict `McpAllowlist.servers: Schema.Array(Schema.String)` an OBJECT — the
   * PATCH fails schema validation, is swallowed as non-fatal by the caller, and
   * the session's mcpAllowlist is left `undefined` (full tool surface injected).
   * Centralizing on expandMcpAllowlist (already covered by
   * mcp_allowlist_expander.test.ts) guarantees this call site can never regress
   * to that wrong shape again, the same way createSession is protected today.
   *
   * #884 — when `providerId` is `'google'`, the expanded allowlist is trimmed
   * to Gemini's function-declaration cap via {@link capMcpAllowlistForProvider}
   * before being PATCHed. No-op for every other provider (including when
   * `providerId` is omitted).
   */
  async updateSessionAllowlist(
    sessionId: string,
    mcpRoleConfig: import('./agent_profile_scope').McpRoleConfig,
    providerId?: string | null,
  ): Promise<boolean> {
    try {
      let mcpAllowlist = expandMcpAllowlist(mcpRoleConfig);
      const capResult = capMcpAllowlistForProvider(mcpAllowlist, providerId);
      mcpAllowlist = capResult.allowlist;
      if (capResult.trimmed) {
        logger.warn(capResult.warning ?? '[GeminiToolCap] allowlist trimmed');
      }
      const base = this.serverUrl;
      const res = await fetch(`${base}/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpAllowlist }),
      });
      if (!res.ok) {
        logger.warn('[OpencodeClientService] updateSessionAllowlist HTTP %s for session %s', res.status, sessionId);
        return false;
      }
      return true;
    } catch (err) {
      logger.error('[OpencodeClientService] updateSessionAllowlist failed:', err);
      return false;
    }
  }

  /**
   * #775 (skill-scope): PATCH /session/:id with { skillAllowlist: { skills } }.
   * Updates the fork session's skill allowlist so the next prompt scopes the
   * model's available skills to `skills`. Called by ws_gateway when the per-turn
   * agent drives scope on an existing session — the skill analogue of
   * {@link updateSessionAllowlist}.
   *
   * Passing an empty `skills` array clears the restriction (fork treats an
   * undefined/absent allowlist as unrestricted; an explicit empty list would
   * deny everything, so callers pass undefined-to-clear by not calling this).
   */
  async updateSessionSkillAllowlist(
    sessionId: string,
    skills: string[],
  ): Promise<boolean> {
    try {
      const base = this.serverUrl;
      const res = await fetch(`${base}/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillAllowlist: { skills } }),
      });
      if (!res.ok) {
        logger.warn(
          '[OpencodeClientService] updateSessionSkillAllowlist HTTP %s for session %s',
          res.status,
          sessionId,
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.error('[OpencodeClientService] updateSessionSkillAllowlist failed:', err);
      return false;
    }
  }

  /**
   * Unify-2 — list the skills the fork actually discovered, via its instance
   * `GET /skill` route. This is the single source of truth for the Flutter
   * skills picker and for agent_profile_sync's allowlist derivation, so stored
   * `allowed_skills_json` names are guaranteed to match what the fork enforces
   * (#775). `content` is stripped — the picker only needs name/description/location.
   *
   * Uses raw fetch because GET /skill is an experimental instance route the SDK
   * client does not generate. `directory` is optional; it defaults to the home
   * dir, which yields the directory-independent canonical set (home + config +
   * config.skills.paths). Returns [] when the engine is unavailable.
   */
  async listSkills(
    directory?: string,
  ): Promise<Array<{ name: string; description?: string; location: string }>> {
    const dir = directory ?? homedir();
    try {
      const base = this.serverUrl;
      const res = await fetch(`${base}/skill?directory=${encodeURIComponent(dir)}`);
      if (!res.ok) {
        logger.warn('[OpencodeClientService] listSkills HTTP %s', res.status);
        return [];
      }
      const data = (await res.json()) as Array<{
        name: string;
        description?: string;
        location: string;
      }>;
      return data.map((s) => ({ name: s.name, description: s.description, location: s.location }));
    } catch (err) {
      logger.error('[OpencodeClientService] listSkills failed:', err);
      return [];
    }
  }

  /**
   * #874/#875/#876 — same `GET /skill` call as {@link listSkills}, but keeps the
   * raw `content` field (the full SKILL.md text, frontmatter + body) that the
   * fork's `Skill.Info` schema already returns. `listSkills` strips it because
   * the picker/allowlist-derivation callers never needed it; the extended
   * frontmatter fields these issues add (required env vars, toolset visibility
   * conditions, python dependencies) are NOT parsed by the fork, so api_server
   * must read them out of this raw content itself (see skill_frontmatter.ts).
   * Returns [] when the engine is unavailable — same fail-safe posture as
   * {@link listSkills}.
   */
  async listSkillsWithContent(
    directory?: string,
  ): Promise<Array<{ name: string; description?: string; location: string; content: string }>> {
    const dir = directory ?? homedir();
    try {
      const base = this.serverUrl;
      const res = await fetch(`${base}/skill?directory=${encodeURIComponent(dir)}`);
      if (!res.ok) {
        logger.warn('[OpencodeClientService] listSkillsWithContent HTTP %s', res.status);
        return [];
      }
      const data = (await res.json()) as Array<{
        name: string;
        description?: string;
        location: string;
        content?: string;
      }>;
      return data.map((s) => ({
        name: s.name,
        description: s.description,
        location: s.location,
        content: s.content ?? '',
      }));
    } catch (err) {
      logger.error('[OpencodeClientService] listSkillsWithContent failed:', err);
      return [];
    }
  }

  /**
   * Unify-2 — force the fork to re-scan its skill directories (it memoizes
   * discovery per-instance, so a freshly-written SKILL.md is invisible until
   * this is called). Calls the fork's POST /skill/reload and returns the fresh
   * list. Call after any write into the Rhythm-managed dir.
   */
  async reloadSkills(
    directory?: string,
  ): Promise<Array<{ name: string; description?: string; location: string }>> {
    const dir = directory ?? homedir();
    // The one-time skill backfill materializes SKILL.md files during server
    // boot, before the engine has spawned/started listening. Reloading against
    // a not-yet-listening engine only produces ECONNREFUSED noise — and is
    // unnecessary, because the engine performs initial skill discovery when it
    // spawns, so anything written before that is picked up anyway. Reload is
    // only meaningful for writes AFTER the engine is already running.
    if (!this.isReady) {
      // Silent: called once per skill during the boot-time backfill before the
      // engine is up; a log line per skill would just be new noise. Comment
      // above documents why the skip is correct.
      return [];
    }
    try {
      const base = this.serverUrl;
      const res = await fetch(`${base}/skill/reload?directory=${encodeURIComponent(dir)}`, {
        method: 'POST',
      });
      if (!res.ok) {
        logger.warn('[OpencodeClientService] reloadSkills HTTP %s', res.status);
        return [];
      }
      const data = (await res.json()) as Array<{
        name: string;
        description?: string;
        location: string;
      }>;
      return data.map((s) => ({ name: s.name, description: s.description, location: s.location }));
    } catch (err) {
      logger.error('[OpencodeClientService] reloadSkills failed:', err);
      return [];
    }
  }

  /**
   * Send a prompt to a session and wait for the full response.
   * Used for synchronous user input via the WS gateway.
   */
  async prompt(
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
    directory?: string,
    opts?: Record<string, unknown>,
  ): Promise<{ info: import('@opencode-ai/sdk').Message; parts: Array<import('@opencode-ai/sdk').Part> } | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.session.prompt({
        path: { id: sessionId },
        body: {
          model,
          parts: [{ type: 'text', text }],
          ...(opts ?? {}),
        },
        ...(directory ? { query: { directory } } : {}),
      });
      if (raw.error || !raw.data) {
        logger.error(`[OpencodeClientService] prompt error for ${sessionId}:`, raw.error);
        return null;
      }
      return raw.data;
    } catch (err) {
      logger.error(`[OpencodeClientService] prompt failed for session ${sessionId}:`, err);
      return null;
    }
  }

  /**
   * Send a prompt to a session and return immediately.
   * Used for fire-and-forget prompts (e.g. initial prompt on session create).
   * Results arrive via the event stream.
   */
  /**
   * OPC-M4-1: Send a prompt to a session and return immediately.
   *
   * When `parts` is provided it must be a valid SDK parts array containing at
   * minimum one TextPartInput. FilePart entries (type:'file', mime, filename,
   * url: 'data:<mime>;base64,...') are forwarded verbatim to the SDK so
   * vision-capable models receive the image bytes directly.
   *
   * When `parts` is omitted, the legacy `[{ type: 'text', text }]` single-part
   * array is used (backwards-compatible).
   */
  async promptAsync(
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
    directory?: string,
    opts?: Record<string, unknown>,
    parts?: Array<import('@opencode-ai/sdk').PartInput>,
  ): Promise<boolean> {
    if (!this.client) return false;
    try {
      // OPC-M4-1: use the caller-supplied parts array when present; otherwise
      // fall back to a single text part so all existing call-sites are unchanged.
      const sdkParts: Array<import('@opencode-ai/sdk').PartInput> = parts && parts.length > 0
        ? parts
        : [{ type: 'text', text }];

      const raw = await this.client.session.promptAsync({
        path: { id: sessionId },
        body: {
          model,
          parts: sdkParts,
          ...(opts ?? {}),
        },
        ...(directory ? { query: { directory } } : {}),
      });
      if (raw.error) {
        logger.error(`[OpencodeClientService] promptAsync error for ${sessionId}:`, raw.error);
        return false;
      }
      // Guard: SDK silent no-op — the model may be unrecognized (e.g. OpenRouter
      // unknown-model) and the SDK returns {} with neither data nor error. Treat
      // as failure so callers don't think the prompt was enqueued (issue #632).
      //
      // #711 — for the anthropic/claude provider path, promptAsync returns HTTP
      // 204 No Content on success (void response). hey-api maps 204 to
      // { data: undefined, error: undefined } — identical to the OpenRouter
      // silent-no-op shape. Distinguish them via the HTTP status: 204 is a
      // genuine success; anything else with no data is a silent no-op.
      if (!raw.data) {
        // Access the underlying HTTP response when available (hey-api 'fields'
        // mode attaches it as `raw.response`). A 204 means the prompt was
        // accepted by the opencode server — not a silent no-op.
        const httpStatus = raw.response?.status;
        if (httpStatus === 204) {
          // Successful async enqueue — opencode will stream results via SSE.
          return true;
        }
        logger.warn(
          `[OpencodeClientService] promptAsync silent no-op for ${sessionId}: SDK returned neither data nor error (model may not be supported; HTTP status=${httpStatus ?? 'unknown'})`,
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.error(`[OpencodeClientService] promptAsync failed for session ${sessionId}:`, err);
      return false;
    }
  }

  /**
   * Subscribe to Opencode event stream. Returns null if not ready.
   *
   * IMPORTANT: opencode's /event SSE filters by ?directory= query param.
   * Without a directory, only server-level events (connected, heartbeat)
   * are delivered. Pass the session's cwd to receive session.* and
   * message.* events for that working directory.
   */
  async subscribeToEvents(
    directory?: string,
  ): Promise<{ stream: AsyncIterable<Event> } | null> {
    if (!this.client) return null;
    try {
      // event.subscribe does NOT return the { data, error } envelope — it
      // returns a ServerSentEventsResult = { stream } directly. Consume it as
      // such; treating it as an envelope (raw.data) always saw `undefined` and
      // dropped the stream ("No event stream available").
      const raw = await this.client.event.subscribe(
        directory ? { query: { directory } } : undefined,
      );
      if (!raw || !raw.stream) {
        logger.error(
          '[OpencodeClientService] subscribeToEvents: no stream in result',
        );
        return null;
      }
      return raw;
    } catch (err) {
      logger.error('[OpencodeClientService] subscribeToEvents failed:', err);
      return null;
    }
  }

  /**
   * Get OAuth authorization URL for a provider.
   * Returns the URL, method, and instructions on success.
   * Returns `{ error: string }` on failure so the caller can surface the SDK message.
   */
  async getOAuthUrl(
    providerId: string,
    methodIndex?: number,
    directory?: string,
  ): Promise<
    | { url: string; method: string; instructions: string }
    | { error: string }
    | null
  > {
    if (!this.client) return null;
    try {
      const raw = await this.client.provider.oauth.authorize({
        path: { id: providerId },
        body: { method: methodIndex ?? 0 },
        ...(directory ? { query: { directory } } : {}),
      });
      if (raw.error || !raw.data) {
        const errData = raw.error as { data?: { message?: string } } | undefined;
        const message = errData?.data?.message ?? 'Unknown SDK error';
        logger.error(
          `[OpencodeClientService] getOAuthUrl error for ${providerId}: ${message}`,
        );
        return { error: message };
      }
      return {
        url: raw.data.url,
        method: raw.data.method,
        instructions: raw.data.instructions,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[OpencodeClientService] getOAuthUrl threw for ${providerId}:`, err);
      return { error: message };
    }
  }

  /**
   * Handle OAuth callback for a provider with the authorization code.
   */
  async handleOAuthCallback(
    providerId: string,
    code: string,
    methodIndex?: number,
    directory?: string,
  ): Promise<boolean> {
    if (!this.client) return false;
    try {
      const raw = await this.client.provider.oauth.callback({
        path: { id: providerId },
        body: { method: methodIndex ?? 0, code },
        ...(directory ? { query: { directory } } : {}),
      });
      if (raw.error || raw.data !== true) {
        logger.error(
          `[OpencodeClientService] OAuth callback error for ${providerId}:`,
          raw.error,
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.error(`[OpencodeClientService] OAuth callback failed for ${providerId}:`, err);
      return false;
    }
  }

  /**
   * Respond to a pending permission request from the SDK.
   * `permissionId` is the ID from the `permission.asked` event.
   * Returns true when the SDK accepted the response, false otherwise
   * (including when the SDK version doesn't expose the permission endpoint).
   *
   * @deprecated Use {@link respondToPermission} instead.
   */
  async respondPermission(
    sessionId: string,
    permissionId: string,
    decision: 'accept' | 'deny',
    directory?: string,
  ): Promise<boolean> {
    if (!this.client) return false;
    try {
      // Map old 'accept'/'deny' to the SDK's 'once'/'reject' convention.
      const sdkDecision: 'once' | 'always' | 'reject' =
        decision === 'accept' ? 'once' : 'reject';
      await this.respondToPermission(
        sessionId,
        permissionId,
        sdkDecision,
        directory,
      );
      return true;
    } catch (err) {
      logger.error(`[OpencodeClientService] respondPermission failed for session ${sessionId}:`, err);
      return false;
    }
  }

  /** Abort a running session */
  async abortSession(sessionId: string, directory?: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      // opencode scopes sessions per directory — pass it so abort targets the
      // right session (other session.* calls pass directory too; omitting it
      // made Stop a silent no-op).
      const raw = await this.client.session.abort({
        path: { id: sessionId },
        ...(directory ? { query: { directory } } : {}),
      });
      if (raw.error) {
        logger.error(`[OpencodeClientService] abortSession error for ${sessionId}:`, raw.error);
        return false;
      }
      return true;
    } catch (err) {
      logger.error(`[OpencodeClientService] abortSession failed for ${sessionId}:`, err);
      return false;
    }
  }

  /**
   * Persist OAuth credentials for a provider (used by the credentials bridge
   * for Anthropic subscription tokens — the SDK's own OAuth flow throws for
   * anthropic, so the bridge is the only path).
   */
  async setOAuthCredentials(
    providerId: string,
    creds: { access: string; refresh: string; expires: number },
  ): Promise<boolean> {
    if (!this.client) return false;
    try {
      const raw = await this.client.auth.set({
        path: { id: providerId },
        body: {
          type: 'oauth',
          access: creds.access,
          refresh: creds.refresh,
          expires: creds.expires,
        },
      });
      return raw.data === true;
    } catch (err) {
      logger.error(`[OpencodeClientService] setOAuthCredentials failed for ${providerId}:`, err);
      return false;
    }
  }

  // ── Typed SDK wrappers (OPC-M1-1) ─────────────────────────────────────────
  //
  // Each wrapper below:
  //   1. Throws AppError.badRequest("engine not ready …") when `this.client`
  //      is null (SDK not initialized) — never silently resolves undefined.
  //   2. Calls the exact SDK method name from sdk.gen.ts v1.14.49 with the
  //      correct path/body shape from types.gen.ts.
  //   3. The SDK returns hey-api envelopes { data?, error? } — wrappers read
  //      .data directly — no re-cast required.
  //   4. On error envelope or thrown exception → throws (never swallows).
  // ─────────────────────────────────────────────────────────────────────────

  /** Throws the standard "engine not ready" error when the SDK is not initialized. */
  private requireClient(): import('@opencode-ai/sdk').OpencodeClient {
    if (!this.client) {
      throw new AppError(
        503,
        'ENGINE_NOT_READY',
        `Opencode engine not ready (${this.statusMessage})`,
      );
    }
    return this.client;
  }

  /**
   * GET /session/{id}/diff — typed replacement for the broken `diffSession`
   * duck-typed probe in agent_sessions_controller.ts.
   *
   * Throws on SDK error or exception — never swallows to [].
   */
  async getSessionDiff(
    sdkId: string,
  ): Promise<import('@opencode-ai/sdk').FileDiff[]> {
    const client = this.requireClient();
    const raw = await client.session.diff({
      path: { id: sdkId },
    });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `getSessionDiff failed for session ${sdkId}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data ?? [];
  }

  /**
   * POST /session/{id}/permissions/{permissionID} — typed replacement for the
   * duck-typed `session['permission'].respond` probe that could silently no-op.
   *
   * @throws Error with message containing "postSessionIdPermissionsPermissionId"
   *   when the SDK object does not expose this method.
   */
  async respondToPermission(
    sdkId: string,
    permissionId: string,
    decision: 'once' | 'always' | 'reject',
    directory?: string,
    _feedback?: string,
  ): Promise<void> {
    const client = this.requireClient();
    const methodName = 'postSessionIdPermissionsPermissionId';
    if (
      !(methodName in client) ||
      typeof client[methodName as keyof typeof client] !== 'function'
    ) {
      throw new Error(
        `SDK does not expose method '${methodName}' — cannot respond to permission request`,
      );
    }
    // opencode scopes permissions per directory — its own respond call passes
    // `directory`. Omitting it leaves the permission unresolved, so the gated
    // tool (write/edit) hangs even after the user clicks Allow (and in bypass
    // mode). Pass the session cwd.
    await client.postSessionIdPermissionsPermissionId({
      path: { id: sdkId, permissionID: permissionId },
      body: { response: decision },
      ...(directory ? { query: { directory } } : {}),
    });
  }

  // ── Question API (AskUserQuestion handshake) ──────────────────────────────
  //
  // opencode answers its `question` tool through POST /question/{id}/reply.
  // The v1 OpencodeClient we hold does NOT expose this route (the Question API
  // lives in the SDK's v2 namespace), so we call the spawned server's HTTP
  // endpoint directly — the same routes confirmed live on the running binary.
  // Without this, a question tool stays status:running forever and the session
  // hangs. Mirrors respondToPermission: pass `directory` to scope the reply.

  /** Base URL of the spawned opencode server (falls back to the default port). */
  private get serverUrl(): string {
    return this.server?.url ?? 'http://127.0.0.1:4096';
  }

  /**
   * POST /question/{requestID}/reply — answer a pending question.
   * `answers` is one `string[]` per question (selected option labels);
   * opencode's QuestionAnswer = string[]. Returns true on 2xx, false otherwise
   * (never throws — the caller still clears local UI state).
   */
  async replyToQuestion(
    requestId: string,
    answers: string[][],
    directory?: string,
  ): Promise<boolean> {
    return this.questionAction('reply', requestId, { answers }, directory);
  }

  /** POST /question/{requestID}/reject — dismiss a pending question. */
  async rejectQuestion(requestId: string, directory?: string): Promise<boolean> {
    return this.questionAction('reject', requestId, undefined, directory);
  }

  private async questionAction(
    action: 'reply' | 'reject',
    requestId: string,
    body: Record<string, unknown> | undefined,
    directory?: string,
  ): Promise<boolean> {
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const url = `${this.serverUrl}/question/${encodeURIComponent(requestId)}/${action}${qs}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        logger.error(
          `[OpencodeClientService] question ${action} failed (${res.status}) for ${requestId}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.error(
        `[OpencodeClientService] question ${action} threw for ${requestId}:`,
        err,
      );
      return false;
    }
  }

  /**
   * GET /question — list pending question requests across all sessions.
   * Fallback for resolving a tool callID → requestID when the bridge's
   * in-memory map was lost (e.g. server restart with a question still pending).
   */
  async listQuestions(
    directory?: string,
  ): Promise<
    Array<{
      id: string;
      sessionID: string;
      questions?: unknown[];
      tool?: { callID?: string };
    }>
  > {
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    try {
      const res = await fetch(`${this.serverUrl}/question${qs}`);
      if (!res.ok) return [];
      // GET /question returns the full QuestionRequest list — including the
      // `questions` array used to render the card when a missed `question.asked`
      // is recovered (see OpencodeStreamBridge.recoverPendingQuestions).
      return (await res.json()) as Array<{
        id: string;
        sessionID: string;
        questions?: unknown[];
        tool?: { callID?: string };
      }>;
    } catch (err) {
      logger.error('[OpencodeClientService] listQuestions failed:', err);
      return [];
    }
  }

  /**
   * POST /session/{id}/command — dispatch a slash-command in the session.
   *
   * Returns null when the SDK returns an error envelope.
   * Throws on unexpected exceptions.
   */
  async dispatchCommand(
    sdkId: string,
    command: string,
    args: string,
  ): Promise<{ info: import('@opencode-ai/sdk').Message; parts: import('@opencode-ai/sdk').Part[] } | null> {
    const client = this.requireClient();
    const raw = await client.session.command({
      path: { id: sdkId },
      body: { command, arguments: args },
    });
    if (raw.error || !raw.data) {
      logger.error(`[OpencodeClientService] dispatchCommand error for ${sdkId}:`, raw.error);
      return null;
    }
    return raw.data;
  }

  /**
   * GET /session/{id}/messages — list messages in the session.
   *
   * Throws on SDK error or exception — never swallows to [].
   */
  async listMessages(
    sdkId: string,
    directory?: string,
  ): Promise<import('@opencode-ai/sdk').Message[]> {
    const client = this.requireClient();
    // #861 smoke fix: engine session reads are DIRECTORY-SCOPED — without
    // ?directory=<session cwd> the engine looks in its default instance and
    // reports "Session not found" for sessions created under another cwd
    // (e.g. subagent sessions under $HOME). Same gotcha as respond/abort.
    const raw = await client.session.messages({
      path: { id: sdkId },
      ...(directory ? { query: { directory } } : {}),
    });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `listMessages failed for session ${sdkId}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data ?? [];
  }

  /**
   * GET /session/{id}/todo — todo list for the session.
   *
   * Throws on SDK error or exception — never swallows to [].
   */
  async getTodo(
    sdkId: string,
    directory?: string,
  ): Promise<import('@opencode-ai/sdk').Todo[]> {
    const client = this.requireClient();
    // #861 smoke fix: directory-scoped read (see listMessages).
    const raw = await client.session.todo({
      path: { id: sdkId },
      ...(directory ? { query: { directory } } : {}),
    });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `getTodo failed for session ${sdkId}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data ?? [];
  }

  /**
   * POST /session/{id}/revert — revert the session to a prior message.
   * `messageId` is required; `partId` is optional.
   *
   * Throws on SDK error or exception.
   */
  async revertSession(
    sdkId: string,
    messageId?: string,
  ): Promise<import('@opencode-ai/sdk').Session | null> {
    const client = this.requireClient();
    const raw = await client.session.revert({
      path: { id: sdkId },
      body: { messageID: messageId ?? '' },
    });
    if (raw.error || !raw.data) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `revertSession failed for session ${sdkId}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data;
  }

  /**
   * POST /session/{id}/unrevert — restore all reverted messages.
   *
   * Throws on SDK error or exception.
   */
  async unrevertSession(
    sdkId: string,
  ): Promise<import('@opencode-ai/sdk').Session | null> {
    const client = this.requireClient();
    const raw = await client.session.unrevert({
      path: { id: sdkId },
    });
    if (raw.error || !raw.data) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `unrevertSession failed for session ${sdkId}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data;
  }

  /**
   * POST /session/{id}/summarize — generate a summary for the session.
   *
   * OPC-M3-3: Throws AppError on SDK error envelope — never swallows to false.
   * The body fields (providerID, modelID) are optional in v1.14.49; omitting
   * them lets the SDK pick the default model already configured for the session.
   */
  async summarizeSession(
    sdkId: string,
    model: { providerID: string; modelID: string },
    directory?: string,
  ): Promise<boolean> {
    const client = this.requireClient();
    // session.summarize REQUIRES providerID + modelID (the model used to write
    // the summary); omitting them errors with "expected string, received
    // undefined". It also needs `directory` — opencode scopes sessions per
    // directory, so without it summarize is a no-op (no compaction, no event).
    const raw = await client.session.summarize({
      path: { id: sdkId },
      body: { providerID: model.providerID, modelID: model.modelID },
      ...(directory ? { query: { directory } } : {}),
    });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `summarizeSession failed for session ${sdkId}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data === true;
  }

  /**
   * POST /session/{id}/fork — fork the session at an optional message.
   *
   * Throws on SDK error or exception.
   */
  async forkSession(
    sdkId: string,
    messageId?: string,
  ): Promise<import('@opencode-ai/sdk').Session | null> {
    const client = this.requireClient();
    const raw = await client.session.fork({
      path: { id: sdkId },
      body: messageId ? { messageID: messageId } : undefined,
    });
    if (raw.error || !raw.data) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `forkSession failed for session ${sdkId}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data;
  }

  /**
   * GET /session/{id}/children — list child sessions.
   *
   * Throws on SDK error or exception — never swallows to [].
   */
  async listChildren(
    sdkId: string,
    directory?: string,
  ): Promise<import('@opencode-ai/sdk').Session[]> {
    const client = this.requireClient();
    // #861 smoke fix: directory-scoped read (see listMessages).
    const raw = await client.session.children({
      path: { id: sdkId },
      ...(directory ? { query: { directory } } : {}),
    });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `listChildren failed for session ${sdkId}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data ?? [];
  }

  /**
   * GET /mcp — status map for all MCP servers.
   *
   * Throws on SDK error or exception.
   */
  async listMcp(): Promise<Record<string, import('@opencode-ai/sdk').McpStatusEntry>> {
    const client = this.requireClient();
    const raw = await client.mcp.status();
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `listMcp failed: ${JSON.stringify(raw.error)}`,
      );
    }
    const statusMap = raw.data ?? {};
    // #723 — drop servers removed in this process that the engine still
    // reports from stale in-memory state. Without this the removed row
    // persists in the UI until the engine restarts. Build a NEW object so we
    // never mutate the SDK's returned data in place.
    if (this._removedPendingRestart.size === 0) {
      return statusMap;
    }
    const reconciled: Record<string, import('@opencode-ai/sdk').McpStatusEntry> = {};
    for (const [name, entry] of Object.entries(statusMap)) {
      if (!this._removedPendingRestart.has(name)) {
        reconciled[name] = entry;
      }
    }
    return reconciled;
  }

  /**
   * POST /mcp — add a new MCP server to the opencode engine.
   *
   * `config` is either a local config (type:'local', command:[...]) or a
   * remote config (type:'remote', url:'...'). Throws AppError on SDK error.
   *
   * OPC-M4-3: typed wrapper for client.mcp.add().
   *
   * Issue #716 fix: `client.mcp.add()` only registers the server in-memory for
   * the running opencode instance. `client.mcp.status()` (used by listMcp /
   * GET /opencode/mcp) re-derives from the persisted opencode.json config, so a
   * server added only in-memory disappears from the list immediately after add.
   * We persist the new entry to opencode.json BEFORE calling the SDK so that
   * the subsequent status call (and any app restart) includes it.
   */
  async addMcp(
    name: string,
    config: import('@opencode-ai/sdk').McpLocalConfigInput | import('@opencode-ai/sdk').McpRemoteConfigInput,
  ): Promise<Record<string, import('@opencode-ai/sdk').McpStatusEntry>> {
    // ── Step 1: persist to opencode.json so the server survives re-list / restart ──
    const { existsSync, readFileSync, writeFileSync, mkdirSync } =
      require('fs') as typeof import('fs');
    const { join, dirname } = require('path') as typeof import('path');
    const { homedir } = require('os') as typeof import('os');

    const configPath = join(homedir(), '.config', 'opencode', 'opencode.json');

    let parsed: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        parsed = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch (err) {
        throw new AppError(
          502,
          'SDK_ERROR',
          `addMcp: could not parse opencode.json for ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Merge the new server into the mcp section.
    const mcpSection = (parsed.mcp as Record<string, unknown> | undefined) ?? {};
    mcpSection[name] = config;
    parsed.mcp = mcpSection;

    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      logger.info(`[OpencodeClientService] addMcp: persisted ${name} to opencode.json`);
      // #723 — a re-added server must reappear in listMcp(): clear any stale
      // removed-pending-restart marker for this name.
      this.markMcpPresent(name);
    } catch (err) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `addMcp: could not write opencode.json for ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ── Step 2: register with the running engine (in-memory, live session) ──
    const client = this.requireClient();
    const raw = await client.mcp.add({
      body: { name, config },
    });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `addMcp failed for ${name}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data ?? {};
  }

  /**
   * Read the persisted MCP server configs from opencode.json.
   * Returns the `mcp` section as a map of server name → raw config object.
   * Returns {} when the file is absent or unparseable (never throws).
   *
   * Used by the GET /opencode/mcp route to surface environment keys and
   * derive the `needsCredentials` signal.
   */
  async getPersistedMcpConfigs(): Promise<Record<string, Record<string, unknown>>> {
    const { existsSync, readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const { homedir } = require('os') as typeof import('os');
    const configPath = join(homedir(), '.config', 'opencode', 'opencode.json');
    if (!existsSync(configPath)) {
      return {};
    }
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      return (parsed.mcp as Record<string, Record<string, unknown>> | undefined) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * Idempotently register the rhythm MCP server into opencode.json with the
   * live production token + URL. Adds when absent, rewrites + reconnects when
   * the token/URL changed, no-ops when identical. `opts.configPath` overrides
   * the default (~/.config/opencode/opencode.json) for tests; `opts.register`
   * controls whether to also register live with a running engine.
   */
  async ensureRhythmMcp(
    apiToken: string,
    apiUrl: string,
    opts?: { configPath?: string; register?: boolean },
  ): Promise<{ changed: boolean; registered: boolean }> {
    const { existsSync, readFileSync, writeFileSync, mkdirSync } =
      require('fs') as typeof import('fs');
    const { join, dirname } = require('path') as typeof import('path');
    const { homedir } = require('os') as typeof import('os');

    const configPath =
      opts?.configPath ??
      join(homedir(), '.config', 'opencode', 'opencode.json');

    // #804 — memory MCP tools talk to the LOCAL agent server (RHYTHM_AGENT_URL),
    // not the prod Settings URL (RHYTHM_API_URL). Pin the agent base to the
    // local server so memory writes/reads hit the same store the Flutter memory
    // UI reads; decoupled from apiUrl per the dual-endpoint rule.
    const agentUrl =
      (process.env.RHYTHM_AGENT_URL && process.env.RHYTHM_AGENT_URL.trim()) ||
      'http://localhost:4001';
    const desired = {
      type: 'local' as const,
      // #814 — never a bare unversioned spec; see resolveRhythmMcpCommand.
      command: resolveRhythmMcpCommand(),
      environment: {
        RHYTHM_API_URL: apiUrl,
        RHYTHM_AGENT_URL: agentUrl,
        RHYTHM_API_TOKEN: apiToken,
      },
    };

    let parsed: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        parsed = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch (err) {
        throw new AppError(
          502,
          'SDK_ERROR',
          `ensureRhythmMcp: could not parse opencode.json: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const mcpSection = (parsed.mcp as Record<string, unknown> | undefined) ?? {};
    const existing = mcpSection.rhythm;
    if (JSON.stringify(existing) === JSON.stringify(desired)) {
      return { changed: false, registered: false };
    }

    mcpSection.rhythm = desired;
    parsed.mcp = mcpSection;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    logger.info('[OpencodeClientService] ensureRhythmMcp: persisted rhythm config');
    // #723 — rhythm was just (re-)persisted; clear any stale removal marker.
    this.markMcpPresent('rhythm');

    let registered = false;
    if (opts?.register !== false) {
      try {
        const client = this.requireClient();
        await client.mcp.add({ body: { name: 'rhythm', config: desired } });
        registered = true;
      } catch (err) {
        logger.warn(
          `[OpencodeClientService] ensureRhythmMcp: live registration skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { changed: true, registered };
  }

  /**
   * Issue #860 — disable the standalone `memory` knowledge-graph MCP
   * (@modelcontextprotocol/server-memory) from the generated opencode.json
   * path, so agents scoped with an unrestricted MCP allowlist (the
   * `allowed_mcps_json === null` fail-open case — see
   * `agent_profile_scope.ts`) never see a SECOND memory store alongside the
   * Obsidian AGENT-MEMORY vault. Per
   * docs/ai/decisions/2026-07-02-agent-memory-in-obsidian-vault.md, that vault
   * is the single source of truth; a standalone `memory` MCP server
   * (independently installed by the user, e.g. via Claude Desktop/Code
   * config — Rhythm never installs it) is a split-brain risk if left enabled.
   *
   * Sets `mcp.memory.enabled = false` WITHOUT deleting the entry — this
   * preserves the user's existing config (command, environment, any data path
   * they set) in case they want to re-enable it manually; it just stops the
   * engine from starting it. Idempotent:
   *   - no `mcp.memory` entry at all → no-op (`changed: false`), and
   *     CRITICALLY never creates one — this function only ever narrows an
   *     existing entry, never adds a new server.
   *   - `mcp.memory.enabled` already `false` → no-op.
   *   - otherwise → rewrite with `enabled: false`, preserving every other
   *     field on the entry untouched.
   * A missing config file is a safe no-op (mirrors ensureRhythmMcp's
   * defensive read, but never writes a file that didn't already exist since
   * there is nothing to disable).
   */
  async disableStandaloneMemoryMcp(
    opts?: { configPath?: string },
  ): Promise<{ changed: boolean }> {
    const { existsSync, readFileSync, writeFileSync } =
      require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const { homedir } = require('os') as typeof import('os');

    const configPath =
      opts?.configPath ??
      join(homedir(), '.config', 'opencode', 'opencode.json');

    if (!existsSync(configPath)) {
      return { changed: false };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      logger.warn(
        `[OpencodeClientService] disableStandaloneMemoryMcp: could not parse opencode.json (leaving untouched): ${err instanceof Error ? err.message : String(err)}`,
      );
      return { changed: false };
    }

    const mcpSection = parsed.mcp as Record<string, unknown> | undefined;
    const memoryEntry = mcpSection?.memory as Record<string, unknown> | undefined;
    if (!mcpSection || !memoryEntry) {
      return { changed: false };
    }
    if (memoryEntry.enabled === false) {
      return { changed: false };
    }

    mcpSection.memory = { ...memoryEntry, enabled: false };
    parsed.mcp = mcpSection;
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    logger.info(
      '[OpencodeClientService] disableStandaloneMemoryMcp: disabled standalone memory MCP (#860 — Obsidian AGENT-MEMORY vault is the single source of truth)',
    );
    return { changed: true };
  }

  /**
   * Idempotently merge the curated MCP server registry
   * ({@link CURATED_MCP_SERVERS}) into opencode.json's `mcp` block.
   *
   * For each curated server we compute the desired opencode.json entry
   * (`{type, command|url[, environment]}`) and JSON-compare it against the
   * existing entry under the same key:
   *   - absent → add it (changed)
   *   - different → refresh it (changed)
   *   - identical → leave untouched
   * Unrelated entries (e.g. the `rhythm` server) are preserved exactly. The
   * file is written ONCE, and only when something actually changed — a no-op
   * run leaves the file byte-identical.
   *
   * After persisting, each changed server is best-effort live-registered with
   * the running engine via `client.mcp.add()`. This is NON-FATAL: any failure
   * (engine not ready, SDK error) is logged and yields `registered:false`; the
   * file write has already succeeded and is never rolled back.
   *
   * `opts.configPath` overrides the default
   * (~/.config/opencode/opencode.json) for tests; `opts.register` controls
   * whether to also live-register (default true).
   *
   * MCP-6 — `opts.tokenResolver` bridges Rhythm's stored OAuth credentials
   * into curated servers that declare a `tokenProvider`. For each such server
   * the resolver is asked for a FRESH access token; the token is injected into
   * the server's `environment[tokenEnvKey]` before the JSON-compare/persist.
   * When the resolver returns `null`/empty (no account connected) that ONE
   * server is SKIPPED entirely — it is never written with an empty placeholder
   * token — and the remaining servers continue. A resolver that THROWS for one
   * provider is treated the same as "no account" for that server (logged,
   * skipped) so a single broken provider can't abort the whole ensure. When no
   * `tokenResolver` is supplied, token-bridged servers are skipped (no token
   * source available); zero-auth servers (PDF Tools) are unaffected.
   */
  async ensureCuratedMcps(opts?: {
    configPath?: string;
    register?: boolean;
    tokenResolver?: CuratedTokenResolver;
    /**
     * Curated server list to ensure. Defaults to {@link CURATED_MCP_SERVERS}.
     * Overridable so the token-bridge mechanism stays unit-covered with a
     * synthetic `tokenProvider` fixture now that the verified catalog has no
     * token-bridged curated entry (google/pco were dropped). Production callers
     * never pass this.
     */
    servers?: CuratedMcpServer[];
  }): Promise<{
    changed: boolean;
    registered: boolean;
    servers: CuratedMcpServer[];
  }> {
    const { existsSync, readFileSync, writeFileSync, mkdirSync } =
      require('fs') as typeof import('fs');
    const { join, dirname } = require('path') as typeof import('path');
    const { homedir } = require('os') as typeof import('os');

    const configPath =
      opts?.configPath ??
      join(homedir(), '.config', 'opencode', 'opencode.json');

    let parsed: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        parsed = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch (err) {
        throw new AppError(
          502,
          'SDK_ERROR',
          `ensureCuratedMcps: could not parse opencode.json: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const mcpSection =
      (parsed.mcp as Record<string, unknown> | undefined) ?? {};

    // Build the desired opencode.json entry for a curated server. The optional
    // `environment` override carries the bridged fresh token (MCP-6) merged
    // over any static `server.environment`.
    const toEntry = (
      s: CuratedMcpServer,
      environment?: Record<string, string>,
    ): Record<string, unknown> => {
      const entry: Record<string, unknown> =
        s.type === 'remote'
          ? { type: 'remote', url: s.url }
          : { type: 'local', command: s.command };
      const env = { ...(s.environment ?? {}), ...(environment ?? {}) };
      if (Object.keys(env).length > 0) {
        entry.environment = env;
      }
      return entry;
    };

    // MCP-6 — resolve a fresh token for a token-bridged server. Returns the
    // env map to inject, or `null` to signal "skip this server entirely"
    // (no account connected / no resolver / resolver threw).
    const resolveBridgedEnv = async (
      server: CuratedMcpServer,
    ): Promise<Record<string, string> | null> => {
      if (!server.tokenProvider || !server.tokenEnvKey) return {};
      if (!opts?.tokenResolver) {
        logger.info(
          `[OpencodeClientService] ensureCuratedMcps: skipping ${server.id} — no token resolver supplied`,
        );
        return null;
      }
      let token: string | null;
      try {
        token = await opts.tokenResolver(server.tokenProvider);
      } catch (err) {
        logger.warn(
          `[OpencodeClientService] ensureCuratedMcps: skipping ${server.id} — token resolve failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
      if (!token || token.trim() === '') {
        logger.info(
          `[OpencodeClientService] ensureCuratedMcps: skipping ${server.id} — no ${server.tokenProvider} account connected`,
        );
        return null;
      }
      return { [server.tokenEnvKey]: token };
    };

    const curatedServers = opts?.servers ?? CURATED_MCP_SERVERS;
    const changedServers: CuratedMcpServer[] = [];
    for (const server of curatedServers) {
      const bridgedEnv = await resolveBridgedEnv(server);
      // null → token-bridged server with no connected account: skip entirely.
      if (bridgedEnv === null) continue;
      const desired = toEntry(server, bridgedEnv);
      const existing = mcpSection[server.id];
      if (JSON.stringify(existing) === JSON.stringify(desired)) {
        continue;
      }
      mcpSection[server.id] = desired;
      changedServers.push(server);
    }

    const changed = changedServers.length > 0;
    if (changed) {
      parsed.mcp = mcpSection;
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      logger.info(
        `[OpencodeClientService] ensureCuratedMcps: persisted ${changedServers
          .map((s) => s.id)
          .join(', ')}`,
      );
      // #723 — each curated server just (re-)persisted should reappear in
      // listMcp(): clear any stale removed-pending-restart markers.
      for (const server of changedServers) {
        this.markMcpPresent(server.id);
      }
    }

    // ── Best-effort live registration (NON-FATAL) ──
    let registered = false;
    if (changed && opts?.register !== false) {
      try {
        const client = this.requireClient();
        for (const server of changedServers) {
          // Register the entry exactly as persisted (incl. any bridged token).
          await client.mcp.add({
            body: {
              name: server.id,
              config: mcpSection[server.id] as
                | import('@opencode-ai/sdk').McpLocalConfigInput
                | import('@opencode-ai/sdk').McpRemoteConfigInput,
            },
          });
        }
        registered = true;
      } catch (err) {
        logger.warn(
          `[OpencodeClientService] ensureCuratedMcps: live registration skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { changed, registered, servers: changedServers };
  }

  /**
   * POST /mcp/{name}/connect — connect a named MCP server.
   *
   * Returns `{ connected, authorizationUrl? }`.
   *
   * For remote OAuth servers (e.g. canva, notion) `client.mcp.connect` resolves
   * to `false` because the server is not yet authenticated. In that case we
   * begin the OAuth flow via `client.mcp.auth.start`, whose 200 body carries the
   * consent URL (`{ authorizationUrl }`, verified against the real SDK's
   * McpAuthStartResponses). We surface that URL so the caller can open it in a
   * browser. Servers that don't use OAuth simply have no auth.start endpoint —
   * that error is tolerated and we return `{ connected: false }`.
   *
   * OPC-M4-3: throws AppError on the connect SDK error envelope (never swallows).
   */
  async connectMcp(
    name: string,
  ): Promise<{ connected: boolean; authorizationUrl?: string }> {
    const client = this.requireClient();
    // OAuth-needing servers (e.g. canva, notion) report connect:true while they
    // still require interactive sign-in, so the consent URL — not connect's
    // boolean — is the source of truth. Ask auth.start FIRST and surface its
    // authorizationUrl when present. Only fall back to a plain connect when
    // there's no auth URL (server doesn't support/need OAuth).
    try {
      const authRaw = await client.mcp.auth.start({ path: { name } });
      const authorizationUrl = authRaw.error
        ? undefined
        : authRaw.data?.authorizationUrl;
      if (authorizationUrl) {
        return { connected: false, authorizationUrl };
      }
    } catch {
      // auth.start unsupported / failed for this server — fall through.
    }

    const raw = await client.mcp.connect({
      path: { name },
    });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `connectMcp failed for ${name}: ${JSON.stringify(raw.error)}`,
      );
    }
    return { connected: raw.data === true };
  }

  /**
   * POST /mcp/{name}/connect — RAW reconnect (NO auth.start-first).
   *
   * Used by the self-contained MCP OAuth workaround (mcp_oauth_service.ts):
   * after we write tokens into opencode's mcp-auth.json ourselves, the engine
   * just needs to re-read them and establish an authenticated session. Calling
   * the auth.start-first {@link connectMcp} here would re-enter opencode's
   * broken auth path (which never registers the OAuth state) and surface a
   * fresh consent URL instead of connecting. So this calls `client.mcp.connect`
   * directly and returns the boolean.
   *
   * Throws AppError on the SDK error envelope.
   */
  async reconnectMcp(name: string): Promise<boolean> {
    const client = this.requireClient();
    const raw = await client.mcp.connect({ path: { name } });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `reconnectMcp failed for ${name}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data === true;
  }

  /**
   * POST /mcp/{name}/disconnect — disconnect a named MCP server.
   *
   * OPC-M4-3: throws AppError on SDK error envelope (never swallows to false).
   */
  async disconnectMcp(name: string): Promise<boolean> {
    const client = this.requireClient();
    const raw = await client.mcp.disconnect({
      path: { name },
    });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `disconnectMcp failed for ${name}: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data === true;
  }

  /**
   * Remove a named MCP server.
   *
   * The SDK v1.14.49 does not expose a direct DELETE /mcp/{name} endpoint on
   * `client.mcp`. We implement removal by disconnecting then removing the
   * server from the opencode.json config file (the same file that
   * opencode_plugin_config.ts manages for plugins). After the next engine
   * restart the server will no longer appear. Throws AppError on failure.
   *
   * OPC-M4-3 typed wrapper.
   */
  async removeMcp(name: string): Promise<void> {
    // #723 — record the removal up front so listMcp() filters it out even
    // though the running engine keeps reporting it from in-memory state until
    // restart. Recorded before any fs/SDK work so it holds regardless of
    // whether the config write below short-circuits.
    this.markMcpRemoved(name);

    // 1. Disconnect first (best-effort — ignore "not connected" errors).
    try {
      await this.disconnectMcp(name);
    } catch {
      // Server may already be disconnected / not found — proceed to config removal.
    }

    // 2. Remove from opencode.json mcp section so it is not re-added on restart.
    const { existsSync, readFileSync, writeFileSync, mkdirSync } =
      require('fs') as typeof import('fs');
    const { join, dirname } = require('path') as typeof import('path');
    const { homedir } = require('os') as typeof import('os');

    const configPath = join(homedir(), '.config', 'opencode', 'opencode.json');

    if (!existsSync(configPath)) {
      // Nothing to remove — server was dynamically added only (not in config).
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `removeMcp: could not parse opencode.json for ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const mcpSection = parsed.mcp as Record<string, unknown> | undefined;
    if (!mcpSection || !(name in mcpSection)) {
      // Not present in config — nothing to do.
      return;
    }

    delete mcpSection[name];
    if (Object.keys(mcpSection).length === 0) {
      delete parsed.mcp;
    } else {
      parsed.mcp = mcpSection;
    }

    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      logger.info(`[OpencodeClientService] removeMcp: removed ${name} from opencode.json`);
    } catch (err) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `removeMcp: could not write opencode.json for ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── PTY wrappers ──────────────────────────────────────────────────────────

  /**
   * POST /pty — create a new PTY session.
   *
   * `opts.cwd` is required; `opts.command` is optional (defaults to the
   * user's shell). Throws AppError(502) on SDK error envelope.
   */
  async createPty(opts: {
    cwd: string;
    command?: string;
  }): Promise<{ id: string; pid: number; status: string }> {
    const client = this.requireClient();
    const body: { cwd: string; command?: string } = { cwd: opts.cwd };
    if (opts.command) body.command = opts.command;
    const raw = await (client as any).pty.create({ body });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `createPty failed: ${JSON.stringify(raw.error)}`,
      );
    }
    const d = raw.data as { id: string; pid: number; status: string };
    return { id: d.id, pid: d.pid, status: d.status };
  }

  /**
   * PATCH /pty/{id} — resize a PTY session.
   *
   * Throws AppError(502) on SDK error envelope.
   */
  async resizePty(id: string, cols: number, rows: number): Promise<void> {
    const client = this.requireClient();
    const raw = await (client as any).pty.update({
      path: { id },
      body: { size: { rows, cols } },
    });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `resizePty failed for ${id}: ${JSON.stringify(raw.error)}`,
      );
    }
  }

  /**
   * DELETE /pty/{id} — remove a PTY session (best-effort; swallows errors).
   *
   * The PTY may already be gone when the client disconnects — swallow all
   * errors so callers do not need to handle cleanup failures.
   */
  async removePty(id: string): Promise<void> {
    const client = this.requireClient();
    try {
      await (client as any).pty.remove({ path: { id } });
    } catch {
      /* best-effort: PTY may already be gone */
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * OPC-M4-4 — GET /agent — list all agents (built-in + custom) for an
   * optional cwd. Returns an empty array when the client is not ready.
   *
   * Throws on SDK error envelope or thrown exception (never swallows to []).
   */
  async listAgents(
    directory?: string,
  ): Promise<import('@opencode-ai/sdk').SdkAgent[]> {
    const client = this.requireClient();
    const raw = await client.app.agents(
      directory ? { query: { directory } } : undefined,
    );
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `listAgents failed: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data ?? [];
  }

  /**
   * OPC-M1-5 — GET /session/{id}: check whether an SDK session still exists.
   *
   * Returns the Session object when found, or null when the SDK returns an
   * error envelope (e.g. 404) or throws. Null means the session is gone and
   * resume() must return HTTP 410.
   *
   * Does NOT throw — callers use the null signal to distinguish gone vs. error.
   */
  async getSession(
    sdkId: string,
  ): Promise<import('@opencode-ai/sdk').Session | null> {
    const client = this.requireClient();
    let raw: { data?: import('@opencode-ai/sdk').Session; error?: unknown };
    try {
      raw = await client.session.get({ path: { id: sdkId } });
    } catch (err) {
      // A thrown error is transport/engine trouble, NOT proof the session is
      // gone. Conflating the two would let a transient hiccup 410 a live
      // conversation (resume → "start fresh" against intact history).
      throw new AppError(
        502,
        'SDK_ERROR',
        `getSession transport failure for session ${sdkId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (raw.error || !raw.data) {
      // The engine responded but doesn't know this id — genuinely gone.
      logger.warn(
        `[OpencodeClientService] getSession: session "${sdkId}" not found: ${JSON.stringify(raw.error ?? 'no data')}`,
      );
      return null;
    }
    return raw.data;
  }

  /**
   * #614 — Dispose: kills the opencode subprocess that the SDK spawned and
   * clears the client reference. Safe to call multiple times.
   *
   * The SDK returns `{ client, server }` from `createOpencode()`. The
   * `server.close()` method is the only documented way to stop the
   * spawned opencode subprocess (which holds :4096). Earlier versions of
   * this code probed `client.close()` / `client.shutdown()` — neither
   * exists, so dispose was a no-op and the opencode child orphaned on
   * every shutdown. Captured server handle in `initialize()`.
   */
  /**
   * Returns true when a shutdown is in progress (dispose has been called),
   * false when the engine is still active.
   */
  get isDisposed(): boolean {
    return this.status === 'uninitialized' && this.client === null && this.server === null;
  }

  dispose(): void {
    if (this.status === 'uninitialized' && this.client === null && this.server === null) {
      return; // Already disposed — no-op.
    }
    if (!this._disposeLogged) {
      logger.info(
        '[WARN] [OpencodeClientService] dispose() called — status was %s. Stack: %s',
        this.status,
        new Error().stack?.split('\n').slice(2).join('\n') ?? '(no stack)',
      );
      this._disposeLogged = true;
    }
    if (this.server) {
      try {
        this.server.close();
      } catch (err) {
        logger.error('[OpencodeClientService] server.close() threw:', err);
      }
    }
    this._shuttingDown = true;
    this.server = null;
    this.client = null;
    this.status = 'uninitialized';
  }
  private _disposeLogged = false;

  /**
   * Issue #856 — bounce the opencode engine subprocess so it re-reads
   * `auth.json` after a provider credential change (e.g. switching Claude
   * accounts). The engine caches the token it loaded at spawn time
   * ({@link restoreAuth} only runs during {@link initialize}), so a content
   * change on disk is otherwise invisible to the running process until a
   * full app restart — every call 401s in the meantime.
   *
   * This is a graceful restart, NOT an in-engine/fork change: dispose the
   * current subprocess (closing its port cleanly) and re-run the normal
   * {@link initialize} path, which re-spawns `opencode serve` and calls
   * {@link restoreAuth} against the fresh file content. `status` is set to
   * `'reloading'` for the duration so `statusMessage` / `isReady` reflect a
   * brief, honest "reloading credentials…" window instead of exposing
   * transient 401s as a hard error.
   *
   * Intended to be called by an {@link AuthCredentialWatcher} instance wired
   * up in server.ts, NOT on every auth.json touch — the watcher's
   * change-detection + debounce logic decides when a bounce is warranted.
   */
  async reloadCredentials(): Promise<void> {
    if (this._shuttingDown) {
      logger.info(
        '[OpencodeClientService] reloadCredentials: skipped — app is shutting down',
      );
      return;
    }
    logger.info(
      '[OpencodeClientService] reloadCredentials: bouncing engine to pick up changed auth.json',
    );
    this.status = 'reloading';
    // dispose() sets _shuttingDown=true as a side effect (shared with the
    // app-shutdown path) — reset it immediately so this is understood as a
    // planned bounce, not a permanent shutdown, before any other code
    // observes `_shuttingDown`.
    this.dispose();
    this._shuttingDown = false;
    this._disposeLogged = false;
    try {
      await this.initialize();
      // Read through a getter-shaped indirection so TS does not (incorrectly)
      // keep narrowing this.status to the 'reloading' literal assigned above
      // across the intervening dispose()/initialize() calls.
      const statusAfterReinit: EngineStatus = this.currentStatusForLogging();
      if (statusAfterReinit === 'ready') {
        logger.info(
          '[OpencodeClientService] reloadCredentials: engine restarted, credentials reloaded',
        );
      } else {
        logger.warn(
          `[OpencodeClientService] reloadCredentials: engine did not reach ready after bounce (status=${statusAfterReinit})`,
        );
      }
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        '[OpencodeClientService] reloadCredentials: re-initialization failed:',
        this.error,
      );
    }
  }
}
