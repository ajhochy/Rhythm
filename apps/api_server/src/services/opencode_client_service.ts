import { homedir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createHmac, randomBytes } from 'node:crypto';
import { promisify } from 'util';
import type { OpencodeClient, RhythmEvent as Event } from '@opencode-ai/sdk';
import { logger } from '../utils/logger';
import { OpencodeAuthStore } from './opencode_auth_store';
import { AppError } from '../errors/app_error';
import {
  CURATED_MCP_SERVERS,
  type CuratedMcpServer,
  type CuratedTokenProvider,
} from '../config/curated_mcp_servers';
import { ensureGeminiProjectConfig, ensureGeminiProjectEnv } from './gemini_project_config';
import { expandMcpAllowlist } from './mcp_allowlist_expander';
import { capMcpAllowlistForProvider, geminiUnscopedDeferredAllowlist } from './gemini_tool_cap';
import {
  applySelectiveDeferral,
  toolCountsForRoleConfig,
} from './tool_surface_estimator';
import { isUntitledSessionName, type AgentSession, type PermissionMode } from '../models/agent_session';
import {
  ensureOmlxProviderConfig,
  detectAndUnloadCompetingOllamaModel,
} from './local_omlx_provider';
import { env, resolveWebsearchConfig } from '../config/env';
import {
  clearTrustedMcpVerifier,
  initializeTrustedMcpVerifier,
} from '../security/trusted_mcp_call';
import type { DispatchInput } from '../models/model_provenance';
import { getDb } from '../database/db';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { isCoordinatorCallbackProvenance } from '../contracts/coordinator_callback_marker';
import type { AuthContext } from '../middleware/auth_middleware';
import type {
  ManagedContextReference,
  ManagedContextScope,
  ManagedWorkstreamContextRepository,
} from '../repositories/managed_workstream_context_repository';
import { hasManagedSdkSessionHistory } from '../repositories/managed_workstream_context_repository';
import { hasDayflowSdkSessionHistory } from '../repositories/dayflow_receiving_context_repository';
import type { DayflowSdkHistoryGuard } from './dayflow_receiving_history_guard';
import { CODING_WORKFLOW_DISPATCH_REASON } from '../contracts/coordinator_conversation_contract';
import {
  ENROLLMENT_REQUEST_BODY,
  PROVIDER_ADMISSION_BOUNDS,
  parseEnrollmentResponse,
  parseProviderFrameExportText,
  type ProviderPendingExport,
  type ProviderUnavailableExport,
} from '../contracts/dayflow_provider_admission_contract';

const modelProvenanceRepo = new ModelProvenanceRepository();

function beginDispatch(input?: DispatchInput): string | undefined {
  if (!input) return undefined;
  try {
    return modelProvenanceRepo.insert(input).id;
  } catch (err) {
    logger.warn('[OpencodeClientService] provenance pending write failed (non-fatal):', err);
    return undefined;
  }
}

function settleDispatch(id: string | undefined, outcome: 'accepted' | 'rejected' | 'unknown'): void {
  if (!id) return;
  try {
    modelProvenanceRepo.setOutcome(id, outcome);
  } catch (err) {
    logger.warn('[OpencodeClientService] provenance outcome write failed (non-fatal):', err);
  }
}

type ManagedSdkSessionBoundary =
  | 'fresh'
  | 'managed_history'
  | 'unavailable'
  | 'outside_local_ledger_scope';

/**
 * Strict, read-only engine evidence for capacity admission.  Unlike the
 * ordinary status/question/permission convenience wrappers, `available`
 * means every transport returned a successful, schema-complete response.
 * It contains identifiers only—never messages, history, capture, or result
 * text—and exists solely to distinguish the engine's documented idle-map
 * omission from a failed observation.
 */
export interface BoundSessionLifecycleInspection {
  available: boolean;
  knownSessionIds: string[];
  statusBySessionId: Record<string, { type: string }>;
  pendingQuestionSessionIds: string[];
  pendingPermissionSessionIds: string[];
}

function completeSessionStatusMap(value: unknown): value is Record<string, { type: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([id, status]) =>
    id.length > 0 && !!status && typeof status === 'object' && !Array.isArray(status) &&
    typeof (status as Record<string, unknown>).type === 'string',
  );
}

function completeLifecycleSessionIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const sessionID = (entry as Record<string, unknown>).sessionID;
    if (typeof sessionID !== 'string' || sessionID.trim().length === 0) return null;
    ids.push(sessionID);
  }
  return ids;
}

/**
 * A managed enrollment is a permanent nonreuse boundary for an SDK session.
 * This read is intentionally independent of the managed feature flag: turning
 * the feature off later must not let ordinary SQLite chat replay retained
 * managed history. In a non-SQLite deployment, this local ledger has no
 * authority to classify a session as fresh or managed; ordinary hosted calls
 * remain on their existing authorization and upstream-validation path, while
 * an explicitly managed dispatch must separately require local SQLite.
 */
function managedSdkSessionBoundary(
  sdkSessionId: string,
  exceptDispatchId?: string,
): ManagedSdkSessionBoundary {
  if (env.dbClient !== 'sqlite') return 'outside_local_ledger_scope';
  try {
    return hasManagedSdkSessionHistory(getDb(), sdkSessionId, exceptDispatchId)
      ? 'managed_history'
      : 'fresh';
  } catch {
    return 'unavailable';
  }
}

function managedSdkSessionBoundaryReason(
  boundary: Extract<ManagedSdkSessionBoundary, 'managed_history' | 'unavailable'>,
): string {
  switch (boundary) {
    case 'managed_history':
      return 'persisted managed-worker history forbids reuse';
    case 'unavailable':
      return 'the local managed-session ledger is unavailable';
  }
}

function ordinarySdkSessionMayUseHistory(
  boundary: ManagedSdkSessionBoundary,
): boundary is 'fresh' | 'outside_local_ledger_scope' {
  return boundary === 'fresh' || boundary === 'outside_local_ledger_scope';
}

/**
 * Explicit managed dispatch is only supported by the local SQLite ledger.
 * Consult the actual deployment mode, rather than caller-supplied policy, so
 * a managed request cannot relabel a PostgreSQL process as locally qualified.
 */
function assertManagedSdkSessionMayBeExposed(
  sdkSessionId: string,
  exceptDispatchId?: string,
): void {
  if (env.dbClient !== 'sqlite') {
    throw new Error('managed SDK session requires local SQLite coordinator execution');
  }
  const boundary = managedSdkSessionBoundary(sdkSessionId, exceptDispatchId);
  if (boundary === 'fresh') return;
  if (boundary === 'managed_history' || boundary === 'unavailable') {
    throw new Error(managedSdkSessionBoundaryReason(boundary));
  }
  throw new Error('managed SDK session requires local SQLite coordinator execution');
}

/**
 * Session operations that infer from, mutate, or copy retained engine history
 * share the permanent managed-session nonreuse boundary with prompt paths.
 * The second call immediately adjacent to a native forward deliberately
 * re-reads durable state after any intervening preparation.
 */
function assertOrdinarySdkSessionMayUseHistoryOperation(
  sdkSessionId: string,
  operation: string,
): void {
  const boundary = managedSdkSessionBoundary(sdkSessionId);
  if (ordinarySdkSessionMayUseHistory(boundary)) return;
  throw AppError.reconciliationRequired(
    `${operation} is withheld because ${managedSdkSessionBoundaryReason(boundary)}`,
  );
}

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
export const KEYLESS_PROVIDER_IDS = new Set(['ollama', 'omlx', 'opencode']);
const providerDigestKey = randomBytes(32);

export type ProviderSnapshot = {
  providers: Array<{
    id: string;
    connected: boolean;
    source?: 'env' | 'config' | 'custom' | 'api';
    endpoint?: string;
    digest: string;
    models: Array<{
      id: string;
      name?: string;
      apiId?: string;
      status?: string;
      contextLimit?: number;
      /** USD per 1M tokens, straight from the engine catalog (absent when unpriced). */
      cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
      releaseDate?: string;
      family?: string;
      reasoning?: boolean;
      capabilities?: {
        input?: { text?: boolean };
        output?: { text?: boolean };
        toolcall?: boolean;
      };
    }>;
  }>;
  defaults: Record<string, string>;
};

/** Resolve the engine port once so the SDK, stale-port reclaim, and PTY proxy agree. */
export function resolveOpencodeEnginePort(): number {
  const raw = process.env.RHYTHM_OPENCODE_ENGINE_PORT?.trim();
  if (!raw) return 4096;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `RHYTHM_OPENCODE_ENGINE_PORT must be an integer between 1 and 65535; received "${raw}".`,
    );
  }
  return port;
}

/** Exact renderer origins inherited by the engine's CORS configuration. */
export function resolveOpencodeCorsOrigins(raw = process.env.RHYTHM_LOCAL_RENDERER_ORIGINS): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))];
}

export function resolveOpencodeStartupTimeout(
  raw = process.env.RHYTHM_OPENCODE_STARTUP_TIMEOUT_MS,
): number | undefined {
  if (!raw?.trim()) return undefined;
  const timeout = Number(raw);
  if (!Number.isInteger(timeout) || timeout < 5_000 || timeout > 60_000) {
    throw new Error(
      `RHYTHM_OPENCODE_STARTUP_TIMEOUT_MS must be an integer between 5000 and 60000; received "${raw}".`,
    );
  }
  return timeout;
}

export function buildOpencodeServerOptions(
  port: number,
  cors: string[],
  timeout?: number,
): { port: number; cors?: string[]; timeout?: number } {
  return {
    port,
    ...(cors.length > 0 ? { cors } : {}),
    ...(timeout === undefined ? {} : { timeout }),
  };
}

