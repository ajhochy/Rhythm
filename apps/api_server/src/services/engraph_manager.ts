/**
 * #1096 WP1 — device-local Engraph backend manager.
 *
 * Turns the operator-managed Engraph HTTP service assumed by #1093/#1095 into
 * something a nontechnical staff member can turn on from Settings, with no
 * shell and no environment variables. This file owns:
 *
 *  - DISCOVERY: find an `engraph` binary on PATH / common Homebrew locations,
 *    or validate a user-selected path. Never bundles/auto-installs it.
 *  - PATH/OWNERSHIP SAFETY: a Rhythm-only Engraph HOME (this app's Application
 *    Support dir), scoped to index ONLY Rhythm's canonical agent-memory
 *    directory. `~/.engraph` (the user's normal, global Engraph state) is
 *    NEVER read, written, or touched — see `engraphHomeDir()` below: Engraph
 *    resolves all of its own state under `$HOME/.engraph`, so spawning it
 *    with a Rhythm-only `HOME` env override sandboxes it completely (verified
 *    against the real `engraph` 1.7.2 binary during this work).
 *  - PROCESS OWNERSHIP: tracks only the exact `ChildProcess` handle this
 *    manager spawned. There is no code path anywhere in this file that stops
 *    a process by PID, port, or name supplied from outside — the #1124 class
 *    of bug (killing an unrelated process based on a weak identifier) is
 *    structurally impossible here because no such identifier is ever
 *    accepted as input.
 *  - SERVICE CONTRACT: spawns `engraph serve --http --read-only` bound to
 *    127.0.0.1 with a freshly generated, never-persisted, read-only API key.
 *    `--read-only` disables Engraph's write MCP tools; the read-permission
 *    API key additionally makes every write REST endpoint 403 regardless
 *    (verified against the real binary). No write/index-arbitrary-path/admin
 *    capability is ever exposed through this seam.
 *  - HEALTH GATE: `checkHealthNow()` performs a REAL authenticated
 *    `/api/search` call with a 1-second budget. Process/port existence is
 *    never treated as "healthy" — only a successful authenticated search is.
 *  - CONFIG PERSISTENCE: see engraph_manager_config_store.ts. No secret or
 *    memory content is ever persisted there.
 *
 * Every failure path (missing binary, spawn failure, index failure, timeout,
 * malformed response, permission denial) leaves `getRetrievalClient()`
 * returning a client whose `search()` always resolves `[]` — the existing
 * `getRelevantMemoriesSemantic` FTS fallback in memory_retrieval.ts is
 * untouched and always wins.
 */
