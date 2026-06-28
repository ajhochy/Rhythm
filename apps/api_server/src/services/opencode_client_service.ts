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

type EngineStatus = 'uninitialized' | 'ready' | 'error';

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
 */
export function augmentPathForOpencode(): void {
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

  const extras: string[] = [];

  if (bundledBinDir) {
    extras.push(bundledBinDir);
  } else {
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
  if (missing.length === 0) return;
  process.env.PATH = [...missing, ...current].filter(Boolean).join(':');
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

  get isReady(): boolean {
    return this.status === 'ready';
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
    return this.authStore.listAuthedProviders();
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
   */
  async createSession(
    title: string,
    directory?: string,
    mcpRoleConfig?: {
      role: string;
      mcpServers: Record<string, unknown>;
      allowedToolsJson: string;
    },
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
  ): Promise<import('@opencode-ai/sdk').Message[]> {
    const client = this.requireClient();
    const raw = await client.session.messages({
      path: { id: sdkId },
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
  ): Promise<import('@opencode-ai/sdk').Todo[]> {
    const client = this.requireClient();
    const raw = await client.session.todo({
      path: { id: sdkId },
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
  ): Promise<import('@opencode-ai/sdk').Session[]> {
    const client = this.requireClient();
    const raw = await client.session.children({
      path: { id: sdkId },
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
    return raw.data ?? {};
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

    const desired = {
      type: 'local' as const,
      command: ['npx', '-y', '@ajhochy/rhythm-mcp-server'],
      environment: { RHYTHM_API_URL: apiUrl, RHYTHM_API_TOKEN: apiToken },
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
   * POST /session/{id}/shell — run a one-shot shell command in the session.
   *
   * OPC-M1-6 / issue #709.
   * Requires an agent name and a resolved model (the SDK refuses shell calls
   * without both). The default agent is 'build' (opencode built-in that runs
   * bash without requiring an LLM turn). `model` is passed through from the
   * caller; pass the session's resolved model so the SDK can attribute tokens.
   *
   * Returns the id of the created AssistantMessage so the Flutter tab can
   * track which chat messages originated from the Terminal tab (criterion c4).
   *
   * Throws AppError(502) on SDK error or empty data — never swallows.
   */
  async runShell(
    sdkId: string,
    command: string,
    model?: { providerID: string; modelID: string },
  ): Promise<{ messageId: string }> {
    const client = this.requireClient();
    const raw = await client.session.shell({
      path: { id: sdkId },
      body: {
        agent: 'build',
        model,
        command,
      },
    });
    if (raw.error || !raw.data) {
      throw new AppError(
        502,
        'SDK_ERROR',
        `runShell failed for session ${sdkId}: ${JSON.stringify(raw.error ?? 'no data')}`,
      );
    }
    return { messageId: raw.data.id };
  }

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
}