/** TCP port used by this api_server process's bundled opencode engine. */
export const OPENCODE_ENGINE_PORT = resolveOpencodeEnginePort();

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
 * #1096/#1574-adjacent process-lifecycle fix — is `pid` the leader of its own
 * process group? `ps -o pgid=` prints the group id; a detached-spawned engine
 * (see the SDK's `createOpencodeServer`) has pgid === pid. Only then is a
 * negative-pid signal (`kill(-pid)`) guaranteed to hit exactly that engine's
 * own descendants (e.g. its `engraph` MCP children) — never a coincidental,
 * unrelated group. Exported and pure (parses ps text, no process access) so
 * it can be unit-tested against a real captured `ps` line.
 */
export function isProcessGroupLeader(pid: number, psPgidOutput: string): boolean {
  const pgid = Number(psPgidOutput.trim());
  return Number.isInteger(pgid) && pgid === pid;
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
    // Process-lifecycle fix: a stale opencode engine found squatting on our
    // port (e.g. reparented to launchd after a Force-Quit / SIGKILL) may
    // still be dragging its own `engraph` MCP children along. If it's the
    // leader of its own process group — true for every engine spawned since
    // this fix (createOpencodeServer now spawns `detached: true`) — signal
    // the whole group so those children are reclaimed too, not just the
    // engine itself. Never guess: only act on a verified pgid === pid match.
    try {
      const pgidOut = await runCommand('ps', ['-o', 'pgid=', '-p', String(pid)]);
      if (isProcessGroupLeader(pid, pgidOut)) {
        try {
          process.kill(-pid, signal as NodeJS.Signals);
          return;
        } catch {
          // Fall through to the plain single-pid kill below.
        }
      }
    } catch {
      // ps failed (pid already gone, etc.) — fall through to the plain kill,
      // which itself no-ops harmlessly on ESRCH.
    }
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
 * #1332 — pin the engine to its stable session store (see the call site in
 * `_initializeImpl` for the full rationale and the measured session counts).
 *
 * Exported and env-injectable purely so this is testable without spawning an
 * engine: the behaviour it guards — "a test build must not orphan real
 * conversations" — is data integrity, not a preference.
 *
 * Idempotent, and never overrides an explicit choice: a caller that has already
 * set `OPENCODE_DISABLE_CHANNEL_DB` (e.g. `=0` to deliberately restore
 * per-branch stores) keeps it, and `OPENCODE_DB` is honoured ahead of this flag
 * by the engine itself, so a sandbox naming its own file always wins.
 */
export function pinEngineSessionStore(
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.OPENCODE_DISABLE_CHANNEL_DB ??= '1';
}

/**
 * #1178 — Rhythm transcript sharing is strictly in-instance. Force the child
 * engine's external share path off even when the parent shell opted into
 * OpenCode auto-share or attempted to override the disable flag.
 */
export function disableEngineExternalSharing(
  env: NodeJS.ProcessEnv = process.env,
): void {
  delete env.OPENCODE_AUTO_SHARE;
  env.OPENCODE_DISABLE_SHARE = '1';
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

/**
 * Internal-only authority for the coordinator's already authenticated,
 * persisted finite consent. It intentionally cannot carry a bearer or be
 * decoded from an HTTP body. The coordinator creates this capability from an
 * exact durable one-shot plan or conversation control/native binding, and this
 * service invokes it at every managed prompt boundary.
 */
export interface PersistedManagedConsentAuthority {
  readonly kind: 'one_shot_workstream' | 'finite_conversation_workstream';
  readonly actorUserId: number;
  validate(input: {
    phase: 'prepare' | 'before_sdk' | 'sdk_exposure';
    scope: Omit<ManagedContextScope, 'dispatchId' | 'sdkTurnId'>;
    workerJobId: string | undefined;
  }): boolean | Promise<boolean>;
}

export interface ManagedPromptDispatchContext {
  /** Existing interactive managed path; unchanged when present. */
  auth?: AuthContext;
  /** Narrow saved-consent capability for exactly one coordinator worker. */
  persistedConsent?: PersistedManagedConsentAuthority;
  scope: Omit<ManagedContextScope, 'dispatchId' | 'sdkTurnId'>;
  records: Pick<ManagedWorkstreamContextRepository, 'append' | 'enroll' | 'markUnsafe' | 'read'>;
  policy: {
    enabled(): boolean;
    dbClient: 'sqlite' | 'postgres';
    role: 'all' | 'local' | 'cloud' | 'relay';
    currentHostEpoch(): string | null;
  };
  captureReady: boolean;
  /** Required for the only supported managed child shape. */
  workerJobId?: string;
  /**
   * Runs after the dispatch + managed enrollment are durable, but before the
   * SDK prompt can leave this process.  The coordinator uses this to bind the
   * minted engine anchor to its existing native-ledger row.
   */
  onPrepared?: (binding: {
    scope: ManagedContextScope;
    dispatchId: string;
    sdkUserMessageId: string;
  }) => void;
  /** Identifier-only dependencies that must be durable before prompt exposure. */
  initialReferences?: ManagedContextReference[];
}

/**
 * Internal-only binding for one authenticated C2 foreground command.  It is
 * deliberately narrower than managed worker authority: it cannot carry a
 * tool, a workspace path, a permission rule, or a model override.  The
 * composed server creates it from the durable command reservation and checks
 * the live owner/root/project/profile binding again at every await boundary.
 */
export interface CoordinatorForegroundPromptDispatchContext {
  readonly kind: 'coordinator_foreground_v1';
  readonly actorUserId: number;
  readonly localSessionId: string;
  readonly sdkSessionId: string;
  readonly projectId: string;
  readonly profileId: string;
  /** Durable C2 control epoch captured with the reserved command. */
  readonly controlRevision: number;
  readonly commandKey: string;
  validate(input: {
    phase: 'prepare' | 'before_sdk' | 'sdk_exposure';
    dispatchId?: string;
    sdkUserMessageId?: string;
  }): boolean | Promise<boolean>;
}

/**
 * Internal-only freshness hook for the exact child-completion callback. It is
 * not authority and carries no capability: the completion service passes the
 * recheck of the overlay it attached, and the client runs it after the LAST
 * await before SDK exposure. Valid only with the exact callback provenance.
 */
export interface CoordinatorCallbackPromptDispatchContext {
  readonly kind: 'coordinator_callback_v1';
  validate(): boolean | Promise<boolean>;
}

function isCoordinatorForegroundPromptContext(
  value: CoordinatorForegroundPromptDispatchContext | undefined,
  sessionId: string,
  provenance: DispatchInput | undefined,
): value is CoordinatorForegroundPromptDispatchContext {
  return Boolean(
    value &&
    value.kind === 'coordinator_foreground_v1' &&
    Number.isSafeInteger(value.actorUserId) && value.actorUserId > 0 &&
    typeof value.localSessionId === 'string' && value.localSessionId.length > 0 &&
    typeof value.sdkSessionId === 'string' && value.sdkSessionId === sessionId &&
    typeof value.projectId === 'string' && value.projectId.length > 0 &&
    typeof value.profileId === 'string' && value.profileId.length > 0 &&
    Number.isSafeInteger(value.controlRevision) && value.controlRevision > 0 &&
    typeof value.commandKey === 'string' && value.commandKey.length > 0 &&
    typeof value.validate === 'function' &&
    provenance &&
    provenance.sessionId === value.localSessionId &&
    provenance.sdkSessionId === sessionId &&
    provenance.origin === 'prompt_api' &&
    provenance.requestedSource === 'session' &&
    provenance.routeAuthed === true
  );
}

/**
 * Internal-only context for the ONE approved coordinator-goal retry wake. It is
 * a distinct kind, never a promoted foreground/callback/managed context and
 * never authority by itself: the client mints the request's native user-message
 * id, persists the exact dispatch row with it before SDK exposure and puts the
 * SAME id in the SDK body, so a later signed tool call can be joined to this
 * request by identity instead of by heuristic late linkage. `validate` is the
 * producer's SYNCHRONOUS current-fingerprint check (decision, action/digest,
 * goal revision, root/profile/owner/project/SDK, taint, controls); it must not
 * await and is invoked again immediately before the SDK call.
 */
export interface CoordinatorApprovalResumePromptDispatchContext {
  readonly kind: 'coordinator_goal_approval_resume_v1';
  validate(): boolean;
}

/** Same literal shape the repository's consumer recomputes (53 chars, legal reason code). */
const APPROVAL_RESUME_REASON_CODE = /^goal_approval_resume_[0-9a-f]{32}$/;

function isCoordinatorApprovalResumePromptContext(
  value: CoordinatorApprovalResumePromptDispatchContext | undefined,
  sessionId: string,
  provenance: DispatchInput | undefined,
): value is CoordinatorApprovalResumePromptDispatchContext {
  return Boolean(
    value &&
    value.kind === 'coordinator_goal_approval_resume_v1' &&
    typeof value.validate === 'function' &&
    typeof sessionId === 'string' && sessionId.length > 0 &&
    provenance &&
    provenance.sdkSessionId === sessionId &&
    provenance.origin === 'approval_continuation' &&
    provenance.requestedSource === 'agent_config' &&
    provenance.routeAuthed == null &&
    typeof provenance.reasonCode === 'string' &&
    APPROVAL_RESUME_REASON_CODE.test(provenance.reasonCode),
  );
}

/**
 * Internal-only typed context for ONE Coding Workflow async child (G2 first
 * adapter). It is a distinct kind, never promoted from a foreground, callback,
 * managed or approval-resume context and never authority by itself: the client
 * mints the real native user-message id, persists the exact dispatch row with it
 * BEFORE the SDK request, hands that identity to `onPrepared` synchronously, and
 * exports the delivery outcome. A thrown transport error is delivery `unknown`
 * (the engine may have enqueued it), not `rejected`.
 */
export interface CodingWorkflowPromptDispatchContext {
  readonly kind: 'coding_workflow_dispatch_v1';
  validate(input: {
    phase: 'prepare' | 'before_sdk' | 'sdk_exposure';
    dispatchId?: string;
    sdkUserMessageId?: string;
  }): boolean | Promise<boolean>;
  /** Synchronous freshness proof, run after the last await and immediately before the SDK call. */
  isCurrent(): boolean;
  /** Durable pre-SDK receipt. Returning anything but true holds the request. */
  onPrepared(binding: { dispatchId: string; sdkUserMessageId: string }): boolean;
  /** Exactly once, only after the SDK request was attempted. */
  onOutcome(outcome: { delivery: 'accepted' | 'unknown' | 'rejected'; dispatchId: string; sdkUserMessageId: string }): void;
}

function isCodingWorkflowPromptContext(
  value: CodingWorkflowPromptDispatchContext | undefined,
  sessionId: string,
  provenance: DispatchInput | undefined,
): value is CodingWorkflowPromptDispatchContext {
  return Boolean(
    value &&
    value.kind === 'coding_workflow_dispatch_v1' &&
    typeof value.validate === 'function' && typeof value.isCurrent === 'function' &&
    typeof value.onPrepared === 'function' && typeof value.onOutcome === 'function' &&
    provenance &&
    provenance.sdkSessionId === sessionId &&
    provenance.sessionId !== undefined && provenance.sessionId !== sessionId &&
    provenance.origin === 'delegation' &&
    provenance.requestedSource === 'agent_config' &&
    provenance.routeAuthed == null &&
    provenance.reasonCode === CODING_WORKFLOW_DISPATCH_REASON,
  );
}

/** A throwing validator is a refusal, never an exposure. */
function approvalResumeIsCurrent(context: CoordinatorApprovalResumePromptDispatchContext): boolean {
  try {
    return context.validate() === true;
  } catch {
    return false;
  }
}

async function coordinatorForegroundAuthorityIsCurrent(
  context: CoordinatorForegroundPromptDispatchContext,
  phase: 'prepare' | 'before_sdk' | 'sdk_exposure',
  binding?: { dispatchId: string; sdkUserMessageId: string },
): Promise<boolean> {
  try {
    return (await context.validate({ phase, ...binding })) === true;
  } catch {
    return false;
  }
}

async function managedAuthorityIsCurrent(
  managed: ManagedPromptDispatchContext,
  scope: Omit<ManagedContextScope, 'dispatchId' | 'sdkTurnId'>,
  phase: 'prepare' | 'before_sdk' | 'sdk_exposure',
): Promise<boolean> {
  // Never blend a saved capability with a bearer-backed path.  Either exact
  // authority shape may authorize a worker, but no caller can weaken one by
  // supplying a partial version of the other.
  if (Boolean(managed.auth) === Boolean(managed.persistedConsent)) return false;
  if (managed.auth) {
    return !!managed.auth.sessionToken && managed.auth.user.id === scope.ownerUserId;
  }
  const consent = managed.persistedConsent;
  if (
    !consent || (consent.kind !== 'one_shot_workstream' && consent.kind !== 'finite_conversation_workstream') ||
    !Number.isSafeInteger(consent.actorUserId) || consent.actorUserId !== scope.ownerUserId ||
    scope.role !== 'worker' || !managed.workerJobId
  ) return false;
  try {
    return (await consent.validate({ phase, scope, workerJobId: managed.workerJobId })) === true;
  } catch {
    return false;
  }
}

interface CurrentManagedDispatchRow {
  dispatch_id: string;
  dispatch_session_id: string;
  dispatch_sdk_session_id: string | null;
  sdk_user_message_id: string | null;
  route_authed: number | null;
  outcome: string;
  managed_context_schema_version: number | null;
  managed_context_owner_user_id: number | null;
  managed_context_project_id: string | null;
  managed_context_workstream_id: string | null;
  managed_context_workstream_revision: number | null;
  managed_context_role: string | null;
  managed_context_host_epoch: string | null;
  managed_context_sdk_session_id: string | null;
  managed_context_sdk_turn_id: string | null;
  session_owner_user_id: number;
  session_project_id: string;
  session_sdk_session_id: string | null;
  session_parent_session_id: string | null;
  workstream_owner_user_id: number;
  workstream_project_id: string;
  workstream_state: string;
  workstream_revision: number;
}

async function assertCurrentManagedPromptDispatch(
  managed: ManagedPromptDispatchContext,
  scope: ManagedContextScope,
  sdkUserMessageId: string,
  sdkSessionId: string,
): Promise<void> {
  const currentEpoch = managed.policy.currentHostEpoch();
  if (
    !managed.captureReady ||
    !managed.policy.enabled() ||
    managed.policy.dbClient !== 'sqlite' ||
    (managed.policy.role !== 'local' && managed.policy.role !== 'all') ||
    !(await managedAuthorityIsCurrent(managed, scope, 'before_sdk')) ||
    (scope.role !== 'parent' && scope.role !== 'worker') ||
    (scope.role === 'worker' && !managed.workerJobId) ||
    scope.sdkTurnId !== null ||
    scope.sdkSessionId !== sdkSessionId ||
    !currentEpoch ||
    scope.hostEpoch !== currentEpoch
  ) throw new Error('managed prompt scope unavailable');

  const rows = getDb().prepare(`SELECT
    d.id AS dispatch_id, d.session_id AS dispatch_session_id,
    d.sdk_session_id AS dispatch_sdk_session_id, d.sdk_user_message_id,
    d.route_authed, d.outcome, d.managed_context_schema_version,
    d.managed_context_owner_user_id, d.managed_context_project_id,
    d.managed_context_workstream_id, d.managed_context_workstream_revision,
    d.managed_context_role, d.managed_context_host_epoch,
    d.managed_context_sdk_session_id, d.managed_context_sdk_turn_id,
    s.owner_user_id AS session_owner_user_id, s.project_id AS session_project_id,
    s.sdk_session_id AS session_sdk_session_id,
    s.parent_session_id AS session_parent_session_id,
    w.owner_user_id AS workstream_owner_user_id,
    w.project_id AS workstream_project_id, w.state AS workstream_state,
    w.revision AS workstream_revision
    FROM agent_turn_dispatches d
    JOIN agent_sessions s ON s.id=d.session_id
    JOIN agent_workstreams w ON w.id=d.managed_context_workstream_id
    WHERE d.id=? LIMIT 2`).all(scope.dispatchId) as CurrentManagedDispatchRow[];
  if (rows.length !== 1) throw new Error('managed prompt scope unavailable');
  const row = rows[0];
  if (
    row.dispatch_id !== scope.dispatchId ||
    row.dispatch_session_id !== scope.sessionId ||
    row.dispatch_sdk_session_id !== sdkSessionId ||
    row.sdk_user_message_id !== sdkUserMessageId ||
    row.route_authed !== 1 ||
    row.outcome !== 'pending' ||
    row.managed_context_schema_version !== 1 ||
    row.managed_context_owner_user_id !== scope.ownerUserId ||
    row.managed_context_project_id !== scope.projectId ||
    row.managed_context_workstream_id !== scope.workstreamId ||
    row.managed_context_workstream_revision !== scope.workstreamRevision ||
    row.managed_context_role !== scope.role ||
    row.managed_context_host_epoch !== scope.hostEpoch ||
    row.managed_context_sdk_session_id !== scope.sdkSessionId ||
    row.managed_context_sdk_turn_id !== null ||
    row.session_owner_user_id !== scope.ownerUserId ||
    row.session_project_id !== scope.projectId ||
    row.session_sdk_session_id !== scope.sdkSessionId ||
    (scope.role === 'parent' && row.session_parent_session_id !== null) ||
    row.workstream_owner_user_id !== scope.ownerUserId ||
    row.workstream_project_id !== scope.projectId ||
    (row.workstream_state !== 'queued' && row.workstream_state !== 'running') ||
    row.workstream_revision !== scope.workstreamRevision ||
    managed.records.read(scope)?.state !== 'bound'
  ) throw new Error('managed prompt scope unavailable');

  if (scope.role === 'worker') {
    const bound = getDb().prepare(`SELECT id FROM agent_bridge_jobs
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND workstream_project_id=?
        AND workstream_revision=? AND host_epoch=?
        AND native_child_session_id=? AND native_child_sdk_session_id=?
        AND native_dispatch_id=? AND native_sdk_user_message_id=?
        AND state='running'
      LIMIT 2`).all(
      managed.workerJobId,
      scope.ownerUserId,
      scope.workstreamId,
      scope.projectId,
      scope.workstreamRevision,
      scope.hostEpoch,
      scope.sessionId,
      sdkSessionId,
      scope.dispatchId,
      sdkUserMessageId,
    ) as Array<{ id: string }>;
    if (bound.length !== 1) throw new Error('managed prompt scope unavailable');
  }
}

export interface ManagedActiveToolCall {
  sdkSessionId: string;
  assistantId: string;
  userMessageId: string;
  partId: string;
  toolCallId: string;
  toolKey: string;
  agentName: string;
  serverName: string;
  toolName: string;
}

export interface OpencodeEngineIdentity {
  version: string;
  pid: number;
  bootId: string;
}

/**
 * Interactive chat sessions spawn named Rhythm profiles only through
 * `rhythm_delegate_async`, which resolves the target profile's own scope. The
 * engine `task` tool stays open for `explore`/`general` fan-out (those inherit
 * the parent's scope). Session rules are evaluated after the agent's, and the
 * fork uses findLast, so these must be the LAST rules on the session — after
 * any mode rules, including bypassPermissions' `*: allow`.
 */
export const INTERACTIVE_TASK_PERMISSION = [
  { permission: 'task', pattern: '*', action: 'deny' },
  { permission: 'task', pattern: 'explore', action: 'allow' },
  { permission: 'task', pattern: 'general', action: 'allow' },
] as const;

/**
 * The coordinator's worker policy is intentionally a session policy rather
 * than a stored profile change.  Ordering matters: the engine uses the last
 * matching rule, so the precise read grants follow the catch-all deny.
 */
export const MANAGED_READ_ONLY_PERMISSION = [
  { permission: '*', pattern: '*', action: 'deny' },
  // Generic filesystem reads cannot be tied to a declared reference or
  // captured by the coordinator, so this minimum slice intentionally does
  // not grant read/glob/grep.  The one qualified read surface below is
  // captured before text reaches the model.
  // The engine sees composed MCP keys; the uncomposed form keeps a direct
  // engine/MCP integration from silently falling back to an approval prompt.
  { permission: 'rhythm_search_memory', pattern: '*', action: 'allow' },
  { permission: 'rhythm_rhythm_search_memory', pattern: '*', action: 'allow' },
] as const;

/**
 * Narrow internal-only session rules for a finite coordinator execution
 * authority. Ordinary callers cannot construct this through an HTTP payload.
 */
type FiniteExecutionPermissionRule = {
  permission: 'edit' | 'write' | 'bash' | 'external_directory' | '*';
  pattern: string;
  action: 'allow' | 'ask' | 'deny';
};

function validFiniteExecutionWorkspacePattern(pattern: string, directory: string | undefined): boolean {
  if (
    typeof directory !== 'string' || !isAbsolute(directory) || directory === sep ||
    resolve(directory) !== directory || isAbsolute(pattern) ||
    pattern.startsWith('~') || pattern.includes('..') || pattern.includes('\\') || pattern.includes('://') ||
    pattern !== relative(sep, resolve(sep, pattern))
  ) return false;
  const nativeWorkspaceRoot = relative(sep, directory);
  if (
    nativeWorkspaceRoot.length === 0 || nativeWorkspaceRoot === '..' ||
    nativeWorkspaceRoot.startsWith(`..${sep}`) || isAbsolute(nativeWorkspaceRoot) ||
    resolve(sep, nativeWorkspaceRoot) !== directory
  ) return false;
  const absolutePattern = resolve(sep, pattern);
  const inside = relative(directory, absolutePattern);
  return inside.length > 0 && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

function validFiniteExecutionPermissionRules(
  value: readonly FiniteExecutionPermissionRule[],
  directory: string | undefined,
): boolean {
  const baseline = new Set(['*:deny', 'bash:deny', 'external_directory:deny']);
  const seen = new Set<string>();
  let usable = false;
  for (const rule of value) {
    if (!rule || typeof rule.pattern !== 'string' || rule.pattern.length === 0 || rule.pattern.length > 512) return false;
    if (!['edit', 'write', 'bash', 'external_directory', '*'].includes(rule.permission)) return false;
    if (!['allow', 'ask', 'deny'].includes(rule.action)) return false;
    if (rule.permission === '*' || rule.permission === 'bash' || rule.permission === 'external_directory') {
      if (rule.pattern !== '*' || rule.action !== 'deny') return false;
      baseline.delete(`${rule.permission}:deny`);
      continue;
    }
    if (!validFiniteExecutionWorkspacePattern(rule.pattern, directory)) return false;
    const key = `${rule.permission}:${rule.pattern}:${rule.action}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (rule.action !== 'deny') usable = true;
  }
  return baseline.size === 0 && usable;
}

/** Same predicate as the async-delegation gate in agent_delegation_service.ts. */
export function isInteractiveChatSession(
  session: Pick<AgentSession, 'category' | 'isSystem' | 'scheduledTaskId'> | null | undefined,
): boolean {
  return !!session &&
    session.category === 'chat' &&
    !session.isSystem &&
    session.scheduledTaskId === null;
}

export class OpencodeClientService {
  private status: EngineStatus = 'uninitialized';
  private client: OpencodeClient | null = null;
  private server: OpencodeServerHandle | null = null;
  private error: Error | null = null;
  private authStore: Pick<OpencodeAuthStore, 'listAuthedProviders'> = new OpencodeAuthStore();
  private providerSnapshotPending?: Promise<ProviderSnapshot>;
  /** Set to true by the shutdown handler before dispose() is called. */
  private _shuttingDown = false;
  /** Installed only by the fully composed Dayflow server path. */
  private dayflowSdkHistoryGuard: DayflowSdkHistoryGuard | null = null;

  setDayflowSdkHistoryGuard(guard: DayflowSdkHistoryGuard | null): void {
    this.dayflowSdkHistoryGuard = guard;
  }

  private async maybeMintDayflowPromptAnchor(
    sdkSessionId: string,
    directory: string | undefined,
    provenance: DispatchInput | undefined,
    existingAnchor?: string,
  ): Promise<string | undefined> {
    // A missing optional Dayflow composition must preserve ordinary chat. If
    // it is composed but cannot mint a real engine anchor, the later tool call
    // is unavailable rather than inferred from a session id.
    if (!this.dayflowSdkHistoryGuard || provenance?.routeAuthed !== true) return undefined;
    try {
      if (!(await this.dayflowSdkHistoryGuard.shouldBindPrompt(sdkSessionId))) return undefined;
      // A C2 foreground dispatch already minted its exact native user-message
      // id. Reuse it so the Dayflow receiving manifest and C2 provenance bind
      // one real user turn rather than creating an unrelated second anchor.
      return existingAnchor ?? await this.mintPromptAnchor(sdkSessionId, directory) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Callback-only Dayflow anchor. `null` = no Dayflow receiver applies (no
   * guard composed, or it declines this root): unchanged ordinary behavior.
   * `'missing'` = a receiver applies but the engine could not mint the real
   * native user-message id (or the check threw): the caller must refuse.
   */
  private async mintCallbackDayflowAnchor(
    sdkSessionId: string,
    directory: string | undefined,
  ): Promise<string | null | 'missing'> {
    if (!this.dayflowSdkHistoryGuard) return null;
    try {
      if (!(await this.dayflowSdkHistoryGuard.shouldBindPrompt(sdkSessionId))) return null;
      return (await this.mintPromptAnchor(sdkSessionId, directory)) ?? 'missing';
    } catch {
      return 'missing';
    }
  }

  /**
   * One bounded read of the owned engine's pending provider frame (frozen C1
   * export). Disabled exports, any HTTP/parse failure, an oversized body or a
   * deadline overrun return null — never a synthetic frame. The caller proves
   * the echo against its own request.
   */
  async getDayflowProviderFrame(
    sdkSessionId: string,
    requestNonce: string,
    directory: string | undefined,
    sourceAnchorIds: readonly string[] = [],
  ): Promise<ProviderPendingExport | ProviderUnavailableExport | null> {
    const ownedUrl = this.status === 'ready' && this.client ? this.server?.url : undefined;
    if (process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS !== '1' || !ownedUrl || !sdkSessionId || !requestNonce) return null;
    if (sourceAnchorIds.length > PROVIDER_ADMISSION_BOUNDS.sourceAnchors) return null;
    const params: string[] = [];
    if (directory) params.push(`directory=${encodeURIComponent(directory)}`);
    if (sourceAnchorIds.length > 0) params.push(`sourceAnchorIds=${encodeURIComponent(JSON.stringify(sourceAnchorIds))}`);
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    try {
      const response = await fetch(
        `${ownedUrl}/session/${encodeURIComponent(sdkSessionId)}/rhythm-provider-frame/${encodeURIComponent(requestNonce)}${query}`,
        {
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(PROVIDER_ADMISSION_BOUNDS.exchangeDeadlineMs),
        },
      );
      if (!response.ok) return null;
      const parsed = parseProviderFrameExportText(await response.text());
      return parsed.ok ? parsed.value : null;
    } catch {
      return null;
    }
  }

  /**
   * Durable, idempotent, monotonic enrollment of an SDK in the owned engine's
   * guard record (frozen C1 route). Returns the engine generation only after
   * the exact echoed success; any other outcome is null (no body may follow).
   */
  async enrollDayflowGuard(
    sdkSessionId: string,
    directory: string | undefined,
  ): Promise<{ engineGeneration: string } | null> {
    const ownedUrl = this.status === 'ready' && this.client ? this.server?.url : undefined;
    if (process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS !== '1' || !ownedUrl || !sdkSessionId) return null;
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    try {
      const response = await fetch(
        `${ownedUrl}/session/${encodeURIComponent(sdkSessionId)}/rhythm-dayflow-guard${query}`,
        {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(ENROLLMENT_REQUEST_BODY),
          redirect: 'error',
          signal: AbortSignal.timeout(PROVIDER_ADMISSION_BOUNDS.exchangeDeadlineMs),
        },
      );
      if (!response.ok) return null;
      const parsed = parseEnrollmentResponse(JSON.parse(await response.text()), sdkSessionId);
      return parsed.ok ? { engineGeneration: parsed.value.engineGeneration } : null;
    } catch {
      return null;
    }
  }

  private async assertDayflowSdkHistoryMayBeReused(
    sdkSessionId: string,
    /** Only a typed current-root foreground/callback may load for a projected provider request. */
    projectedLoad = false,
  ): Promise<void> {
    if (env.dbClient !== 'sqlite') return;
    let hasHistory = false;
    try {
      hasHistory = hasDayflowSdkSessionHistory(getDb(), sdkSessionId);
    } catch (error) {
      // A pre-migration database has no Dayflow columns and therefore cannot
      // contain a durable Dayflow dependency. Any other DB failure is unknown
      // history and must block native SDK exposure.
      if (error instanceof Error && /no such column: dayflow_context_/iu.test(error.message)) return;
      throw AppError.reconciliationRequired(
        'SDK history is withheld because Dayflow dependency state is unreadable',
      );
    }
    if (!hasHistory) return;
    const guard = this.dayflowSdkHistoryGuard;
    if (guard && (await guard.revalidateBeforeSdk(sdkSessionId))) return;
    // Raw history is NOT reusable here. A typed current-root foreground/callback
    // may still enqueue into the owned engine so the native per-attempt provider
    // guard can project it, but only when the guard itself proves a readable
    // ledger and a durable native enrollment. This neither clears the sticky
    // marker nor changes any stored history; raw-history operations keep the
    // hold above.
    if (projectedLoad && guard?.revalidateForProjectedLoad && (await guard.revalidateForProjectedLoad(sdkSessionId))) return;
    throw AppError.reconciliationRequired(
      'SDK history is withheld because retained Dayflow evidence is unavailable or changed',
    );
  }

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

  /** Test-only seam that prevents provider snapshot tests from reading user auth files. */
  __setTestAuthedProviders(providers: string[]): void {
    this.authStore = { listAuthedProviders: () => [...providers] };
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

  /** #1221 — default durable deletion-intent store, separate from opencode.json. */
  private mcpDeletionPath(): string {
    const { join } = require('path') as typeof import('path');
    const { homedir } = require('os') as typeof import('os');
    return join(homedir(), '.config', 'rhythm', 'mcp-deletions.json');
  }

  /** #1221 — read names explicitly deleted by the user. */
  private readMcpDeletions(path = this.mcpDeletionPath()): Set<string> {
    const { existsSync, readFileSync } = require('fs') as typeof import('fs');
    if (!existsSync(path)) return new Set();
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        deleted?: unknown;
      };
      if (!Array.isArray(parsed.deleted)) {
        throw new Error('expected a deleted array');
      }
      return new Set(
        parsed.deleted.filter((name): name is string => typeof name === 'string'),
      );
    } catch (err) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `could not read durable MCP deletions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** #1221 — persist or clear one user's deletion intent. */
  private writeMcpDeletion(
    name: string,
    deleted: boolean,
    path = this.mcpDeletionPath(),
  ): void {
    const { existsSync, writeFileSync, mkdirSync } =
      require('fs') as typeof import('fs');
    const { dirname } = require('path') as typeof import('path');
    if (!deleted && !existsSync(path)) return;
    const deletions = this.readMcpDeletions(path);
    if (deleted) {
      deletions.add(name);
    } else {
      deletions.delete(name);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ deleted: [...deletions].sort() }, null, 2) + '\n',
      'utf8',
    );
  }

  get isReady(): boolean {
    return this.status === 'ready';
  }

  /**
   * A coordinator may use only the engine process this service actually owns.
   * `isReady` intentionally remains a broad SDK status for existing callers
   * and test seams; it is not sufficient evidence of ownership because a
   * client can be marked ready before it has a spawned server handle.
   */
  get hasOwnedEngine(): boolean {
    return this.status === 'ready' && this.client !== null &&
      this.server !== null && typeof this.server.url === 'string' &&
      this.server.url.length > 0;
  }

  /**
   * OCU-08 (#1049) — whether a websearch provider + key are configured (so the
   * engine's native websearch tool is enabled for this process). Surfaced in the
   * capabilities/status payload so the UI can show websearch as available. Reads
   * the config fresh; never returns the key.
   */
  get websearchConfigured(): boolean {
    return resolveWebsearchConfig() !== null;
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
      // #947 — Rhythm owns ~/.config/opencode/skills as the SOLE skill source.
      // Tell the spawned engine to stop scanning .claude/skills AND .agents/skills
      // (both — supersedes the claude-only OPENCODE_DISABLE_CLAUDE_CODE_SKILLS
      // Config Doctor set earlier). The config-dir scan
      // (~/.config/opencode/{skill,skills}) is NOT gated by this flag, so the
      // managed dir is still auto-discovered. Set on process.env so
      // createOpencode()'s child inherits it; `??=` lets an explicit override win
      // (e.g. a dev deliberately re-enabling external skills).
      process.env.OPENCODE_DISABLE_EXTERNAL_SKILLS ??= '1';
      disableEngineExternalSharing();
      // #1332 — pin the engine to its STABLE session database.
      //
      // The engine names its DB after the installation channel
      // (storage/db.ts getChannelPath): `latest`/`beta`/`prod` get the plain
      // `opencode.db`, anything else gets `opencode-<channel>.db`. Our fork's
      // build stamps the channel with the current GIT BRANCH
      // (script/build.ts → OPENCODE_CHANNEL), so every branch silently opened a
      // BRAND-NEW EMPTY session store, and every conversation from the previous
      // branch became invisible — not deleted, just in another file.
      //
      // Measured 2026-08-07 after four branch switches in five days:
      //   opencode.db                                        838 sessions
      //   opencode-mega-run-2026-08-04.db                    376 sessions
      //   opencode-workflow-run-2026-08-06-…-plan-agent.db    19 sessions
      // AJ lost access to a day of real work purely by being on a test build.
      // Sessions are where the accumulated context lives, so this is data loss
      // in practice even though every byte survives on disk.
      //
      // Real work must never be branch-scoped. Sandbox isolation is a separate,
      // EXPLICIT mode and does not rely on this filename: tools/dev/sandbox.sh
      // isolates by pointing HOME at a throwaway dir, and the engine's data path
      // derives from HOME — so forcing the stable name here cannot leak a smoke
      // run into the live store.
      //
      // `??=` keeps both escape hatches: set OPENCODE_DISABLE_CHANNEL_DB=0 to
      // restore per-branch stores, or OPENCODE_DB=<name|abs path|:memory:> to
      // pick a specific one (that flag is checked first in storage/db.ts Path).
      pinEngineSessionStore();
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
      // #927 — also export the projectId to the engine subprocess env (the
      // gemini-auth plugin's highest-priority, cache-free resolver). Must run
      // before createOpencode() spawns the engine so the child inherits it.
      const geminiEnvProjectId = ensureGeminiProjectEnv({ projectId: geminiCfg.projectId });
      logger.info(
        `[OpencodeClientService] ensured Gemini Code Assist projectId=${geminiCfg.projectId} (changed=${geminiCfg.changed}, env=${geminiEnvProjectId})`,
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
      // #655 — Before spawning, reclaim this process's engine port from a stale opencode orphan
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
      // opencode subprocess on the resolved port — we MUST hold this handle for clean
      // shutdown (see dispose()).
      //
      // #930 — the vendored rhythm-anthropic-accounts plugin POSTs its
      // spillover/exhaustion reports to RHYTHM_API_BASE, DEFAULTING to
      // http://localhost:4001. On any other port (dev default is 4000) every
      // report is silently lost (fire-and-forget .catch), so same-account
      // spillover AND cross-provider handoff never reach api_server. Bridge
      // the ACTUAL port onto process.env before the spawn — the engine child
      // inherits it. An explicit RHYTHM_API_BASE always wins.
      if (!process.env.RHYTHM_API_BASE) {
        const { env: appEnv } = await import('../config/env');
        process.env.RHYTHM_API_BASE = `http://localhost:${appEnv.port}`;
        logger.info(
          `[OpencodeClientService] RHYTHM_API_BASE bridged to ${process.env.RHYTHM_API_BASE} for engine plugins`,
        );
      }
      // OCU-08 (#1049) — enable the engine's native websearch tool by exporting
      // its provider + key env vars onto process.env BEFORE the spawn, so the
      // engine child inherits them. No-op when unconfigured (no key) → the
      // engine spawns with zero websearch env delta, exactly as before. The key
      // is NEVER logged (only the provider name + a masked marker).
      const websearch = resolveWebsearchConfig();
      if (websearch) {
        process.env.OPENCODE_WEBSEARCH_PROVIDER = websearch.provider;
        process.env[websearch.keyEnvVar] = websearch.apiKey;
        logger.info(
          `[OpencodeClientService] websearch tool enabled (provider=${websearch.provider}, key=***)`,
        );
      }

      // #1094 follow-up — DELIBERATELY NOT raising
      // RHYTHM_PROVIDER_STREAM_INACTIVITY_MS here any more.
      //
      // An interim mitigation on this line raised the engine child's watchdog to
      // 600_000ms, because `image_generation` runs server-side with partial
      // images disabled and so streams nothing at all while rendering — any
      // gpt-image-1 render slower than the 180s default aborted with
      // "Provider stream inactive for 180000ms".
      //
      // That was a blunt global raise: it also delayed detection of a genuinely
      // hung stream from 3 to 10 minutes for EVERY request. The engine now
      // handles this properly — `providerStreamInactivityMiddleware` in
      // session/llm.ts tracks outstanding provider-executed tool calls and
      // extends the budget by PROVIDER_EXECUTED_TOOL_INACTIVITY_FACTOR only
      // while one is in flight, returning ordinary text streams to the tight
      // 180s detection the watchdog exists for (#1211).
      //
      // Strictly better on both axes, so the mitigation is removed rather than
      // layered on top. An operator-supplied env value still wins, as before.

      const t5 = Date.now();
      clearTrustedMcpVerifier();
      const corsOrigins = resolveOpencodeCorsOrigins();
      const engineOptions = buildOpencodeServerOptions(
        OPENCODE_ENGINE_PORT,
        corsOrigins,
        resolveOpencodeStartupTimeout(),
      );
      const { client, server } = await mod.createOpencode(engineOptions);
      logger.info(`[Opencode][timing] createOpencode (engine spawn) took ${Date.now() - t5}ms`);

      this.client = client;
      this.server = server;
      this.status = 'ready';
      this.error = null;
      logger.info('[OpencodeClientService] SDK initialized');
      const trustedMcpVerifierReady = await initializeTrustedMcpVerifier().catch(() => false);
      if (!trustedMcpVerifierReady) {
        logger.warn(
          '[OpencodeClientService] engine-signed MCP verifier unavailable; trusted local action routes will fail closed',
        );
      }

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
            // Keep the ChatGPT workspace id (openai) — dropping it loses the
            // ChatGPT-Account-Id header the codex plugin sends.
            const accountId = typeof creds.accountId === 'string' ? creds.accountId : undefined;
            await this.setOAuthCredentials(providerId, { access, refresh, expires, ...(accountId ? { accountId } : {}) });
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

  /**
   * List all commands from the engine (for the slash-command popover and the
   * OCU-09 (#1050) Playbooks CRUD merge). `source` is the engine's own
   * provenance tag: 'command' (config `commands/*.md` OR a built-in like
   * init/review), 'mcp' (an MCP-server prompt), or 'skill' (a skill surfaced as
   * a command). The commands router uses it — combined with the on-disk managed
   * file check — to flag which rows Rhythm may edit/delete and which names are
   * off-limits for a create (built-in / MCP / skill collision → 409).
   */
  async listCommands(): Promise<
    Array<{ name: string; description?: string; source?: string; hints?: string[] }>
  > {
    if (!this.client) return [];
    try {
      const raw = await this.client.command.list();
      const commands = raw.data ?? [];
      return commands.map((c) => ({
        name: c.name,
        description: c.description,
        source: (c as { source?: string }).source,
        // OCU-11 (#1052): argument hints (e.g. ["$1", "$2"] or ["$ARGUMENTS"])
        // the engine parses from the command's template.
        hints: (c as { hints?: string[] }).hints,
      }));
    } catch (err) {
      logger.warn('[OpencodeClientService] listCommands failed:', err);
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
        if (KEYLESS_PROVIDER_IDS.has(provider.id)) {
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

  /** True only for a credential recorded by the auth store, never a keyless provider. */
  isProviderInAuthStore(providerId: string): boolean {
    return this.authStore.listAuthedProviders().includes(providerId);
  }

  /** One bounded engine read per concurrent catalog/status request; never retain failures. */
  providerSnapshot(): Promise<ProviderSnapshot> {
    if (this.providerSnapshotPending) return this.providerSnapshotPending;
    if (!this.client) return Promise.reject(new Error('engine_unverified'));
    const client = this.client;
    const controller = new AbortController();
    // Wall-clock budget on this process's timer: a startup request burst stalled the event
    // loop ~1.1s, so 750ms aborted a 15ms engine read and the picker catalog came back [].
    const timeout = setTimeout(() => controller.abort(), 2_500);
    const read = async (): Promise<ProviderSnapshot> => {
      const raw = await client.config.providers({ signal: controller.signal });
      if (controller.signal.aborted || raw.error || !raw.data || !Array.isArray(raw.data.providers)) {
        throw new Error('engine_unverified');
      }
      const connected = new Set(this.authStore.listAuthedProviders());
      const providers = raw.data.providers.map((provider) => {
        const models = Object.entries(provider.models ?? {}).map(([key, value]) => {
          const model = value as typeof value & {
            api?: { id?: string; url?: string };
            status?: string;
            capabilities?: ProviderSnapshot['providers'][number]['models'][number]['capabilities'];
            cost?: {
              input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown;
              cache?: { read?: unknown; write?: unknown };
            };
            release_date?: unknown;
            family?: unknown;
            reasoning?: unknown;
          };
          const price = (v: unknown): number | undefined =>
            typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
          const cost = model.cost
            ? {
                input: price(model.cost.input),
                output: price(model.cost.output),
                cacheRead: price(model.cost.cache_read ?? model.cost.cache?.read),
                cacheWrite: price(model.cost.cache_write ?? model.cost.cache?.write),
              }
            : undefined;
          const priced = cost
            ? Object.fromEntries(Object.entries(cost).filter(([, v]) => v !== undefined))
            : {};
          return {
            id: model.id ?? key,
            ...(typeof model.name === 'string' ? { name: model.name } : {}),
            ...(typeof model.api?.id === 'string' ? { apiId: model.api.id } : {}),
            ...(typeof model.status === 'string' ? { status: model.status } : {}),
            ...(typeof model.limit?.context === 'number' ? { contextLimit: model.limit.context } : {}),
            ...(Object.keys(priced).length > 0 ? { cost: priced } : {}),
            ...(typeof model.release_date === 'string' && model.release_date
              ? { releaseDate: model.release_date } : {}),
            ...(typeof model.family === 'string' && model.family ? { family: model.family } : {}),
            ...(typeof model.reasoning === 'boolean' ? { reasoning: model.reasoning } : {}),
            ...(model.capabilities ? {
              capabilities: {
                input: { text: model.capabilities.input?.text === true },
                output: { text: model.capabilities.output?.text === true },
                toolcall: model.capabilities.toolcall === true,
              },
            } : {}),
          };
        });
        // Engine provider options may carry secrets. Only expose a URL origin
        // from a model's declared API endpoint when it has no userinfo.
        const effectiveOptions = (provider as typeof provider & {
          options?: { baseURL?: unknown; baseUrl?: unknown; [key: string]: unknown };
          source?: ProviderSnapshot['providers'][number]['source'];
        }).options ?? null;
        const rawEndpoint = typeof effectiveOptions?.baseURL === 'string'
          ? effectiveOptions.baseURL
          : typeof effectiveOptions?.baseUrl === 'string'
            ? effectiveOptions.baseUrl
            : Object.values(provider.models ?? {})[0]?.api?.url;
        let endpoint: string | undefined;
        try {
          if (rawEndpoint) {
            const url = new URL(rawEndpoint);
            if (!url.username && !url.password && ['http:', 'https:'].includes(url.protocol)) {
              endpoint = url.origin;
            }
          }
        } catch {
          // An invalid endpoint is not public metadata.
        }
        const digest = createHmac('sha256', providerDigestKey).update(JSON.stringify({
          id: provider.id,
          endpoint,
          models,
          options: effectiveOptions,
        })).digest('hex');
        const source = (provider as typeof provider & {
          source?: ProviderSnapshot['providers'][number]['source'];
        }).source;
        const configuredApiKey = effectiveOptions?.apiKey;
        const credentialBacked = ['env', 'api', 'custom'].includes(source ?? '') ||
          (typeof configuredApiKey === 'string'
            ? configuredApiKey.trim().length > 0
            : configuredApiKey != null);
        return {
          id: provider.id,
          connected: connected.has(provider.id) || KEYLESS_PROVIDER_IDS.has(provider.id) || credentialBacked,
          ...(source
            ? { source }
            : {}),
          ...(endpoint ? { endpoint } : {}),
          digest,
          models,
        };
      });
      const defaults = (raw.data as typeof raw.data & { default?: Record<string, string> }).default ?? {};
      return { providers, defaults };
    };
    const pending = Promise.race([
      read(),
      new Promise<never>((_, reject) => controller.signal.addEventListener(
        'abort',
        () => reject(new Error('engine_unverified')),
        { once: true },
      )),
    ]).finally(() => {
      clearTimeout(timeout);
      if (this.providerSnapshotPending === pending) this.providerSnapshotPending = undefined;
    });
    this.providerSnapshotPending = pending;
    return pending;
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

  /**
   * #1143 — enumerate the FULL live provider catalog (every provider the
   * engine loaded from opencode.json, including user-defined openai-compatible
   * ones like glm-mesh), each with its models. This is the same catalog
   * `opencode models` reads, so a custom provider defined only in opencode.json
   * — invisible to the hardcoded PROVIDER_TO_AGENT_KIND / ROUTE_FALLBACKS_BY_AGENT
   * maps — is discoverable here. Returns [] on any failure (never throws).
   */
  async listProviders(): Promise<
    Array<{ id: string; models: Array<{ id: string; name?: string; contextLimit?: number }> }>
  > {
    if (!this.client) return [];
    try {
      const raw = await this.client.config.providers();
      const providers = raw.data?.providers ?? [];
      return providers.map((provider) => {
        const models = provider.models;
        let modelList: Array<{ id: string; name?: string; contextLimit?: number }> = [];
        if (Array.isArray(models)) {
          modelList = models.map((m) => ({
            id: m.id,
            name: m.name,
            ...(m.limit?.context != null ? { contextLimit: m.limit.context } : {}),
          }));
        } else if (models && typeof models === 'object') {
          modelList = Object.entries(models).map(([id, model]) => ({
            id: model.id ?? id,
            name: model.name,
            ...(model.limit?.context != null ? { contextLimit: model.limit.context } : {}),
          }));
        }
        return { id: provider.id, models: modelList };
      });
    } catch (err) {
      logger.warn(`[OpencodeClientService] listProviders failed (non-fatal): ${String(err)}`);
      return [];
    }
  }

  /** Engine's default model for a provider (the `default` map of config.providers()). */
  async getDefaultModel(providerId: string): Promise<string | undefined> {
    if (!this.client) return undefined;
    try {
      const raw = await this.client.config.providers();
      // The engine returns { providers, default: {[providerId]: modelId} };
      // the installed SDK typings predate the `default` field.
      const dflt = (raw.data as { default?: Record<string, string> } | undefined)?.default;
      return dflt?.[providerId];
    } catch (err) {
      logger.warn(`[OpencodeClientService] getDefaultModel failed for ${providerId}: ${String(err)}`);
      return undefined;
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

  /** Remove a newly-created provider credential through the typed v2 engine API. */
  async removeAuth(providerId: string): Promise<boolean> {
    try {
      const client = await this.v2Client();
      const raw = await client.auth.remove({ providerID: providerId });
      return raw.data === true;
    } catch {
      return false;
    }
  }

  /** Read the schema-validated global engine config used by PATCH /global/config. */
  async getGlobalConfig(): Promise<Record<string, unknown> | null> {
    try {
      const client = await this.v2Client();
      const raw = await client.global.config.get();
      if (raw.error || !raw.data || typeof raw.data !== 'object') return null;
      return raw.data as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Persist a global config patch; the engine validates, writes, and disposes instances. */
  async updateGlobalConfig(config: Record<string, unknown>): Promise<boolean> {
    try {
      const client = await this.v2Client();
      const raw = await client.global.config.update({ config: config as never });
      return !raw.error && Boolean(raw.data);
    } catch {
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
    // #775/#916 (skill-scope): permitted skill NAMES for this session.
    // Undefined = unrestricted. An explicit empty array is deny-all.
    skillAllowlist?: string[],
    // #884 — resolved provider ID for this session's turn, when known at
    // create time (e.g. agent_runner resolves the model before calling
    // createSession). Undefined means "provider not yet known" — the cap is
    // skipped (same as any non-google provider) and can still be applied
    // later via `updateSessionAllowlist` once resolved.
    providerId?: string | null,
    // #1123 — when present, create a real engine child session. Optional and
    // omitted by every pre-#1123 caller, so top-level create/resume/AgentRunner
    // behavior stays byte-for-byte unchanged.
    parentSdkSessionId?: string,
    // #1322 — plan is an engine-enforced, per-session bash deny. Keeping this
    // on the session (instead of prompt text or a caller-side check) covers
    // every bash invocation, including commands introduced by tools/agents.
    permissionMode?: PermissionMode,
    // Interactive chat session (see isInteractiveChatSession): restrict the
    // engine task tool to explore/general. Headless callers omit it.
    interactive?: boolean,
    // Persistent coordinator workers use a narrow, engine-enforced policy.
    // This is deliberately trailing and optional so ordinary session callers
    // retain their exact existing behavior.
    managedReadOnly = false,
    /**
     * A server-derived finite execution scope. It is accepted only alongside
     * default worker mode and an explicit deny baseline; ordinary callers omit
     * it and retain their established session behavior.
     */
    finiteExecutionPermissions?: readonly FiniteExecutionPermissionRule[],
    // #1222 — root-cause of the discarded-error bug: every failure branch
    // below used to collapse to a bare `null`, so callers (AgentRunner in
    // particular) could only ever report the generic "failed to create
    // opencode session" — the real cause (engine never initialized, an SDK
    // error response, or a response with no id) was logged here and nowhere
    // else, and this process's stdout/stderr are unread pipes to the parent
    // Rhythm process. Every failure branch now returns `{ error }` with a
    // cause-specific message instead. This is additive: every existing
    // caller already narrows on `!result` or `!result?.id` (both still
    // falsy-safe on `{ error }`, since `.id` is absent) — see ws_gateway.ts
    // and agent_sessions_controller.ts, updated alongside this change to use
    // `?.id` explicitly so a truthy `{ error }` object is never mistaken for
    // success.
  ): Promise<{ id: string; error?: undefined } | { id?: undefined; error: string }> {
    if (!this.client) {
      return { error: 'Opencode engine is not initialized (not ready) — no session was created' };
    }

    // mcp-scope-04: expand the McpRoleConfig into a flat { servers[], tools[] }
    // allowlist and pass it as `mcpAllowlist` on the session.create POST body.
    // The forked opencode engine (apps/opencode_fork) reads this field to scope
    // MCP tools to only the profile's allowed set for this session.
    //
    // #1132: the vendored fork package is now the only SDK type source. This
    // create path intentionally stays on the established legacy client/runtime
    // bridge, whose generated create signature does not expose the fork-only
    // fields; keep the cast narrow at this boundary. The generated v2 client
    // owns subsequent allowlist updates without casts.
    let mcpAllowlist: {
      servers: string[];
      tools: string[];
      deferred?: true;
      deferredServers?: string[];
    } | undefined;
    if (mcpRoleConfig) {
      try {
        const toolCounts = toolCountsForRoleConfig(mcpRoleConfig.mcpServers);
        mcpAllowlist = applySelectiveDeferral(
          expandMcpAllowlist(mcpRoleConfig),
          toolCounts,
          providerId,
        );
        // #884 — trim to Gemini's function-declaration cap when this session's
        // turn is routed to `google`. No-op for every other provider.
        const capResult = capMcpAllowlistForProvider(mcpAllowlist, providerId, toolCounts);
        // The cap may construct a fresh allowlist when it trims, so reassert
        // the request-build default without changing the resolved grants.
        mcpAllowlist = { ...capResult.allowlist, deferred: true };
        if (capResult.trimmed) {
          logger.warn(capResult.warning ?? '[GeminiToolCap] allowlist trimmed');
        }
        logger.info(
          '[OpencodeClientService] createSession: mcpRole=%s lazy=true allowlist servers=%s tools=%s',
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
    } else {
      // #952 — UNSCOPED session on Gemini: the fork would otherwise inject
      // every connected server's full tool surface and blow the 512-declaration
      // cap. Send an all-servers DEFERRED allowlist so the surface is bounded to
      // one dispatcher declaration while every tool stays reachable. No-op for
      // any non-google provider (returns null → mcpAllowlist stays undefined →
      // unchanged, unrestricted behavior).
      const deferred = geminiUnscopedDeferredAllowlist(
        providerId,
        await this._connectedMcpServerNames(),
      );
      if (deferred) {
        mcpAllowlist = deferred;
        logger.info(
          '[OpencodeClientService] createSession: unscoped Gemini → deferred allowlist over %s server(s)',
          deferred.servers.length,
        );
      }
    }

    try {
      // Omit a blank/placeholder title so the engine assigns its default
      // "New session - <iso>" title — the ONLY title its first-turn
      // auto-namer (SessionPrompt.ensureTitle → isDefaultTitle) will replace.
      // Sending '' (instant-create since OPC-#710) or 'Untitled chat' made the
      // engine skip auto-titling for every such session.
      const body: Record<string, unknown> = isUntitledSessionName(title) ? {} : { title: title.trim() };
      if (parentSdkSessionId) {
        body.parentID = parentSdkSessionId;
      }
      if (mcpAllowlist !== undefined) {
        body.mcpAllowlist = mcpAllowlist;
      }
      if (permissionMode === 'plan') {
        body.permission = [
          { permission: 'bash', pattern: '*', action: 'deny' },
];

/**
 * Narrow internal-only session rules for a finite coordinator execution
 * authority.  This is intentionally structural rather than exported from the
 * conversation layer: ordinary callers cannot select it through a route.
 */
type FiniteExecutionPermissionRule = {
  permission: 'edit' | 'write' | 'bash' | 'external_directory' | '*';
  pattern: string;
  action: 'allow' | 'ask' | 'deny';
};

function validFiniteExecutionPermissionRules(
  value: readonly FiniteExecutionPermissionRule[],
  directory: string | undefined,
): boolean {
  const baseline = new Set(['*:deny', 'bash:deny', 'external_directory:deny']);
  const seen = new Set<string>();
  let usable = false;
  for (const rule of value) {
    if (!rule || typeof rule.pattern !== 'string' || rule.pattern.length === 0 || rule.pattern.length > 512) return false;
    if (!['edit', 'write', 'bash', 'external_directory', '*'].includes(rule.permission)) return false;
    if (!['allow', 'ask', 'deny'].includes(rule.action)) return false;
    if (rule.permission === '*' || rule.permission === 'bash' || rule.permission === 'external_directory') {
      if (rule.pattern !== '*' || rule.action !== 'deny') return false;
      baseline.delete(`${rule.permission}:deny`);
      continue;
    }
    if (!validFiniteExecutionWorkspacePattern(rule.pattern, directory)) return false;
    const key = `${rule.permission}:${rule.pattern}:${rule.action}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (rule.action !== 'deny') usable = true;
  }
  return baseline.size === 0 && usable;
}
      } else if (permissionMode === 'bypassPermissions') {
        // Keep read/edit/external_directory independent of SSE, but force bash
        // through the bridge where #878's hardline command blocklist runs.
        // The fork evaluates with findLast, so this ordering is security-critical.
        body.permission = [
          { permission: '*', pattern: '*', action: 'allow' },
          { permission: 'bash', pattern: '*', action: 'ask' },
        ];
      }
      if (interactive) {
        body.permission = [
          ...((body.permission as unknown[] | undefined) ?? []),
          ...INTERACTIVE_TASK_PERMISSION,
        ];
      }
      if (managedReadOnly) {
        body.permission = [...MANAGED_READ_ONLY_PERMISSION];
      }
      if (finiteExecutionPermissions !== undefined) {
        if (
          managedReadOnly || permissionMode !== 'default' || interactive ||
          !validFiniteExecutionPermissionRules(finiteExecutionPermissions, directory)
        ) {
          return { error: 'finite execution session scope is invalid or conflicts with worker policy' };
        }
        // The fork's supported Session.CreateInput permission field persists
        // this exact ruleset on the child session. No caller-provided path or
        // broad bypass policy is merged into it.
        body.permission = finiteExecutionPermissions.map((rule) => ({ ...rule }));
      }
      // #775 (skill-scope): pass the per-session skill allowlist on the create body.
      // The fork reads `skillAllowlist.skills` to scope the model's available skills.
      const effectiveSkillAllowlist = managedReadOnly ? [] : skillAllowlist;
      if (effectiveSkillAllowlist !== undefined) {
        body.skillAllowlist = { skills: effectiveSkillAllowlist };
        logger.info(
          '[OpencodeClientService] createSession: skillAllowlist skills=%s',
          effectiveSkillAllowlist.join(',') || '(none)',
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
        // #1222 — distinguish "SDK returned an explicit error" from "SDK
        // returned no id and no error" (an ambiguous but still real cause):
        // both used to be swallowed into the same generic caller-facing
        // string; each now carries its own reportable reason.
        const reason = raw.error
          ? `Opencode session.create returned an error: ${JSON.stringify(raw.error)}`
          : `Opencode session.create returned no session id${raw.data ? ` (data=${JSON.stringify(raw.data).slice(0, 200)})` : ' (empty response)'}`;
        logger.error('[OpencodeClientService] createSession failed: %s', reason);
        return { error: reason };
      }
      return { id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[OpencodeClientService] createSession failed:', err);
      return { error: `Opencode session.create threw: ${message}` };
    }
  }

  /** Keep the engine's session policy synchronized when Rhythm mode changes. */
  async updateSessionPermissionMode(
    sessionId: string,
    permissionMode: PermissionMode,
    interactive?: boolean,
  ): Promise<boolean> {
    try {
      const client = await this.v2Client();
      const modeRules = permissionMode === 'plan'
        ? [{ permission: 'bash' as const, pattern: '*', action: 'deny' as const }]
        : permissionMode === 'bypassPermissions'
          ? [
              { permission: '*' as const, pattern: '*', action: 'allow' as const },
              { permission: 'bash' as const, pattern: '*', action: 'ask' as const },
            ]
          : [];
      // The engine APPENDS a PATCHed ruleset to the session's existing rules,
      // so re-append the task restriction to keep it last (a bypass `*: allow`
      // would otherwise re-open task on an interactive session).
      const permission = interactive
        ? [...modeRules, ...INTERACTIVE_TASK_PERMISSION]
        : modeRules;
      const raw = await client.session.update({ sessionID: sessionId, permission });
      if (raw.error) {
        logger.warn(
          '[OpencodeClientService] updateSessionPermissionMode SDK error for session %s: %o',
          sessionId,
          raw.error,
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.error('[OpencodeClientService] updateSessionPermissionMode failed:', err);
      return false;
    }
  }

  /**
   * PATCH /session/:id with { mcpAllowlist: { servers, tools } }.
   * Updates the fork session's MCP allowlist so the next prompt uses it.
   * Called by ws_gateway when the per-turn agent drives scope on an existing session.
   *
   * #1132: the fork-generated v2 SDK now owns the nullable allowlist body.
   * This deliberately uses the same v2 client as skills/questions so the API
   * never reconstructs the fork route by hand.
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
   *
   * Passing null clears the restriction (fork stores NULL and reads it back as
   * undefined/unrestricted). An empty expanded allowlist is deny-all.
   */
  async updateSessionAllowlist(
    sessionId: string,
    mcpRoleConfig: import('./agent_profile_scope').McpRoleConfig | null,
    providerId?: string | null,
    /** Turn prompt for local-decision tool ranking; omitted = unranked (legacy). */
    prompt?: string,
  ): Promise<boolean> {
    try {
      let mcpAllowlist: {
        servers: string[];
        tools: string[];
        deferred?: true;
        deferredServers?: string[];
      } | null;
      if (mcpRoleConfig === null) {
        // #952 — UNSCOPED per-turn push. For Gemini, null would clear the
        // restriction and let the fork inject the full surface (512-cap crash);
        // instead push an all-servers DEFERRED allowlist so the surface is
        // bounded. Non-google providers still get null (unrestricted, unchanged)
        // and skip the listMcp round-trip entirely.
        mcpAllowlist =
          providerId === 'google'
            ? (geminiUnscopedDeferredAllowlist('google', await this._connectedMcpServerNames()) ??
              null)
            : null;
      } else {
        const toolCounts = toolCountsForRoleConfig(mcpRoleConfig.mcpServers);
        mcpAllowlist = applySelectiveDeferral(
          expandMcpAllowlist(mcpRoleConfig),
          toolCounts,
          providerId,
        );
        if (prompt) {
          const { rankMcpAllowlist } = await import('./decision/tool_ranker');
          mcpAllowlist = await rankMcpAllowlist(mcpAllowlist, prompt, {
            toolCounts,
            sessionId,
          });
        }
        const capResult = capMcpAllowlistForProvider(mcpAllowlist, providerId, toolCounts);
        // Ranking/capping can return a fresh object. Preserve its narrowed
        // grants while keeping lazy loading on for every supported provider.
        mcpAllowlist = { ...capResult.allowlist, deferred: true };
        if (capResult.trimmed) {
          logger.warn(capResult.warning ?? '[GeminiToolCap] allowlist trimmed');
        }
      }
      const client = await this.v2Client();
      const raw = await client.session.update({ sessionID: sessionId, mcpAllowlist });
      if (raw.error) {
        logger.warn(
          '[OpencodeClientService] updateSessionAllowlist SDK error for session %s: %o',
          sessionId,
          raw.error,
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.error('[OpencodeClientService] updateSessionAllowlist failed:', err);
      return false;
    }
  }

  /**
   * #1231 — Keep desktop lifecycle edits on the same engine session consumed
   * by the mobile gateway. This writes metadata only; messages remain owned by
   * OpenCode and are never copied into another transcript store.
   */
  async updateSessionCatalogMetadata(
    sessionId: string,
    update: { title?: string; archived?: boolean },
  ): Promise<boolean> {
    try {
      const client = await this.v2Client();
      const raw = await client.session.update({
        sessionID: sessionId,
        ...(update.title !== undefined ? { title: update.title } : {}),
        ...(update.archived !== undefined
          ? { time: { archived: update.archived ? Date.now() : 0 } }
          : {}),
      });
      if (raw.error) {
        logger.warn(
          '[OpencodeClientService] updateSessionCatalogMetadata SDK error for session %s: %o',
          sessionId,
          raw.error,
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.error(
        '[OpencodeClientService] updateSessionCatalogMetadata failed:',
        err,
      );
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
   * Passing null clears the restriction (fork stores NULL and reads it back as
   * undefined/unrestricted). Passing [] is an explicit deny-all skill scope.
   *
   * #1132: typed by the fork-generated v2 session.update contract.
   */
  async updateSessionSkillAllowlist(
    sessionId: string,
    skills: string[] | null,
  ): Promise<boolean> {
    try {
      const client = await this.v2Client();
      const raw = await client.session.update({
        sessionID: sessionId,
        skillAllowlist: skills === null ? null : { skills },
      });
      if (raw.error) {
        logger.warn(
          '[OpencodeClientService] updateSessionSkillAllowlist SDK error for session %s: %o',
          sessionId,
          raw.error,
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
   * `directory` is optional; it defaults to the home dir, which yields the
   * directory-independent canonical set (home + config + config.skills.paths).
   * Returns [] when the engine is unavailable.
   *
   * OCU-27 (#1068): GET /skill IS covered by the real, already-installed
   * @opencode-ai/sdk@1.14.49 v2 export (`client.app.skills()` — verified
   * against node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts
   * `AppSkillsResponses`) — adopted via {@link v2Client}, same endpoint as
   * {@link listSkillsWithContent}.
   */
  async listSkills(
    directory?: string,
  ): Promise<Array<{ name: string; description?: string; location: string }>> {
    const dir = directory ?? homedir();
    try {
      const client = await this.v2Client();
      const raw = await client.app.skills({ directory: dir });
      if (raw.error || !raw.data) return [];
      return raw.data.map((s) => ({ name: s.name, description: s.description, location: s.location }));
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
   *
   * OCU-27 (#1068): same `client.app.skills()` v2 SDK call as
   * {@link listSkills} — its response already includes `content` (verified
   * against `AppSkillsResponses`), so both methods share one typed call.
   */
  async listSkillsWithContent(
    directory?: string,
  ): Promise<Array<{ name: string; description?: string; location: string; content: string }>> {
    const dir = directory ?? homedir();
    try {
      const client = await this.v2Client();
      const raw = await client.app.skills({ directory: dir });
      if (raw.error || !raw.data) return [];
      return raw.data.map((s) => ({
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
   *
   * #1132: `/skill/reload` is generated as client.app.skills2.reload().
   */
  async reloadSkills(
    directory?: string,
  ): Promise<Array<{ name: string; description?: string; location: string }>> {
    const dir = directory ?? homedir();    // The one-time skill backfill materializes SKILL.md files during server
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
      const client = await this.v2Client();
      const raw = await client.app.skills2.reload({ directory: dir });
      if (raw.error || !raw.data) {
        logger.warn('[OpencodeClientService] reloadSkills SDK error: %o', raw.error);
        return [];
      }
      return raw.data.map((s) => ({
        name: s.name,
        description: s.description,
        location: s.location,
      }));
    } catch (err) {
      logger.error('[OpencodeClientService] reloadSkills failed:', err);
      return [];
    }
  }

  /**
   * #948 — invalidate the fork's memoized global config cache (Duration.infinity
   * TTL) so the next config.get() re-scans ~/.config/opencode/agent(s)/*.md and
   * config files from disk. The cache holds agent profiles merged from disk, so
   * without this a Config Doctor edit to an agent file is invisible to new
   * sessions until the engine restarts. Mirrors reloadSkills: typed fork SDK,
   * non-throwing, no-ops when the engine isn't ready.
   */
  async reloadConfig(directory?: string): Promise<boolean> {
    if (!this.isReady) {
      return false;
    }
    try {
      // #1039 — the fork's /config/reload is DIRECTORY-SCOPED (it invalidates
      // that instance's Agent InstanceState; see the fork's configReload
      // handler / WorkspaceRoutingQuery). Reload the default instance AND,
      // when given, the specific directory — a headless run resolves its agent
      // in the instance for its effectiveCwd, so a default-only reload leaves
      // that registry stale ("Agent not found" after a live promotion).
      const targets: Array<string | undefined> = [
        undefined,
        ...(directory ? [directory] : []),
      ];
      const client = await this.v2Client();
      let ok = true;
      for (const targetDirectory of targets) {
        const raw = await client.app.config.reload(
          targetDirectory ? { directory: targetDirectory } : undefined,
        );
        if (raw.error) {
          logger.warn(
            '[OpencodeClientService] reloadConfig SDK error (%s): %o',
            targetDirectory ?? 'default',
            raw.error,
          );
          ok = false;
        }
      }
      return ok;
    } catch (err) {
      logger.error('[OpencodeClientService] reloadConfig failed:', err);
      return false;
    }
  }

  /**
   * Send a prompt to a session and wait for the full response.
   * Used for synchronous user input via the WS gateway.
   *
   * C2-C — `beforeDispatch` is the real prompt-dispatch boundary hook: the
   * exact SDK request (including `opts.system`) is constructed FIRST, then
   * `beforeDispatch` runs, then (and only then) the real SDK call fires. It
   * exists so a caller (AgentRunner) can atomically commit an experiment
   * treatment's dispatched-state transition + immutable receipt in the exact
   * window between "the effective prompt is final" and "the model saw it" —
   * never before (the prompt could still change) and never after (the model
   * may already have run under an unrecorded treatment).
   *
   * If `beforeDispatch` throws, the error propagates to the caller UNCHANGED
   * in shape (a plain closed Error, never the caller's raw error) and the SDK
   * is never called — this method does not catch or swallow a hook failure
   * into `null` the way a transport failure below is. Callers with no hook
   * (the default — every existing call site) see byte-for-byte unchanged
   * behavior.
   */
  async prompt(
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
    directory?: string,
    opts?: Record<string, unknown>,
    beforeDispatch?: () => Promise<void>,
    provenance?: DispatchInput,
    managed?: ManagedPromptDispatchContext,
  ): Promise<{ info: import('@opencode-ai/sdk').Message; parts: Array<import('@opencode-ai/sdk').Part> } | null> {
    if (!this.client) return null;
    let managedDispatchId: string | undefined;
    let managedMessageID: string | undefined;
    let dayflowMessageID: string | undefined;
    let managedScope: ManagedContextScope | undefined;
    if (managed) {
      try {
        // Refuse a second managed exposure before minting another anchor or
        // appending another enrollment. The same check runs again immediately
        // before the SDK call because callbacks below can await and mutate
        // durable controls while this request is being prepared.
        assertManagedSdkSessionMayBeExposed(sessionId);
        const currentEpoch = managed.policy.currentHostEpoch();
        if (
          !managed.captureReady ||
          !managed.policy.enabled() ||
          managed.policy.dbClient !== 'sqlite' ||
          (managed.policy.role !== 'local' && managed.policy.role !== 'all') ||
          !(await managedAuthorityIsCurrent(managed, managed.scope, 'prepare')) ||
          (managed.scope.role !== 'parent' && managed.scope.role !== 'worker') ||
          (managed.scope.role === 'worker' && !managed.workerJobId) ||
          managed.scope.sdkSessionId !== sessionId ||
          !currentEpoch ||
          managed.scope.hostEpoch !== currentEpoch ||
          !provenance ||
          provenance.sessionId !== managed.scope.sessionId ||
          provenance.sdkSessionId !== sessionId
        ) throw new Error('managed prompt scope unavailable');
        managedMessageID = await this.mintManagedPromptAnchor(sessionId, directory) ?? undefined;
        if (!managedMessageID) throw new Error('managed prompt anchor unavailable');
        managedDispatchId = modelProvenanceRepo.insert({
          ...provenance,
          sessionId: managed.scope.sessionId,
          sdkSessionId: sessionId,
          sdkUserMessageId: managedMessageID,
          routeAuthed: true,
        }).id;
        const scope: ManagedContextScope = {
          ...managed.scope,
          dispatchId: managedDispatchId,
          sdkTurnId: null,
        };
        managedScope = scope;
        managed.records.enroll({ schemaVersion: 1, ...scope });
        managed.onPrepared?.({
          scope,
          dispatchId: managedDispatchId,
          sdkUserMessageId: managedMessageID,
        });
        const sticky = managed.records.markUnsafe(scope, 'binding_ambiguous');
        if (
          sticky.outcome !== 'unsafe_recorded' ||
          sticky.snapshot?.nonreuse?.code !== 'binding_ambiguous'
        ) throw new Error('managed prompt nonreuse unavailable');
        if (managed.initialReferences && managed.initialReferences.length > 0) {
          const appended = managed.records.append({
            schemaVersion: 1,
            scope,
            references: managed.initialReferences,
          });
          if (appended.outcome !== 'recorded' || !appended.snapshot) {
            throw new Error('managed prompt dependency persistence unavailable');
          }
        }
      } catch {
        settleDispatch(managedDispatchId, 'rejected');
        throw new Error('OpencodeClientService: managed prompt preparation failed — prompt not sent');
      }
    }
    if (!managed) dayflowMessageID = await this.maybeMintDayflowPromptAnchor(sessionId, directory, provenance);
    const requestArgs = {
      path: { id: sessionId },
      body: {
        model,
        parts: [{ type: 'text' as const, text }],
        ...(opts ?? {}),
        ...(managedMessageID ? { messageID: managedMessageID } : dayflowMessageID ? { messageID: dayflowMessageID } : {}),
      },
      ...(directory ? { query: { directory } } : {}),
    };
    if (beforeDispatch) {
      try {
        await beforeDispatch();
      } catch {
        settleDispatch(managedDispatchId, 'rejected');
        logger.error(
          `[OpencodeClientService] prompt beforeDispatch hook failed for session ${sessionId} — dispatch blocked, no SDK call made`,
        );
        throw new Error('OpencodeClientService: pre-dispatch hook failed — prompt not sent');
      }
    }
    if (managed) {
      try {
        if (!managedScope || !managedMessageID) throw new Error('managed prompt scope unavailable');
        await assertCurrentManagedPromptDispatch(managed, managedScope, managedMessageID, sessionId);
      } catch {
        settleDispatch(managedDispatchId, 'rejected');
        throw new Error('OpencodeClientService: managed prompt authority changed — prompt not sent');
      }
    }
    const dispatchId = managedDispatchId ?? beginDispatch(dayflowMessageID && provenance
      ? { ...provenance, sdkUserMessageId: dayflowMessageID }
      : provenance);
    // This is deliberately the last decision before the SDK call. It covers
    // omitted managed context (ordinary callers), feature/policy drift, and a
    // second managed request that reused a session after an awaited callback.
    if (managed) {
      try {
        assertManagedSdkSessionMayBeExposed(sessionId, managedDispatchId);
        if (!managedScope || !(await managedAuthorityIsCurrent(managed, managedScope, 'sdk_exposure'))) {
          throw new Error('managed prompt scope unavailable');
        }
      } catch {
        settleDispatch(dispatchId, 'rejected');
        throw new Error('OpencodeClientService: managed SDK session reuse refused — prompt not sent');
      }
    } else {
      const sessionBoundary = managedSdkSessionBoundary(sessionId);
      if (!ordinarySdkSessionMayUseHistory(sessionBoundary)) {
        settleDispatch(dispatchId, 'rejected');
        logger.warn(
          `[OpencodeClientService] prompt refused for SDK session ${sessionId}: ${managedSdkSessionBoundaryReason(sessionBoundary)}`,
        );
        return null;
      }
    }
    // Dayflow evidence is retained independently of managed workstream
    // enrollment. Recheck it on both ordinary and managed prompt paths just
    // before the SDK call; a managed dispatch must not bypass its marker.
    try {
      await this.assertDayflowSdkHistoryMayBeReused(sessionId);
    } catch {
      settleDispatch(dispatchId, 'rejected');
      return null;
    }
    try {
      const raw = await this.client.session.prompt(requestArgs);
      if (raw.error || !raw.data) {
        settleDispatch(dispatchId, 'rejected');
        logger.error(`[OpencodeClientService] prompt error for ${sessionId}:`, raw.error);
        return null;
      }
      settleDispatch(dispatchId, 'accepted');
      return raw.data;
    } catch (err) {
      settleDispatch(dispatchId, 'rejected');
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
    beforeDispatch?: () => Promise<void>,
    provenance?: DispatchInput,
    managed?: ManagedPromptDispatchContext,
    foreground?: CoordinatorForegroundPromptDispatchContext,
    callback?: CoordinatorCallbackPromptDispatchContext,
    approvalResume?: CoordinatorApprovalResumePromptDispatchContext,
    codingWorkflow?: CodingWorkflowPromptDispatchContext,
  ): Promise<boolean> {
    if (!this.client) return false;
    if (foreground && (managed || !isCoordinatorForegroundPromptContext(foreground, sessionId, provenance))) {
      return false;
    }
    // Exclusive and strictly qualified: never combined with, or promoted from,
    // the managed/foreground/callback contexts; any mismatch refuses this path.
    if (approvalResume && (
      managed || foreground || callback || codingWorkflow ||
      !isCoordinatorApprovalResumePromptContext(approvalResume, sessionId, provenance)
    )) {
      return false;
    }
    // Same exclusivity for the Coding Workflow adapter: its own distinct kind,
    // fixed provenance shape, and no other typed context alongside it.
    if (codingWorkflow && (
      managed || foreground || callback || approvalResume ||
      !isCodingWorkflowPromptContext(codingWorkflow, sessionId, provenance)
    )) {
      return false;
    }
    if (callback && (
      managed || foreground || callback.kind !== 'coordinator_callback_v1' ||
      typeof callback.validate !== 'function' || !provenance ||
      provenance.sdkSessionId !== sessionId || provenance.routeAuthed != null ||
      !isCoordinatorCallbackProvenance(provenance)
    )) {
      return false;
    }
    let managedDispatchId: string | undefined;
    let managedMessageID: string | undefined;
    let foregroundMessageID: string | undefined;
    let dayflowMessageID: string | undefined;
    let managedScope: ManagedContextScope | undefined;
    if (managed) {
      try {
        // See prompt(): no managed SDK session may be exposed twice, even if
        // a caller accidentally reaches this async path instead of prompt().
        assertManagedSdkSessionMayBeExposed(sessionId);
        const currentEpoch = managed.policy.currentHostEpoch();
        if (
          !managed.captureReady ||
          !managed.policy.enabled() ||
          managed.policy.dbClient !== 'sqlite' ||
          (managed.policy.role !== 'local' && managed.policy.role !== 'all') ||
          !(await managedAuthorityIsCurrent(managed, managed.scope, 'prepare')) ||
          (managed.scope.role !== 'parent' && managed.scope.role !== 'worker') ||
          (managed.scope.role === 'worker' && !managed.workerJobId) ||
          managed.scope.sdkSessionId !== sessionId ||
          !currentEpoch ||
          managed.scope.hostEpoch !== currentEpoch ||
          !provenance ||
          provenance.sessionId !== managed.scope.sessionId ||
          provenance.sdkSessionId !== sessionId
        ) throw new Error('managed prompt scope unavailable');
        managedMessageID = await this.mintManagedPromptAnchor(sessionId, directory) ?? undefined;
        if (!managedMessageID) throw new Error('managed prompt anchor unavailable');
        managedDispatchId = modelProvenanceRepo.insert({
          ...provenance,
          sessionId: managed.scope.sessionId,
          sdkSessionId: sessionId,
          sdkUserMessageId: managedMessageID,
          routeAuthed: true,
        }).id;
        const scope: ManagedContextScope = {
          ...managed.scope,
          dispatchId: managedDispatchId,
          sdkTurnId: null,
        };
        managedScope = scope;
        managed.records.enroll({ schemaVersion: 1, ...scope });
        managed.onPrepared?.({
          scope,
          dispatchId: managedDispatchId,
          sdkUserMessageId: managedMessageID,
        });
        const sticky = managed.records.markUnsafe(scope, 'binding_ambiguous');
        if (
          sticky.outcome !== 'unsafe_recorded' ||
          sticky.snapshot?.nonreuse?.code !== 'binding_ambiguous'
        ) throw new Error('managed prompt nonreuse unavailable');
        if (managed.initialReferences && managed.initialReferences.length > 0) {
          const appended = managed.records.append({
            schemaVersion: 1,
            scope,
            references: managed.initialReferences,
          });
          if (appended.outcome !== 'recorded' || !appended.snapshot) {
            throw new Error('managed prompt dependency persistence unavailable');
          }
        }
      } catch {
        settleDispatch(managedDispatchId, 'rejected');
        throw new Error('OpencodeClientService: managed prompt preparation failed — prompt not sent');
      }
    }
    if (foreground) {
      try {
        if (!(await coordinatorForegroundAuthorityIsCurrent(foreground, 'prepare'))) {
          return false;
        }
        // The fork generates this identifier; it becomes the exact persisted
        // native user-message identity when the SDK accepts the request.
        foregroundMessageID = await this.mintPromptAnchor(sessionId, directory) ?? undefined;
        if (!foregroundMessageID) return false;
      } catch {
        return false;
      }
    }
    let approvalMessageID: string | undefined;
    if (approvalResume) {
      try {
        // Re-checked after the producer's preparation awaits, then after the mint await.
        if (!approvalResumeIsCurrent(approvalResume)) return false;
        approvalMessageID = await this.mintPromptAnchor(sessionId, directory) ?? undefined;
        if (!approvalMessageID || !approvalResumeIsCurrent(approvalResume)) return false;
      } catch {
        return false;
      }
    }
    let workflowMessageID: string | undefined;
    if (codingWorkflow) {
      try {
        if ((await codingWorkflow.validate({ phase: 'prepare' })) !== true) return false;
        // The engine generates this id; it becomes the exact persisted native
        // user-message identity. No mint = no request (never a late heuristic link).
        workflowMessageID = await this.mintPromptAnchor(sessionId, directory) ?? undefined;
        if (!workflowMessageID) return false;
      } catch {
        return false;
      }
    }
    if (callback && !managed && !foreground && !approvalResume) {
      // The exact durable child callback has routeAuthed null, so the optional
      // Dayflow anchor below never applies to it. When a Dayflow receiver is
      // active for this root, its real native user-message id must exist
      // before the SDK request: a missing anchor holds (the provider guard may
      // not guess a binding from a later oldest-unlinked heuristic).
      const anchor = await this.mintCallbackDayflowAnchor(sessionId, directory);
      if (anchor === 'missing') return false;
      dayflowMessageID = anchor ?? undefined;
    } else if (!managed && !approvalResume && !codingWorkflow) {
      dayflowMessageID = await this.maybeMintDayflowPromptAnchor(
        sessionId,
        directory,
        provenance,
        foregroundMessageID,
      );
    }
    // OPC-M4-1: use the caller-supplied parts array when present; otherwise
    // fall back to a single text part so all existing call-sites are unchanged.
    const sdkParts: Array<import('@opencode-ai/sdk').PartInput> = parts && parts.length > 0
      ? parts
      : [{ type: 'text', text }];
    const requestArgs = {
      path: { id: sessionId },
      body: {
        model,
        parts: sdkParts,
        ...(opts ?? {}),
        ...(managedMessageID ? { messageID: managedMessageID } : foregroundMessageID ? { messageID: foregroundMessageID } : approvalMessageID ? { messageID: approvalMessageID } : workflowMessageID ? { messageID: workflowMessageID } : dayflowMessageID ? { messageID: dayflowMessageID } : {}),
      },
      ...(directory ? { query: { directory } } : {}),
    };
    // C2-C — same boundary contract as prompt() above: request constructed
    // first, hook runs immediately before the real SDK call, a hook failure
    // propagates unchanged and the SDK is never invoked.
    if (beforeDispatch) {
      try {
        await beforeDispatch();
      } catch {
        settleDispatch(managedDispatchId, 'rejected');
        logger.error(
          `[OpencodeClientService] promptAsync beforeDispatch hook failed for session ${sessionId} — dispatch blocked, no SDK call made`,
        );
        throw new Error('OpencodeClientService: pre-dispatch hook failed — prompt not sent');
      }
    }
    if (managed) {
      try {
        if (!managedScope || !managedMessageID) throw new Error('managed prompt scope unavailable');
        await assertCurrentManagedPromptDispatch(managed, managedScope, managedMessageID, sessionId);
      } catch {
        settleDispatch(managedDispatchId, 'rejected');
        throw new Error('OpencodeClientService: managed prompt authority changed — prompt not sent');
      }
    }
    let dispatchId = managedDispatchId;
    if (!dispatchId && foreground) {
      try {
        // Unlike optional provenance for ordinary legacy callers, C2's
        // signed-tool receiver requires this exact local row before the SDK
        // can append the user message. A write failure is a closed hold.
        dispatchId = modelProvenanceRepo.insert({
          ...provenance!,
          sdkUserMessageId: foregroundMessageID!,
        }).id;
      } catch {
        return false;
      }
      if (!(await coordinatorForegroundAuthorityIsCurrent(foreground, 'before_sdk', {
        dispatchId,
        sdkUserMessageId: foregroundMessageID!,
      }))) {
        settleDispatch(dispatchId, 'rejected');
        return false;
      }
    }
    if (!dispatchId && approvalResume) {
      try {
        // The exact row, with the SAME native user-message id the SDK body
        // carries, is durable BEFORE exposure. Unlike optional provenance, a
        // write failure here is a closed hold (the resume authority is joined
        // to this row by identity, never by late linkage).
        dispatchId = modelProvenanceRepo.insert({
          ...provenance!,
          sdkUserMessageId: approvalMessageID!,
        }).id;
      } catch {
        return false;
      }
    }
    if (!dispatchId && codingWorkflow) {
      try {
        // The exact row, carrying the SAME native user-message id the SDK body
        // carries, is durable BEFORE exposure; a write failure is a closed hold.
        dispatchId = modelProvenanceRepo.insert({
          ...provenance!,
          sdkUserMessageId: workflowMessageID!,
        }).id;
      } catch {
        return false;
      }
      let prepared = false;
      try {
        prepared = (await codingWorkflow.validate({
          phase: 'before_sdk', dispatchId, sdkUserMessageId: workflowMessageID!,
        })) === true && codingWorkflow.onPrepared({ dispatchId, sdkUserMessageId: workflowMessageID! }) === true;
      } catch {
        prepared = false;
      }
      if (!prepared) {
        settleDispatch(dispatchId, 'rejected');
        return false;
      }
    }
    dispatchId ??= beginDispatch(dayflowMessageID && provenance
      ? { ...provenance, sdkUserMessageId: dayflowMessageID }
      : provenance);
    // Keep this immediately adjacent to the SDK exposure; `beforeDispatch`
    // and managed authority checks above may both have awaited.
    if (managed) {
      try {
        assertManagedSdkSessionMayBeExposed(sessionId, managedDispatchId);
        if (!managedScope || !(await managedAuthorityIsCurrent(managed, managedScope, 'sdk_exposure'))) {
          throw new Error('managed prompt scope unavailable');
        }
      } catch {
        settleDispatch(dispatchId, 'rejected');
        throw new Error('OpencodeClientService: managed SDK session reuse refused — prompt not sent');
      }
    } else {
      const sessionBoundary = managedSdkSessionBoundary(sessionId);
      if (!ordinarySdkSessionMayUseHistory(sessionBoundary)) {
        settleDispatch(dispatchId, 'rejected');
        logger.warn(
          `[OpencodeClientService] promptAsync refused for SDK session ${sessionId}: ${managedSdkSessionBoundaryReason(sessionBoundary)}`,
        );
        return false;
      }
    }
    // See prompt(): retained Dayflow history is independent from managed
    // enrollment and must close both SDK dispatch paths on a failed recheck.
    try {
      // Only the already-qualified typed foreground / exact callback contexts
      // may enqueue for a projected provider request; managed, approval-resume
      // and untyped calls keep the raw-history hold.
      await this.assertDayflowSdkHistoryMayBeReused(sessionId, Boolean(foreground || callback));
    } catch {
      settleDispatch(dispatchId, 'rejected');
      return false;
    }
    if (foreground && !(
      await coordinatorForegroundAuthorityIsCurrent(foreground, 'sdk_exposure', {
        dispatchId: dispatchId!,
        sdkUserMessageId: foregroundMessageID!,
      })
    )) {
      settleDispatch(dispatchId, 'rejected');
      return false;
    }
    // Callback overlay freshness, synchronously after the last await above:
    // a scope lost during any earlier await withholds the whole dispatch (it is
    // re-prepared from current state on the next flush) instead of exposing a
    // stale coordinator contract.
    if (callback) {
      let current = false;
      try {
        current = (await callback.validate()) === true;
      } catch {
        current = false;
      }
      if (!current) {
        settleDispatch(dispatchId, 'rejected');
        return false;
      }
    }
    // Approval resume: the producer's synchronous fingerprint check, run AFTER
    // the last awaited history/authority guard above. There is deliberately NO
    // await between this check and the SDK invocation below (the call
    // expression is evaluated before its result is awaited).
    if (approvalResume && !approvalResumeIsCurrent(approvalResume)) {
      settleDispatch(dispatchId, 'rejected');
      return false;
    }
    // Coding Workflow: the async authority re-check at SDK exposure, then the
    // synchronous freshness proof with NO await between it and the SDK call.
    if (codingWorkflow) {
      let current = false;
      try {
        current = (await codingWorkflow.validate({
          phase: 'sdk_exposure', dispatchId: dispatchId!, sdkUserMessageId: workflowMessageID!,
        })) === true;
      } catch {
        current = false;
      }
      if (current) {
        try { current = codingWorkflow.isCurrent() === true; } catch { current = false; }
      }
      if (!current) {
        settleDispatch(dispatchId, 'rejected');
        return false;
      }
    }
    const exportWorkflowOutcome = (delivery: 'accepted' | 'unknown' | 'rejected'): void => {
      if (!codingWorkflow) return;
      try {
        codingWorkflow.onOutcome({ delivery, dispatchId: dispatchId!, sdkUserMessageId: workflowMessageID! });
      } catch (err) {
        logger.warn('[OpencodeClientService] coding workflow outcome export failed:', err);
      }
    };
    try {
      const raw = await this.client.session.promptAsync(requestArgs);
      if (raw.error) {
        settleDispatch(dispatchId, 'rejected');
        exportWorkflowOutcome('rejected');
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
      // Access the underlying HTTP response. The generated success payload is
      // intentionally void (204), so data can never distinguish success from
      // a silent no-op.
      if (raw.data !== undefined) {
        // Back-compat for older/fake SDK transports that returned a body on
        // success. The generated fork client uses the 204 branch below.
        settleDispatch(dispatchId, 'accepted');
        exportWorkflowOutcome('accepted');
        return true;
      }
      const httpStatus = raw.response?.status;
      if (httpStatus === 204) {
        settleDispatch(dispatchId, 'accepted');
        exportWorkflowOutcome('accepted');
        return true;
      }
      settleDispatch(dispatchId, 'rejected');
      exportWorkflowOutcome('rejected');
      logger.warn(
        `[OpencodeClientService] promptAsync silent no-op for ${sessionId}: SDK returned neither data nor error (model may not be supported; HTTP status=${httpStatus ?? 'unknown'})`,
      );
      return false;
    } catch (err) {
      // A thrown transport error after the request left is NOT proof it was
      // refused: the Coding Workflow adapter keeps it `unknown`. Every other
      // caller keeps its existing rejected settlement.
      settleDispatch(dispatchId, codingWorkflow ? 'unknown' : 'rejected');
      exportWorkflowOutcome('unknown');
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
   * OCU-29 (#1070) — subscribe to the engine's single `/global/event` SSE
   * stream spanning ALL directories. Each frame is an envelope
   * `{ directory, project?, workspace?, payload: {id, type, properties} }`.
   * We parse the SSE ourselves (raw fetch) because the generated SDK client
   * only exposes the per-directory `event.subscribe`. Yields the UNWRAPPED
   * inner event augmented with `__directory` so the bridge can route by
   * directory in addition to sessionID. Returns null when the engine is not
   * reachable.
   *
   * The returned object carries an `abort()` to tear the stream down (used by
   * the heartbeat watchdog to force a resubscribe).
   */
  async subscribeToGlobalEvents(): Promise<{
    stream: AsyncIterable<import('@opencode-ai/sdk').RhythmEvent & { __directory?: string }>;
    abort: () => void;
  } | null> {
    const controller = new AbortController();
    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}/global/event`, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      });
    } catch (err) {
      logger.error('[OpencodeClientService] subscribeToGlobalEvents failed:', err);
      return null;
    }
    if (!res.ok || !res.body) {
      logger.warn('[OpencodeClientService] subscribeToGlobalEvents HTTP %s', res.status);
      return null;
    }
    // res.body is a ReadableStream<Uint8Array>, which is async-iterable at
    // runtime under Node's fetch (undici). Access the iterator through a
    // narrow structural type rather than a double widening cast (the #685
    // anti-duck-typing guard forbids that pattern in this file).
    const body = res.body as Pick<AsyncIterable<Uint8Array>, typeof Symbol.asyncIterator>;

    async function* iterate(): AsyncIterable<
      import('@opencode-ai/sdk').RhythmEvent & { __directory?: string }
    > {
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        // SSE frames are separated by a blank line; each `data:` line is JSON.
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame
            .split('\n')
            .find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const json = dataLine.slice(5).trim();
          if (!json) continue;
          let envelope: {
            directory?: string;
            payload?: import('@opencode-ai/sdk').RhythmEvent;
          };
          try {
            envelope = JSON.parse(json);
          } catch {
            continue;
          }
          if (!envelope.payload) continue;
          yield { ...envelope.payload, __directory: envelope.directory };
        }
      }
    }

    return { stream: iterate(), abort: () => controller.abort() };
  }

  /**
   * Read the engine process identity from `/global/health`.
   *
   * Version alone is deliberately insufficient: a replacement process runs
   * the same build. The fork exposes both pid and a random per-boot id so the
   * still-running api_server can detect that its SSE subscription belongs to
   * a dead predecessor.
   */
  async getEngineIdentity(): Promise<OpencodeEngineIdentity | null> {
    try {
      const res = await fetch(`${this.serverUrl}/global/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!res.ok) return null;
      const body = await res.json() as Partial<OpencodeEngineIdentity> & {
        healthy?: boolean;
      };
      if (
        body.healthy !== true ||
        typeof body.version !== 'string' ||
        !Number.isInteger(body.pid) ||
        typeof body.bootId !== 'string' ||
        body.bootId.length === 0
      ) {
        logger.warn('[OpencodeClientService] /global/health omitted engine identity');
        return null;
      }
      return {
        version: body.version,
        pid: body.pid as number,
        bootId: body.bootId,
      };
    } catch (err) {
      logger.warn(`[OpencodeClientService] engine identity check failed: ${String(err)}`);
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
    creds: { access: string; refresh: string; expires: number; accountId?: string },
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
          // Engine Auth.Oauth schema accepts optional accountId (vendored d.ts omits it).
          ...(creds.accountId ? { accountId: creds.accountId } : {}),
        } as { type: 'oauth'; access: string; refresh: string; expires: number },
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

  /**
   * OCU-01 (#1042) — reply to a pending permission via the engine's MODERN
   * endpoint `POST /permission/{requestID}/reply` (reply=once|always|reject
   * + optional {message}). `always` persists a project-level approval engine-
   * side; a reject message is fed back to the agent's next turn. This is the
   * default path. A 404 is authoritative: with the bundled fork it means the
   * scoped request did not match a pending ask. Falling back would turn that
   * required false result into a false-positive success (#1341).
   *
   * Direct fetch until a typed SDK adopts this route. Never throws — returns
   * true on 2xx, false on any failure (the caller still clears local UI
   * state). `message` is agent-facing feedback, never logged as a secret.
   *
   * OCU-27 (#1068): out of scope — not in this issue's named shim list
   * (unlike the sibling Question API, converted below via {@link v2Client}).
   */
  async replyToPermission(
    requestID: string,
    reply: 'once' | 'always' | 'reject',
    message?: string,
    directory?: string,
    sdkSessionId?: string,
  ): Promise<boolean> {
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const url = `${this.serverUrl}/permission/${encodeURIComponent(requestID)}/reply${qs}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reply, ...(message ? { message } : {}) }),
      });
      if (res.ok) return true;
      logger.error(
        `[OpencodeClientService] replyToPermission failed (${res.status}) for ${requestID}`,
      );
      return false;
    } catch (err) {
      logger.error(`[OpencodeClientService] replyToPermission threw for ${requestID}:`, err);
      return false;
    }
  }

  // ── Question API (AskUserQuestion handshake) ──────────────────────────────
  //
  // opencode answers its `question` tool through POST /question/{id}/reply.
  // The v1 OpencodeClient we hold does NOT expose this route (the Question API
  // lives in the SDK's v2 namespace). Without this, a question tool stays
  // status:running forever and the session hangs.
  //
  // OCU-27 (#1068): the real, already-installed @opencode-ai/sdk@1.14.49 v2
  // export DOES cover `/question`, `/question/{id}/reply`, and
  // `/question/{id}/reject` (verified against
  // node_modules/@opencode-ai/sdk/dist/v2/gen/{sdk,types}.gen.d.ts) — adopted
  // below via {@link v2Client}. It constructs the exact same HTTP requests
  // the prior raw-fetch calls used, so this is a client-typing change only.

  /** Mint one real engine MessageID for a managed request; unavailable by default. */
  async mintManagedPromptAnchor(
    sdkSessionId: string,
    directory?: string,
  ): Promise<string | null> {
    const ownedUrl = this.status === 'ready' && this.client ? this.server?.url : undefined;
    if (process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS !== '1' || !ownedUrl || !sdkSessionId) return null;
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    try {
      const response = await fetch(
        `${ownedUrl}/session/${encodeURIComponent(sdkSessionId)}/rhythm-prompt-anchor${query}`,
        { method: 'POST', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2_000) },
      );
      if (!response.ok) return null;
      const value = await response.json() as Record<string, unknown>;
      if (
        Object.keys(value).length !== 1 ||
        typeof value.messageID !== 'string' ||
        value.messageID.length === 0 ||
        value.messageID.length > 256
      ) return null;
      return value.messageID;
    } catch {
      return null;
    }
  }

  /** Generic name for the same engine-owned anchor; managed callers keep the
   * legacy method above while ordinary Dayflow dispatches use this opt-in. */
  async mintPromptAnchor(
    sdkSessionId: string,
    directory?: string,
  ): Promise<string | null> {
    return this.mintManagedPromptAnchor(sdkSessionId, directory);
  }

  /** Read one live runner-owned MCP call from this service's owned engine. */
  async getManagedActiveToolCall(
    sdkSessionId: string,
    assistantId: string,
    toolCallId: string,
    directory?: string,
  ): Promise<ManagedActiveToolCall | null> {
    const ownedUrl = this.status === 'ready' && this.client ? this.server?.url : undefined;
    if (
      process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS !== '1' ||
      !ownedUrl ||
      !sdkSessionId ||
      !assistantId ||
      !toolCallId
    ) return null;
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    try {
      const response = await fetch(
        `${ownedUrl}/session/${encodeURIComponent(sdkSessionId)}/rhythm-active-tool/` +
          `${encodeURIComponent(assistantId)}/${encodeURIComponent(toolCallId)}${query}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2_000) },
      );
      if (!response.ok) return null;
      const value = await response.json() as Record<string, unknown>;
      const keys = [
        'sdkSessionId', 'assistantId', 'userMessageId', 'partId', 'toolCallId',
        'toolKey', 'agentName', 'serverName', 'toolName',
      ] as const;
      if (
        Object.keys(value).length !== keys.length ||
        keys.some((key) =>
          typeof value[key] !== 'string' || value[key].length === 0 || value[key].length > 256)
      ) return null;
      return {
        sdkSessionId: value.sdkSessionId as string,
        assistantId: value.assistantId as string,
        userMessageId: value.userMessageId as string,
        partId: value.partId as string,
        toolCallId: value.toolCallId as string,
        toolKey: value.toolKey as string,
        agentName: value.agentName as string,
        serverName: value.serverName as string,
        toolName: value.toolName as string,
      };
    } catch {
      return null;
    }
  }

  /** Current server-owned tool inspection; no consumer/bridge-origin fallback. */
  async getCurrentTrustedMcpToolCall(
    sdkSessionId: string,
    assistantId: string,
    toolCallId: string,
    directory?: string,
  ): Promise<ManagedActiveToolCall | null> {
    return this.getManagedActiveToolCall(sdkSessionId, assistantId, toolCallId, directory);
  }

  /** Base URL of the spawned opencode server (falls back to the default port). */
  private get serverUrl(): string {
    return this.server?.url ?? 'http://127.0.0.1:4096';
  }

  /** Test-only seam (mirrors {@link __setTestClient}) for the v2 SDK client. */
  private _v2TestClient: import('@opencode-ai/sdk/v2/client').OpencodeClient | null = null;
  __setTestV2Client(client: import('@opencode-ai/sdk/v2/client').OpencodeClient): void {
    this._v2TestClient = client;
    this.status = 'ready';
    this.error = null;
  }

  /**
   * OCU-27 (#1068) — lazily create a v2 SDK client bound to the SAME running
   * engine as the v1 client (this.serverUrl). Not cached beyond a test
   * override — reads this.serverUrl fresh each call so a reloadCredentials()
   * bounce is picked up, matching every other raw-fetch method in this file.
   * Dynamic import mirrors {@link initialize}'s Function-wrapped `import()`
   * (v2 is ESM-only too, same CJS incompatibility).
   */
  private async v2Client(): Promise<import('@opencode-ai/sdk/v2/client').OpencodeClient> {
    if (this._v2TestClient) return this._v2TestClient;
    const dynamicImport = new Function('s', 'return import(s)') as (
      s: string,
    ) => Promise<unknown>;
    const mod = (await dynamicImport('@opencode-ai/sdk/v2/client')) as {
      createOpencodeClient: (config?: {
        baseUrl?: string;
      }) => import('@opencode-ai/sdk/v2/client').OpencodeClient;
    };
    return mod.createOpencodeClient({ baseUrl: this.serverUrl });
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
    try {
      const client = await this.v2Client();
      const raw = await client.question.reply({ requestID: requestId, answers, directory });
      if (raw.error) {
        logger.error(
          `[OpencodeClientService] question reply failed for ${requestId}:`,
          raw.error,
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.error(`[OpencodeClientService] question reply threw for ${requestId}:`, err);
      return false;
    }
  }

  /** POST /question/{requestID}/reject — dismiss a pending question. */
  async rejectQuestion(requestId: string, directory?: string): Promise<boolean> {
    try {
      const client = await this.v2Client();
      const raw = await client.question.reject({ requestID: requestId, directory });
      if (raw.error) {
        logger.error(
          `[OpencodeClientService] question reject failed for ${requestId}:`,
          raw.error,
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.error(`[OpencodeClientService] question reject threw for ${requestId}:`, err);
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
    try {
      const client = await this.v2Client();
      const raw = await client.question.list({ directory });
      if (raw.error || !raw.data) return [];
      // GET /question returns the full QuestionRequest list — including the
      // `questions` array used to render the card when a missed `question.asked`
      // is recovered (see OpencodeStreamBridge.recoverPendingQuestions).
      return raw.data;
    } catch (err) {
      logger.error('[OpencodeClientService] listQuestions failed:', err);
      return [];
    }
  }

  /**
   * GET /permission — list pending permission requests across all sessions
   * (OCU-03 #1044). Mirrors {@link listQuestions}: used to rehydrate the
   * bridge's in-memory pending-permission map after an api_server/engine
   * restart, so an orphaned permission ask resurfaces as a card. Never throws.
   */
  async listPermissions(
    directory?: string,
  ): Promise<
    Array<{
      id: string;
      sessionID: string;
      permission?: string;
      patterns?: string[];
      title?: string;
      metadata?: Record<string, unknown>;
      tool?: { callID?: string; messageID?: string };
    }>
  > {
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    try {
      const res = await fetch(`${this.serverUrl}/permission${qs}`);
      if (!res.ok) return [];
      return (await res.json()) as Array<{
        id: string;
        sessionID: string;
        permission?: string;
        patterns?: string[];
        title?: string;
        metadata?: Record<string, unknown>;
        tool?: { callID?: string; messageID?: string };
      }>;
    } catch (err) {
      logger.error('[OpencodeClientService] listPermissions failed:', err);
      return [];
    }
  }

  /**
   * GET /session/status (OCU-04 #1045) — the engine's authoritative status map
   * for all sessions: `Record<sdkSessionId, { type: 'idle' | 'busy', ... }>`.
   * A session the engine does not know about is absent from the map (the engine
   * treats an unknown session as idle). Used to reconcile local DB rows stuck
   * 'working'/'starting' after a missed event (engine/api_server restart, stream
   * gap). Raw fetch (mirrors {@link listQuestions}) — the SDK client does not
   * generate this instance route. Never throws — returns {} on any failure so a
   * reconcile pass degrades to "no correction" rather than crashing the caller.
   */
  async getSessionStatuses(
    directory?: string,
  ): Promise<Record<string, { type: string }>> {
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    try {
      const res = await fetch(`${this.serverUrl}/session/status${qs}`);
      if (!res.ok) {
        logger.warn('[OpencodeClientService] getSessionStatuses HTTP %s', res.status);
        return {};
      }
      const data = (await res.json()) as Record<string, { type: string }>;
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      logger.error('[OpencodeClientService] getSessionStatuses failed:', err);
      return {};
    }
  }

  /**
   * Strict read-only lifecycle inspection for already-bound SDK sessions.
   *
   * The engine removes idle sessions from `/session/status`, so an omitted map
   * key can mean idle only after this method has independently confirmed that
   * the exact SDK session still exists in the same directory and that all
   * three current lifecycle reads succeeded with complete shapes. It is used
   * only for bounded capacity admission and exact terminal-accounting
   * reconciliation. Any HTTP,
   * SDK, transport, or shape failure returns `available: false`; callers must
   * retain occupancy rather than treating an empty fallback as success.
   */
  async inspectBoundSessionLifecycles(
    sdkSessionIds: string[],
    directory: string,
  ): Promise<BoundSessionLifecycleInspection> {
    const unavailable = (): BoundSessionLifecycleInspection => ({
      available: false,
      knownSessionIds: [],
      statusBySessionId: {},
      pendingQuestionSessionIds: [],
      pendingPermissionSessionIds: [],
    });
    const sessionIds = [...new Set(sdkSessionIds)];
    if (
      !directory || sessionIds.length === 0 || sessionIds.length > 100 ||
      sessionIds.some((id) => typeof id !== 'string' || id.trim().length === 0)
    ) {
      return unavailable();
    }

    const knownSessionIds = (await Promise.all(sessionIds.map(async (sdkSessionId) => {
      try {
        const session = await this.getSession(sdkSessionId);
        return session?.id === sdkSessionId && session.directory === directory
          ? sdkSessionId
          : null;
      } catch {
        return null;
      }
    }))).filter((id): id is string => id !== null);
    // A capacity admission never clears a partial batch.  A missing, wrong
    // directory, or transport-failed metadata read is not proof that the
    // corresponding child stopped occupying the shared engine; retain every
    // row until the whole requested bound set is positively observable.
    if (knownSessionIds.length !== sessionIds.length) return unavailable();

    const query = `?directory=${encodeURIComponent(directory)}`;
    try {
      const questionsClient = await this.v2Client();
      const [statusResponse, questionsResponse, permissionsResponse] = await Promise.all([
        fetch(`${this.serverUrl}/session/status${query}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(2_000),
        }),
        questionsClient.question.list({ directory }),
        fetch(`${this.serverUrl}/permission${query}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(2_000),
        }),
      ]);
      if (!statusResponse.ok || questionsResponse.error || !permissionsResponse.ok) {
        return unavailable();
      }
      const [statusPayload, permissionsPayload] = await Promise.all([
        statusResponse.json() as Promise<unknown>,
        permissionsResponse.json() as Promise<unknown>,
      ]);
      const questionSessionIds = completeLifecycleSessionIds(questionsResponse.data);
      const permissionSessionIds = completeLifecycleSessionIds(permissionsPayload);
      if (!completeSessionStatusMap(statusPayload) || !questionSessionIds || !permissionSessionIds) {
        return unavailable();
      }
      return {
        available: true,
        knownSessionIds,
        statusBySessionId: statusPayload,
        pendingQuestionSessionIds: questionSessionIds,
        pendingPermissionSessionIds: permissionSessionIds,
      };
    } catch {
      return unavailable();
    }
  }

  // ── Worktree wrappers (OCU-16 #1057) ──────────────────────────────────────
  //
  // The engine exposes experimental worktree lifecycle endpoints scoped by the
  // project `directory` query param. Direct fetch (mirrors getSessionStatuses)
  // — not in OCU-27 (#1068)'s named shim list; no typed SDK coverage checked.
  // All non-throwing:
  // list returns [] and the mutators return null/false on any failure so a
  // route can surface a clean error without crashing the process.

  /**
   * GET /experimental/worktree — list worktrees for a project directory.
   *
   * #1133 correction: this endpoint returns `project.sandboxes(projectId)` on
   * the engine (apps/opencode_fork/.../handlers/experimental.ts `worktree`
   * handler) — a plain array of directory-path STRINGS, not
   * `{name,branch,directory}` objects (verified against the real running
   * engine; the previous `{name,branch,directory}` type annotation here was
   * an unchecked cast that never matched the actual JSON — the OCU-16 live
   * test (`live_e2e_1057_worktree.test.ts`) already correctly treats the
   * response as `string[]`).
   */
  async listWorktrees(directory: string): Promise<string[]> {
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    try {
      const res = await fetch(`${this.serverUrl}/experimental/worktree${qs}`);
      if (!res.ok) {
        logger.warn('[OpencodeClientService] listWorktrees HTTP %s', res.status);
        return [];
      }
      const data = (await res.json()) as unknown[];
      return Array.isArray(data) ? data.filter((item): item is string => typeof item === 'string') : [];
    } catch (err) {
      logger.error('[OpencodeClientService] listWorktrees failed:', err);
      return [];
    }
  }

  /**
   * POST /experimental/worktree — ask the engine to create a worktree for the
   * project. The engine chooses its own storage location; it is not necessarily
   * inside the requested project directory.
   * Returns the created worktree Info (name/branch/directory) or throws
   * AppError(502) on failure so the route surfaces worktree.failed cleanly.
   */
  async createWorktree(
    directory: string,
    opts?: { name?: string; startCommand?: string },
  ): Promise<{ name: string; branch?: string; directory: string }> {
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const body: Record<string, unknown> = {};
    if (opts?.name) body.name = opts.name;
    if (opts?.startCommand) body.startCommand = opts.startCommand;
    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}/experimental/worktree${qs}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AppError(502, 'SDK_ERROR', `createWorktree threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AppError(502, 'SDK_ERROR', `createWorktree failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    return (await res.json()) as { name: string; branch?: string; directory: string };
  }

  /**
   * DELETE /experimental/worktree — remove a worktree (forced; deletes branch).
   * `worktreeDir` is the worktree's own directory (the `directory` field from
   * listWorktrees), passed in the body per the engine's RemoveInput schema.
   * Returns true on success, false otherwise (never throws).
   */
  async removeWorktree(directory: string, worktreeDir: string): Promise<boolean> {
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    try {
      const res = await fetch(`${this.serverUrl}/experimental/worktree${qs}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory: worktreeDir }),
      });
      if (!res.ok) {
        logger.warn('[OpencodeClientService] removeWorktree HTTP %s', res.status);
        return false;
      }
      return true;
    } catch (err) {
      logger.error('[OpencodeClientService] removeWorktree failed:', err);
      return false;
    }
  }

  /**
   * POST /experimental/worktree/reset — reset a worktree branch to the primary
   * default branch. `worktreeDir` is the worktree's own directory. Returns true
   * on success, false otherwise (never throws).
   */
  async resetWorktree(directory: string, worktreeDir: string): Promise<boolean> {
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    try {
      const res = await fetch(`${this.serverUrl}/experimental/worktree/reset${qs}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory: worktreeDir }),
      });
      if (!res.ok) {
        logger.warn('[OpencodeClientService] resetWorktree HTTP %s', res.status);
        return false;
      }
      return true;
    } catch (err) {
      logger.error('[OpencodeClientService] resetWorktree failed:', err);
      return false;
    }
  }

  // ── File / find wrappers (OCU-19 #1060) ───────────────────────────────────
  //
  // Proxy the engine's ripgrep/find/file endpoints, all scoped by the session's
  // `directory`. Direct fetch (SDK doesn't generate these instance routes).
  // Non-throwing where a [] degradation is safe; readFileContent throws
  // AppError(502) on engine error so the route surfaces a real failure.

  /** GET /find — ripgrep text search (engine caps results). */
  async findText(directory: string, pattern: string): Promise<unknown[]> {
    const qs = `?directory=${encodeURIComponent(directory)}&pattern=${encodeURIComponent(pattern)}`;
    try {
      const res = await fetch(`${this.serverUrl}/find${qs}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error('[OpencodeClientService] findText failed:', err);
      return [];
    }
  }

  /** GET /find/file — fuzzy file/dir search (limit 1-200, optional type filter). */
  async findFiles(
    directory: string,
    query: string,
    opts?: { limit?: number; type?: 'file' | 'directory'; dirs?: boolean },
  ): Promise<string[]> {
    const params = new URLSearchParams({ directory, query });
    if (opts?.limit != null) params.set('limit', String(opts.limit));
    if (opts?.type) params.set('type', opts.type);
    if (opts?.dirs != null) params.set('dirs', String(opts.dirs));
    try {
      const res = await fetch(`${this.serverUrl}/find/file?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? (data as string[]) : [];
    } catch (err) {
      logger.error('[OpencodeClientService] findFiles failed:', err);
      return [];
    }
  }

  /** GET /file — list files/dirs at a path within the session directory. */
  async listFiles(directory: string, path: string): Promise<unknown[]> {
    const qs = `?directory=${encodeURIComponent(directory)}&path=${encodeURIComponent(path)}`;
    try {
      const res = await fetch(`${this.serverUrl}/file${qs}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error('[OpencodeClientService] listFiles failed:', err);
      return [];
    }
  }

  /**
   * GET /file/content — read a file's content (engine flags binary / returns
   * base64 per its own semantics). Throws AppError on engine error so the route
   * can 4xx/5xx cleanly rather than silently returning empty.
   */
  async readFileContent(directory: string, path: string): Promise<unknown> {
    const qs = `?directory=${encodeURIComponent(directory)}&path=${encodeURIComponent(path)}`;
    const res = await fetch(`${this.serverUrl}/file/content${qs}`);
    if (!res.ok) {
      throw new AppError(502, 'SDK_ERROR', `readFileContent failed (${res.status}) for ${path}`);
    }
    return res.json();
  }

  /** GET /file/status — git-aware file status for the session directory. */
  async fileStatus(directory: string): Promise<unknown[]> {
    const qs = `?directory=${encodeURIComponent(directory)}`;
    try {
      const res = await fetch(`${this.serverUrl}/file/status${qs}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error('[OpencodeClientService] fileStatus failed:', err);
      return [];
    }
  }

  // ── VCS wrappers (OCU-22 #1063 / OCU-23 #1064) ────────────────────────────
  //
  // Proxy the engine's project-scoped VCS endpoints. Direct fetch; all scoped
  // by the project `directory`. Non-throwing (null/[] on failure) so a route
  // can degrade to "no badge / empty diff" rather than 500.

  /** GET /vcs — { branch?, defaultBranch? } for the project directory. */
  async getVcs(directory: string): Promise<{ branch?: string; defaultBranch?: string } | null> {
    const qs = `?directory=${encodeURIComponent(directory)}`;
    try {
      const res = await fetch(`${this.serverUrl}/vcs${qs}`);
      if (!res.ok) return null;
      return (await res.json()) as { branch?: string; defaultBranch?: string };
    } catch (err) {
      logger.error('[OpencodeClientService] getVcs failed:', err);
      return null;
    }
  }

  /** GET /vcs/status — changed files in the working tree. */
  async getVcsStatus(directory: string): Promise<unknown[]> {
    const qs = `?directory=${encodeURIComponent(directory)}`;
    try {
      const res = await fetch(`${this.serverUrl}/vcs/status${qs}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error('[OpencodeClientService] getVcsStatus failed:', err);
      return [];
    }
  }

  /**
   * GET /vcs/diff?mode=git|branch — structured diff. `git` = working-tree
   * uncommitted; `branch` = full diff vs the default branch. Throws AppError on
   * engine error so the route surfaces a real failure.
   */
  async getVcsDiff(directory: string, mode: 'git' | 'branch'): Promise<unknown[]> {
    const qs = `?directory=${encodeURIComponent(directory)}&mode=${mode}`;
    const res = await fetch(`${this.serverUrl}/vcs/diff${qs}`);
    if (!res.ok) {
      throw new AppError(502, 'SDK_ERROR', `getVcsDiff failed (${res.status})`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * GET /vcs/diff/raw — the raw text/x-diff patch for uncommitted changes.
   * Returns the patch text (or '' on failure — an empty patch is a valid,
   * clean-tree result).
   */
  async getVcsDiffRaw(directory: string): Promise<string> {
    const qs = `?directory=${encodeURIComponent(directory)}`;
    try {
      const res = await fetch(`${this.serverUrl}/vcs/diff/raw${qs}`);
      if (!res.ok) return '';
      return await res.text();
    } catch (err) {
      logger.error('[OpencodeClientService] getVcsDiffRaw failed:', err);
      return '';
    }
  }

  // ── session.shell / session.init wrappers (OCU-24 #1065 / OCU-25 #1066) ────

  /**
   * POST /session/{id}/shell — run a non-interactive command through the
   * session so the invocation + output land in session history. `agent` is the
   * engine agent name to attribute the run to; `command` is the shell command.
   * Direct fetch — not in OCU-27 (#1068)'s named shim list. Returns the
   * created message on success, or throws AppError on engine error.
   */
  async sessionShell(
    sdkId: string,
    command: string,
    agent: string,
    directory?: string,
    model?: string,
  ): Promise<unknown> {
    assertOrdinarySdkSessionMayUseHistoryOperation(sdkId, 'session shell');
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const body: Record<string, unknown> = { command, agent };
    if (model) body.model = model;
    assertOrdinarySdkSessionMayUseHistoryOperation(sdkId, 'session shell');
    await this.assertDayflowSdkHistoryMayBeReused(sdkId);
    const res = await fetch(`${this.serverUrl}/session/${encodeURIComponent(sdkId)}/shell${qs}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new AppError(502, 'SDK_ERROR', `sessionShell failed (${res.status}) for ${sdkId}`);
    }
    return res.json();
  }

  /**
   * POST /session/{id}/init — run the engine's built-in init flow (analyze the
   * project + generate AGENTS.md). Progress streams via SSE as a normal turn.
   * Requires providerID/modelID/messageID (the model that writes AGENTS.md).
   * Returns true on 2xx.
   */
  async sessionInit(
    sdkId: string,
    opts: { providerID: string; modelID: string; messageID: string },
    directory?: string,
  ): Promise<boolean> {
    assertOrdinarySdkSessionMayUseHistoryOperation(sdkId, 'session init');
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    assertOrdinarySdkSessionMayUseHistoryOperation(sdkId, 'session init');
    await this.assertDayflowSdkHistoryMayBeReused(sdkId);
    const res = await fetch(`${this.serverUrl}/session/${encodeURIComponent(sdkId)}/init${qs}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      throw new AppError(502, 'SDK_ERROR', `sessionInit failed (${res.status}) for ${sdkId}`);
    }
    return true;
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
    assertOrdinarySdkSessionMayUseHistoryOperation(sdkId, 'session command');
    const request = {
      path: { id: sdkId },
      body: { command, arguments: args },
    };
    assertOrdinarySdkSessionMayUseHistoryOperation(sdkId, 'session command');
    await this.assertDayflowSdkHistoryMayBeReused(sdkId);
    const raw = await client.session.command(request);
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
  /**
   * Cursor-aware legacy message page. The generated SDK predates the engine's
   * `before` query and response cursor header, so keep that narrow cast here
   * instead of inventing a second engine route or silently truncating a turn.
   */
  async listMessagesPage(
    sdkId: string,
    directory?: string,
    options: { limit?: number; before?: string; caller?: string } = {},
  ): Promise<{ messages: import('@opencode-ai/sdk').SessionMessage[]; nextCursor: string | null }> {
    const client = this.requireClient();
    // #861 smoke fix: engine session reads are DIRECTORY-SCOPED — without
    // ?directory=<session cwd> the engine looks in its default instance and
    // reports "Session not found" for sessions created under another cwd
    // (e.g. subagent sessions under $HOME). Same gotcha as respond/abort.
    const startedAt = Date.now();
    const raw = await client.session.messages({
      path: { id: sdkId },
      ...(directory || options.limit !== undefined || options.before !== undefined
        ? {
            query: {
              ...(directory ? { directory } : {}),
              ...(options.limit !== undefined ? { limit: options.limit } : {}),
              ...(options.before !== undefined ? { before: options.before } : {}),
            },
          }
        : {}),
    } as never);
    const elapsedMs = Date.now() - startedAt;
    const configuredThreshold = Number(process.env.RHYTHM_TRANSCRIPT_FETCH_WARN_MS);
    const warnThresholdMs = Number.isFinite(configuredThreshold) && configuredThreshold >= 0
      ? configuredThreshold
      : 200;
    if (elapsedMs >= warnThresholdMs) {
      logger.warn(
        `[OpencodeClientService] slow transcript fetch caller=${options.caller ?? 'unspecified'} messages=${raw.data?.length ?? 0} elapsedMs=${elapsedMs}`,
      );
    }
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `listMessages failed for session ${sdkId}: ${JSON.stringify(raw.error)}`,
      );
    }
    const nextCursor = raw.response?.headers.get('x-next-cursor') ?? null;
    return { messages: raw.data ?? [], nextCursor: nextCursor || null };
  }

  async listMessages(
    sdkId: string,
    directory?: string,
    options: { limit?: number; caller?: string } = {},
  ): Promise<import('@opencode-ai/sdk').SessionMessage[]> {
    return (await this.listMessagesPage(sdkId, directory, options)).messages;
  }

  async readSessionMcpAppResource(
    sdkId: string,
    callId: string,
    directory: string,
  ): Promise<{ mimeType: 'text/html;profile=mcp-app'; text: string }> {
    const client = this.requireClient();
    const raw = await client.session.mcpAppResource({
      path: { id: sdkId, callID: callId },
      query: { directory },
    });
    if (raw.error || !raw.data) {
      throw new AppError(404, 'NOT_FOUND', 'MCP App resource unavailable');
    }
    return raw.data;
  }

  async issueSessionMcpAppExecutionProof(
    sdkId: string,
    callId: string,
    directory: string,
  ): Promise<{ proof: string; expiresAt: string }> {
    const client = await this.v2Client();
    const raw = await client.session.mcpAppExecutionProof({
      sessionID: sdkId,
      callID: callId,
      directory,
      body: {},
    });
    if (raw.error || !raw.data) {
      throw new AppError(404, 'NOT_FOUND', 'MCP App execution proof unavailable');
    }
    return raw.data;
  }

  async executeSessionMcpAppTool(
    sdkId: string,
    callId: string,
    directory: string,
    input: {
      proof: string;
      toolKey: string;
      arguments: Record<string, unknown>;
      requestId: string;
    },
  ): Promise<{
    content?: unknown[];
    structuredContent?: unknown;
    isError?: boolean;
  }> {
    const client = await this.v2Client();
    const raw = await client.session.mcpAppExecution({
      sessionID: sdkId,
      callID: callId,
      directory,
      proof: input.proof,
      toolKey: input.toolKey,
      input: input.arguments,
      requestID: input.requestId,
    });
    if (raw.error || !raw.data) {
      throw new AppError(403, 'MCP_APP_EXECUTION_DENIED', 'MCP App execution denied');
    }
    return raw.data;
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
    assertOrdinarySdkSessionMayUseHistoryOperation(sdkId, 'session summarize');
    // session.summarize REQUIRES providerID + modelID (the model used to write
    // the summary); omitting them errors with "expected string, received
    // undefined". It also needs `directory` — opencode scopes sessions per
    // directory, so without it summarize is a no-op (no compaction, no event).
    const request = {
      path: { id: sdkId },
      body: { providerID: model.providerID, modelID: model.modelID },
      ...(directory ? { query: { directory } } : {}),
    };
    assertOrdinarySdkSessionMayUseHistoryOperation(sdkId, 'session summarize');
    await this.assertDayflowSdkHistoryMayBeReused(sdkId);
    const raw = await client.session.summarize(request);
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
    assertOrdinarySdkSessionMayUseHistoryOperation(sdkId, 'session fork');
    const request = {
      path: { id: sdkId },
      body: messageId ? { messageID: messageId } : undefined,
    };
    assertOrdinarySdkSessionMayUseHistoryOperation(sdkId, 'session fork');
    await this.assertDayflowSdkHistoryMayBeReused(sdkId);
    const raw = await client.session.fork(request);
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
   * Strict direct-child read for exact accounting. Unlike {@link listChildren}, an
   * absent/malformed body or any element without a usable id, parent and
   * directory is `null` (never an authoritative empty list), and a transport
   * or SDK error is also `null`.
   */
  async listChildrenStrict(
    sdkId: string,
    directory: string,
  ): Promise<Array<{ id: string; parentID: string; directory: string }> | null> {
    try {
      const client = this.requireClient();
      const raw = await client.session.children({
        path: { id: sdkId },
        query: { directory },
      });
      if (raw.error || !Array.isArray(raw.data)) return null;
      const nodes: Array<{ id: string; parentID: string; directory: string }> = [];
      for (const item of raw.data as unknown[]) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        if (
          typeof record.id !== 'string' || record.id.length === 0 ||
          typeof record.parentID !== 'string' || record.parentID.length === 0 ||
          typeof record.directory !== 'string' || record.directory.length === 0
        ) return null;
        nodes.push({ id: record.id, parentID: record.parentID, directory: record.directory });
      }
      return nodes;
    } catch {
      return null;
    }
  }

  /**
   * Strict message page for exact accounting: a response error, an absent or
   * non-array body, or any element without an `info` object carrying string
   * id/role is `null` — never silently an empty page. Cursor semantics match
   * {@link listMessagesPage}.
   */
  async listMessagesPageStrict(
    sdkId: string,
    directory: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<{ messages: Array<{ info: Record<string, unknown>; parts?: unknown }>; nextCursor: string | null } | null> {
    try {
      const client = this.requireClient();
      const raw = await client.session.messages({
        path: { id: sdkId },
        query: {
          directory,
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
          ...(options.before !== undefined ? { before: options.before } : {}),
        },
      } as never);
      if (raw.error || !Array.isArray(raw.data)) return null;
      const messages: Array<{ info: Record<string, unknown>; parts?: unknown }> = [];
      for (const item of raw.data as unknown[]) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const info = (item as Record<string, unknown>).info;
        if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
        const record = info as Record<string, unknown>;
        if (typeof record.id !== 'string' || record.id.length === 0 || typeof record.role !== 'string') return null;
        messages.push({ info: record, parts: (item as Record<string, unknown>).parts });
      }
      const nextCursor = raw.response?.headers?.get('x-next-cursor') ?? null;
      return { messages, nextCursor: nextCursor || null };
    } catch {
      return null;
    }
  }

  /**
   * GET /mcp — status map for all MCP servers.
   *
   * Throws on SDK error or exception.
   */
  async listMcp(directory?: string): Promise<Record<string, import('@opencode-ai/sdk').McpStatusEntry>> {
    const client = this.requireClient();
    const raw = await client.mcp.status(directory ? { query: { directory } } : undefined);
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

  /** Lists composed tool IDs from connected MCP servers, not built-in tools. */
  async listMcpToolIds(): Promise<string[]> {
    if (!this.isReady) throw new AppError(503, 'ENGINE_UNAVAILABLE', 'OpenCode engine is not ready');
    const response = await fetch(`${this.serverUrl}/mcp/tools`);
    if (!response.ok) {
      throw new AppError(502, 'SDK_ERROR', `listMcpToolIds failed: HTTP ${response.status}`);
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data) || !data.every((value) => typeof value === 'string')) {
      throw new AppError(502, 'SDK_ERROR', 'listMcpToolIds returned an invalid response');
    }
    return data;
  }

  /** Lists the live engine tool ids used by the profile capability editor. */
  async listToolIds(): Promise<string[]> {
    const client = this.requireClient();
    const raw = await client.tool.ids();
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `listToolIds failed: ${JSON.stringify(raw.error)}`,
      );
    }
    return raw.data ?? [];
  }

  /**
   * #952 — names of MCP servers currently known to the engine, used to
   * synthesize the "all servers, deferred" allowlist for an unscoped Gemini
   * turn (see geminiUnscopedDeferredAllowlist). Non-fatal: returns [] on any
   * failure so an engine hiccup degrades to "no MCP tools this turn" rather
   * than re-introducing the unbounded 512-declaration crash. Includes every
   * server key; the fork's catalog filter only matches connected servers'
   * tools, so disconnected extras are harmless.
   */
  private async _connectedMcpServerNames(): Promise<string[]> {
    try {
      return Object.keys(await this.listMcp());
    } catch (err) {
      logger.warn('[OpencodeClientService] _connectedMcpServerNames failed (non-fatal):', err);
      return [];
    }
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
      // #1221 — an explicit add is the user's opt-in to restore a server they
      // previously deleted, so clear its durable deletion intent.
      this.writeMcpDeletion(name, false);
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

    // Live #1134 verification exposed a second cache boundary after #716:
    // mcp.add() connects the server, but mcp.status() can keep reading the
    // engine's memoized pre-write config until /config/reload runs. Require
    // that invalidation before reporting success so the immediately-following
    // GET /opencode/mcp observes the server we just added.
    if (!(await this.reloadConfig())) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `addMcp connected ${name}, but the engine config cache could not be reloaded`,
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
    opts?: { configPath?: string; register?: boolean; deletionPath?: string },
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
      timeout: 600_000,
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
    // #1221 — ensure is an explicit (re)install of the core rhythm server, so also
    // clear a durable deletion left from when it was removed while broken. A caller
    // that redirects configPath (tests) gets the deletion store beside it, never the
    // real ~/.config/rhythm/mcp-deletions.json.
    this.writeMcpDeletion(
      'rhythm',
      false,
      opts?.deletionPath ?? (opts?.configPath ? join(dirname(opts.configPath), 'mcp-deletions.json') : undefined),
    );

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
    /** #1221 — override the durable deletion store for isolated tests. */
    deletionPath?: string;
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
      existingEnvironment?: Record<string, string>,
    ): Record<string, unknown> => {
      const entry: Record<string, unknown> =
        s.type === 'remote'
          ? { type: 'remote', url: s.url }
          : { type: 'local', command: s.command };
      // #config-doctor-bug1 — preserve any user-supplied env (e.g. requiredEnv
      // secrets like OBSIDIAN_API_KEY entered via the UI) that the static
      // template doesn't know about. Template keys still win on conflict so a
      // command/host/port change in curated_mcp_servers.ts still lands.
      const env = {
        ...(existingEnvironment ?? {}),
        ...(s.environment ?? {}),
        ...(environment ?? {}),
      };
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
    const deletedServers = this.readMcpDeletions(opts?.deletionPath);
    const changedServers: CuratedMcpServer[] = [];
    for (const server of curatedServers) {
      // #1221 — deletion is authoritative across restarts. All callers,
      // including the org-optimizer installer, share this ensure guard.
      if (deletedServers.has(server.id)) continue;
      const bridgedEnv = await resolveBridgedEnv(server);
      // null → token-bridged server with no connected account: skip entirely.
      if (bridgedEnv === null) continue;
      const existing = mcpSection[server.id];
      const existingEnv =
        (existing as { environment?: Record<string, string> } | undefined)
          ?.environment ?? {};
      const desired = toEntry(server, bridgedEnv, existingEnv);
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
  async removeMcp(
    name: string,
    opts?: { deletionPath?: string },
  ): Promise<void> {
    // #723 — record the removal up front so listMcp() filters it out even
    // though the running engine keeps reporting it from in-memory state until
    // restart. Recorded before any fs/SDK work so it holds regardless of
    // whether the config write below short-circuits.
    this.markMcpRemoved(name);
    // #1221 — persist deletion intent before touching the engine/config. A
    // failure here must surface rather than acknowledge a non-durable delete.
    this.writeMcpDeletion(name, true, opts?.deletionPath);

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
    const raw = await client.pty.create({ body });
    if (raw.error) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `createPty failed: ${JSON.stringify(raw.error)}`,
      );
    }
    const d = raw.data!;
    return { id: d.id, pid: d.pid, status: d.status };
  }

  /**
   * PATCH /pty/{id} — resize a PTY session.
   *
   * Throws AppError(502) on SDK error envelope.
   */
  async resizePty(id: string, cols: number, rows: number): Promise<void> {
    const client = this.requireClient();
    const raw = await client.pty.update({
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
      await client.pty.remove({ path: { id } });
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
   * #1048 (OCU-07) — DELETE /session/{id}. Removes the engine-side session
   * (messages, parts, snapshots) so hard-deleting a Rhythm row doesn't leak
   * engine storage forever. The engine delete is recursive over child sessions,
   * so one call cleans the whole tree.
   *
   * 404-tolerant: an already-gone engine session (envelope error / no data) is
   * treated as success — hard delete must not fail because the engine record
   * was cleaned up earlier. Returns true on delete-or-already-gone, false only
   * when the SDK is not initialized. A thrown transport error propagates so the
   * caller can decide (the hard-delete path swallows it best-effort).
   */
  async deleteSession(sdkId: string, directory?: string): Promise<boolean> {
    if (!this.client) return false;
    const raw = await this.client.session.delete({
      path: { id: sdkId },
      ...(directory ? { query: { directory } } : {}),
    });
    if (raw.error) {
      // 404 / already-gone surfaces as an envelope error — tolerate it.
      logger.warn(
        `[OpencodeClientService] deleteSession: session "${sdkId}" not deleted (already gone?): ${JSON.stringify(raw.error)}`,
      );
    }
    return true;
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