import { spawn, execFile, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import {
  mkdirSync, realpathSync, statSync, accessSync, constants as fsConstants,
  writeFileSync, chmodSync,
} from 'fs';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import net from 'net';
import path from 'path';
import { logger } from '../utils/logger';
import { resolveMemoryDirPath } from '../config/env';
import { EngraphHttpClient, type EngraphClient } from './engraph_client';
import {
  EngraphManagerConfigStore,
  type EngraphDiscoverySource,
  type EngraphFailureCategory,
  type EngraphLifecycleState,
} from './engraph_manager_config_store';

const execFileAsync = promisify(execFile);

/** Homebrew install locations checked in addition to PATH (MVP: no bundling). */
const COMMON_BINARY_LOCATIONS = ['/opt/homebrew/bin/engraph', '/usr/local/bin/engraph'];
const HEALTH_CHECK_BUDGET_MS = 1_000;
// ponytail: a freshly spawned real Engraph process can take longer than 1s to
// finish loading its embedding model into memory (or, on a first run in a
// fresh HOME, to finish a one-time model download) before it starts
// listening — this is startup latency, not the steady-state health contract.
// Poll with the same strict 1s-budget health check until this deadline;
// bump if a much larger memory-vault / much slower first-run model fetch is
// observed in practice.
const STARTUP_HEALTH_TIMEOUT_MS = 45_000;
const STARTUP_HEALTH_POLL_MS = 500;
const INDEX_TIMEOUT_MS = 120_000;
const VALIDATE_TIMEOUT_MS = 5_000;
const STOP_GRACE_MS = 3_000;
/** Probe text for the health-gate search — never a real user query. */
const HEALTH_PROBE_QUERY = 'rhythm-engraph-health-check';

export interface EngraphBinaryCandidate {
  path: string;
  source: EngraphDiscoverySource;
}

export interface EngraphValidationResult {
  ok: boolean;
  version?: string;
  reason?: 'not_found' | 'not_executable' | 'unexpected_output' | 'exec_failed';
}

export interface EngraphHealthResult {
  ok: boolean;
  category?: EngraphFailureCategory;
  message?: string;
  latencyMs?: number;
}

export interface EngraphManagerStatus {
  enabled: boolean;
  state: EngraphLifecycleState;
  executablePath: string | null;
  discoverySource: EngraphDiscoverySource | null;
  version: string | null;
  approvedMemoryRoot: string | null;
  engraphHomeDir: string;
  lastHealthyAt: string | null;
  lastFailureCategory: EngraphFailureCategory | null;
  lastFailureMessage: string | null;
}

type ExecFileImpl = (
  file: string,
  args: string[],
  opts: { timeout?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

// ---------------------------------------------------------------------------
// Pure / injectable helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export function isExecutableFile(candidate: string): boolean {
  try {
    const st = statSync(candidate);
    if (!st.isFile()) return false;
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Check PATH + known Homebrew locations. Never bundles/auto-installs. */
export function discoverEngraphCandidates(
  pathEnv: string = process.env.PATH ?? '',
): EngraphBinaryCandidate[] {
  const found: EngraphBinaryCandidate[] = [];
  const seen = new Set<string>();
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'engraph');
    if (!seen.has(candidate) && isExecutableFile(candidate)) {
      found.push({ path: candidate, source: 'path' });
      seen.add(candidate);
    }
  }
  for (const candidate of COMMON_BINARY_LOCATIONS) {
    if (!seen.has(candidate) && isExecutableFile(candidate)) {
      found.push({ path: candidate, source: 'homebrew' });
      seen.add(candidate);
    }
  }
  return found;
}

/**
 * Treat `candidatePath` as UNTRUSTED input (discovered or user-selected):
 * resolve symlinks, confirm it is a real executable file, then confirm it
 * actually runs and self-identifies as `engraph <version>` via a fixed
 * `--version` invocation (execFile — no shell interpretation). Anything that
 * doesn't match is rejected rather than persisted.
 */
export async function validateEngraphBinary(
  candidatePath: string,
  execFileImpl: ExecFileImpl = execFileAsync as unknown as ExecFileImpl,
): Promise<EngraphValidationResult> {
  let real: string;
  try {
    real = realpathSync(candidatePath);
  } catch {
    return { ok: false, reason: 'not_found' };
  }
  if (!isExecutableFile(real)) return { ok: false, reason: 'not_executable' };
  try {
    const { stdout } = await execFileImpl(real, ['--version'], { timeout: VALIDATE_TIMEOUT_MS });
    const match = stdout.trim().match(/^engraph (\d+\.\d+\.\d+)/);
    if (!match) return { ok: false, reason: 'unexpected_output' };
    return { ok: true, version: match[1] };
  } catch {
    return { ok: false, reason: 'exec_failed' };
  }
}

/** Resolve Rhythm's canonical, symlink-resolved agent-memory root — the ONLY
 *  directory the MVP ever indexes. Creates it if absent (mirrors the
 *  existing `resolveMemoryDirPath()` write-path convention). */
export function resolveApprovedMemoryRoot(): string {
  const dir = resolveMemoryDirPath();
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

/**
 * Defense-in-depth confinement guard: true only when `candidate`, after
 * resolving symlinks, is EXACTLY the approved agent-memory root. Rejects
 * traversal (`..`), a symlink that escapes the root, a parent/sibling/whole-
 * vault folder, and any nonexistent path. The manager itself never accepts a
 * caller-supplied vault path at all (no folder picker in the MVP) — this
 * guard exists so that invariant is independently testable and to mirror the
 * confinement style of `mapEngraphFileToSourceId` in engraph_client.ts.
 */
export function isWithinApprovedMemoryRoot(candidate: string): boolean {
  const approved = resolveApprovedMemoryRoot();
  try {
    return realpathSync(path.resolve(candidate)) === approved;
  } catch {
    return false;
  }
}

/** Strip anything resembling a filesystem path or an Engraph API key from an
 *  error message before it is logged, persisted, or returned via the API. */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/eg_[a-f0-9]+/gi, '<redacted>')
    .replace(/(\/[^\s"']+)/g, '<path>')
    .slice(0, 300);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('could not allocate a free port'));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// EngraphManager
// ---------------------------------------------------------------------------

export interface EngraphManagerDeps {
  configStore?: EngraphManagerConfigStore;
  spawnFn?: typeof spawn;
  execFileImpl?: ExecFileImpl;
  fetchImpl?: typeof fetch;
  discover?: (pathEnv?: string) => EngraphBinaryCandidate[];
  homeDir?: string;
}

export class EngraphManager {
  private readonly store: EngraphManagerConfigStore;
  private readonly spawnFn: typeof spawn;
  private readonly execFileImpl: ExecFileImpl;
  private readonly fetchImpl: typeof fetch;
  private readonly discoverFn: (pathEnv?: string) => EngraphBinaryCandidate[];
  private readonly homeDirOverride?: string;

  /** The exact ChildProcess this manager spawned — the only thing it will
   *  ever stop. Never derived from an external PID/port/name. */
  private child: ChildProcess | null = null;
  private childPid: number | null = null;
  private port: number | null = null;
  /** Generated fresh on every (re)start; never persisted. */
  private apiKey: string | null = null;
  private version: string | null = null;
  /** True only once a real authenticated 1s search has succeeded post-spawn. */
  private ready = false;
  private inFlight: Promise<{ ok: boolean; reason?: string }> | null = null;

  constructor(deps: EngraphManagerDeps = {}) {
    this.store = deps.configStore ?? new EngraphManagerConfigStore();
    this.spawnFn = deps.spawnFn ?? spawn;
    this.execFileImpl = deps.execFileImpl ?? (execFileAsync as unknown as ExecFileImpl);
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.discoverFn = deps.discover ?? discoverEngraphCandidates;
    this.homeDirOverride = deps.homeDir;
  }

  private engraphHomeDir(): string {
    return (
      this.homeDirOverride ??
      process.env.RHYTHM_ENGRAPH_HOME_DIR ??
      path.join(homedir(), 'Library', 'Application Support', 'Rhythm', 'engraph-home')
    );
  }

  getStatus(): EngraphManagerStatus {
    const cfg = this.store.read();
    return {
      enabled: cfg.enabled,
      state: cfg.state,
      executablePath: cfg.executablePath,
      discoverySource: cfg.discoverySource,
      version: this.version,
      approvedMemoryRoot: cfg.approvedMemoryRoot,
      engraphHomeDir: this.engraphHomeDir(),
      lastHealthyAt: cfg.lastHealthyAt,
      lastFailureCategory: cfg.lastFailureCategory,
      lastFailureMessage: cfg.lastFailureMessage,
    };
  }

  discover(): EngraphBinaryCandidate[] {
    return this.discoverFn();
  }

  /** Validate a user-selected binary path and persist it ONLY if valid. */
  async chooseBinary(candidatePath: string): Promise<{ ok: boolean; reason?: string }> {
    const result = await validateEngraphBinary(candidatePath, this.execFileImpl);
    if (!result.ok) {
      this.store.write({
        state: 'error',
        lastFailureCategory: 'binary_invalid',
        lastFailureMessage: `selected executable failed validation (${result.reason ?? 'unknown'})`,
      });
      return { ok: false, reason: result.reason };
    }
    this.version = result.version ?? null;
    this.store.write({
      executablePath: realpathSync(candidatePath),
      discoverySource: 'user-selected',
      state: 'discovering',
      lastFailureCategory: null,
      lastFailureMessage: null,
    });
    return { ok: true };
  }

  /** Persist a discovered (not user-typed) candidate — same validation path. */
  async chooseDiscovered(candidate: EngraphBinaryCandidate): Promise<{ ok: boolean; reason?: string }> {
    const result = await this.chooseBinary(candidate.path);
    if (result.ok) this.store.write({ discoverySource: candidate.source });
    return result;
  }

  async enable(): Promise<{ ok: boolean; reason?: string }> {
    this.store.write({ enabled: true });
    return this.ensureStarted();
  }

  async disable(): Promise<void> {
    await this.stopManagedProcess();
    this.store.write({ enabled: false, state: 'disabled' });
  }

  async retry(): Promise<{ ok: boolean; reason?: string }> {
    return this.ensureStarted();
  }

  async rebuild(): Promise<{ ok: boolean; reason?: string }> {
    await this.stopManagedProcess();
    return this.ensureStarted({ rebuild: true });
  }

  /** Non-blocking startup hook — fire-and-forget, never awaited by boot. */
  ensureStartedIfEnabled(): void {
    const cfg = this.store.read();
    if (cfg.enabled && cfg.executablePath) {
      this.ensureStarted().catch((err) => {
        logger.warn(`[EngraphManager] startup ensureStarted failed (non-fatal): ${sanitizeErrorMessage(err)}`);
      });
    }
  }

  /** Real authenticated 1-second-budget search — the ONLY thing that can mark
   *  the managed service healthy. Process/port existence is never enough. */
  async checkHealthNow(): Promise<EngraphHealthResult> {
    if (!this.port || !this.apiKey) {
      this.ready = false;
      return { ok: false, category: 'health_check_failed', message: 'no managed service is running' };
    }
    const startedAt = Date.now();
    try {
      const response = await this.fetchImpl(`http://127.0.0.1:${this.port}/api/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query: HEALTH_PROBE_QUERY, top_n: 1 }),
        signal: AbortSignal.timeout(HEALTH_CHECK_BUDGET_MS),
      });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        this.ready = false;
        const category: EngraphFailureCategory =
          response.status === 401 || response.status === 403 ? 'permission_denied' : 'health_check_failed';
        return { ok: false, category, message: `search responded ${response.status}`, latencyMs };
      }
      const body: unknown = await response.json();
      const isArrayShaped =
        Array.isArray(body) ||
        (!!body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results));
      if (!isArrayShaped) {
        this.ready = false;
        return { ok: false, category: 'health_check_failed', message: 'malformed search response', latencyMs };
      }
      this.ready = true;
      this.store.write({ lastHealthyAt: new Date().toISOString() });
      return { ok: true, latencyMs };
    } catch (err) {
      this.ready = false;
      const name = (err as { name?: string } | undefined)?.name;
      const category: EngraphFailureCategory = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'health_check_failed';
      return { ok: false, category, message: sanitizeErrorMessage(err) };
    }
  }

  /**
   * The client fed to memory_retrieval.ts. Returns a client pointed at the
   * managed, authenticated loopback service ONLY once this manager is enabled
   * and has passed a real health check. Otherwise falls back to a plain
   * `new EngraphHttpClient()` — the pre-existing #1093/#1095 operator-managed
   * client, which reads `ENGRAPH_MEMORY_URL` and fails closed to `[]` when
   * that's unset. This makes the manager purely ADDITIVE: an operator who
   * never turns the manager on (its default state) gets byte-for-byte the
   * same behavior as before this feature existed, while an unavailable/
   * unhealthy managed service is indistinguishable, from the retrieval seam's
   * point of view, from Engraph being absent — the existing FTS fallback
   * always wins either way.
   */
  getRetrievalClient(): EngraphClient {
    if (!this.ready || !this.port || !this.apiKey) return new EngraphHttpClient();
    return new EngraphHttpClient(`http://127.0.0.1:${this.port}`, this.fetchImpl, 1_000, this.apiKey);
  }

  // -- lifecycle internals ---------------------------------------------------

  private async ensureStarted(opts: { rebuild?: boolean } = {}): Promise<{ ok: boolean; reason?: string }> {
    if (this.inFlight) return this.inFlight;
    const run = this._doStart(opts).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async _doStart(opts: { rebuild?: boolean }): Promise<{ ok: boolean; reason?: string }> {
    const cfg = this.store.read();
    if (!cfg.enabled) return { ok: false, reason: 'disabled' };
    if (!cfg.executablePath || !isExecutableFile(cfg.executablePath)) {
      return this._fail('binary_not_found', 'no valid Engraph executable is configured');
    }

    let approvedRoot: string;
    try {
      approvedRoot = resolveApprovedMemoryRoot();
    } catch (err) {
      return this._fail('permission_denied', `could not resolve the agent-memory directory: ${sanitizeErrorMessage(err)}`);
    }
    const home = this.engraphHomeDir();
    this.store.write({ approvedMemoryRoot: approvedRoot, state: 'indexing' });

    try {
      mkdirSync(path.join(home, '.engraph'), { recursive: true });
    } catch (err) {
      return this._fail('permission_denied', `could not create the Rhythm-only Engraph home: ${sanitizeErrorMessage(err)}`);
    }

    // Fresh port + credentials every (re)start; never persisted to disk in
    // Rhythm's own config store (only into Engraph's own config.toml, under
    // the Rhythm-only HOME, mode 0600).
    let port: number;
    try {
      port = await findFreePort();
    } catch (err) {
      return this._fail('spawn_failed', `could not allocate a loopback port: ${sanitizeErrorMessage(err)}`);
    }
    const apiKey = `eg_${randomBytes(24).toString('hex')}`;
    this._writeEngraphConfig(home, approvedRoot, port, apiKey);

    try {
      await this._runIndex(cfg.executablePath, home, approvedRoot, opts.rebuild === true);
    } catch (err) {
      return this._fail('index_failed', `indexing the agent-memory directory failed: ${sanitizeErrorMessage(err)}`);
    }

    this.store.write({ state: 'starting' });
    this.port = port;
    this.apiKey = apiKey;
    try {
      await this._spawnServe(cfg.executablePath, home, port);
    } catch (err) {
      this.port = null;
      this.apiKey = null;
      return this._fail('spawn_failed', `failed to start the managed service: ${sanitizeErrorMessage(err)}`);
    }

    const health = await this._waitForHealthy(STARTUP_HEALTH_TIMEOUT_MS);
    if (!health.ok) {
      await this.stopManagedProcess();
      return this._fail(health.category ?? 'health_check_failed', health.message ?? 'health check failed');
    }
    this.store.write({ state: 'ready', lastFailureCategory: null, lastFailureMessage: null });
    return { ok: true };
  }

  /**
   * Poll the strict 1s-budget health check on a fixed interval until it
   * passes or `deadlineMs` elapses. Only retries connection-level failures
   * (`health_check_failed`/`timeout` — plausibly the process still starting
   * up); a `permission_denied` or other categorized failure returns
   * immediately, since waiting cannot fix a real auth/config problem.
   */
  private async _waitForHealthy(deadlineMs: number): Promise<EngraphHealthResult> {
    const deadline = Date.now() + deadlineMs;
    let last: EngraphHealthResult = { ok: false, category: 'health_check_failed', message: 'not checked yet' };
    for (;;) {
      last = await this.checkHealthNow();
      if (last.ok) return last;
      if (last.category !== 'health_check_failed' && last.category !== 'timeout') return last;
      if (Date.now() >= deadline) return last;
      await new Promise((resolve) => setTimeout(resolve, STARTUP_HEALTH_POLL_MS));
    }
  }

  private _fail(category: EngraphFailureCategory, message: string): { ok: false; reason: string } {
    this.ready = false;
    this.store.write({ state: 'error', lastFailureCategory: category, lastFailureMessage: message });
    logger.warn(`[EngraphManager] ${message}`);
    return { ok: false, reason: category };
  }

  private _writeEngraphConfig(home: string, vaultPath: string, port: number, apiKey: string): void {
    const configDir = path.join(home, '.engraph');
    mkdirSync(configDir, { recursive: true });
    const toml = [
      `vault_path = ${JSON.stringify(vaultPath)}`,
      'top_n = 10',
      'exclude = [".obsidian/", "node_modules/", ".git/"]',
      'intelligence = false',
      '',
      '[http]',
      `port = ${port}`,
      'host = "127.0.0.1"',
      'rate_limit = 60',
      '',
      '[[http.api_keys]]',
      `key = ${JSON.stringify(apiKey)}`,
      'name = "rhythm"',
      'permissions = "read"',
      '',
    ].join('\n');
    const configPath = path.join(configDir, 'config.toml');
    writeFileSync(configPath, toml, { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(configPath, 0o600);
    } catch {
      /* best-effort on non-posix */
    }
  }

  private async _runIndex(binary: string, home: string, vaultPath: string, rebuild: boolean): Promise<void> {
    const args = rebuild ? ['index', vaultPath, '--rebuild'] : ['index', vaultPath];
    // Fixed argv, no shell — execFile never invokes a shell to interpret args.
    await this.execFileImpl(binary, args, {
      timeout: INDEX_TIMEOUT_MS,
      env: { HOME: home, PATH: process.env.PATH ?? '' },
    });
  }

  private _spawnServe(binary: string, home: string, port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = this.spawnFn(binary, [
        'serve', '--http', '--read-only',
        '--port', String(port),
        '--host', '127.0.0.1',
      ], {
        // Rhythm-only HOME sandbox: Engraph resolves ALL of its own state
        // (config.toml, sqlite db, models) under `$HOME/.engraph` — pointing
        // HOME at our own Application Support subdir means the real
        // `~/.engraph` is never read, written, or migrated.
        env: { HOME: home, PATH: process.env.PATH ?? '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      this.childPid = child.pid ?? null;

      let settled = false;
      const onError = (err: Error) => {
        if (settled) return;
        settled = true;
        this.child = null;
        this.childPid = null;
        reject(err);
      };
      child.once('error', onError);
      child.once('exit', (code, signal) => {
        logger.info(`[EngraphManager] managed engraph process exited (code=${code} signal=${signal})`);
        if (this.child === child) {
          this.child = null;
          this.childPid = null;
          this.ready = false;
        }
      });

      // Readiness is proven by the subsequent authenticated health check, not
      // by parsing stdout — just confirm the process didn't immediately die.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        child.removeListener('error', onError);
        resolve();
      }, 300);
    });
  }

  /**
   * Stop ONLY the exact ChildProcess this manager spawned. If `this.child` is
   * absent (nothing running, or ownership already released) this is a no-op
   * — there is no fallback path that looks up a process by port or name, so
   * an unrelated process can never be affected (anti-#1124 guarantee).
   */
  private async stopManagedProcess(): Promise<void> {
    const child = this.child;
    if (!child || child.pid !== this.childPid) {
      this.child = null;
      this.childPid = null;
      this.ready = false;
      this.port = null;
      this.apiKey = null;
      return;
    }
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      child.once('exit', finish);
      try {
        child.kill('SIGTERM');
      } catch {
        finish();
        return;
      }
      const escalate = setTimeout(() => {
        if (done) return;
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        finish();
      }, STOP_GRACE_MS);
      escalate.unref?.();
    });
    this.child = null;
    this.childPid = null;
    this.ready = false;
    this.port = null;
    this.apiKey = null;
  }

  /** Best-effort synchronous stop for server shutdown — same ownership guard
   *  as stopManagedProcess, without waiting for exit confirmation. */
  shutdown(): void {
    const child = this.child;
    if (!child || child.pid !== this.childPid) return;
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    this.child = null;
    this.childPid = null;
    this.ready = false;
  }
}

export const engraphManager = new EngraphManager();
