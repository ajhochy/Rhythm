import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { promisify } from 'util';
import type { OpencodeClient, Event } from '@opencode-ai/sdk';
import { logger } from '../utils/logger';
import { OpencodeAuthStore } from './opencode_auth_store';
import { AppError } from '../errors/app_error';

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
 */
export function augmentPathForOpencode(): void {
  const extras = [
    join(homedir(), '.opencode', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
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

  private async _initializeImpl(config?: { directory?: string }): Promise<void> {
    try {
      augmentPathForOpencode();
      // Dynamic import — SDK is ESM-only, api_server uses CommonJS.
      // TS with module:commonjs rewrites `import()` to `require()`, which
      // fails on ESM-only packages. The `Function` wrapper hides the call
      // from the TS transformer so Node executes a real dynamic import.
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
      // #655 — Before spawning, reclaim :4096 from a stale opencode orphan
      // (e.g. one reparented to launchd after a Force-Quit / SIGKILL). A bound
      // port makes the SDK's fresh spawn exit code 1 ("engine not ready"). A
      // non-opencode holder throws a clear error (caught below → status=error
      // with the occupying PID/command) instead of the opaque exit-code-1.
      await reclaimStalePortForOpencode();

      // Use createOpencode which starts an in-process Opencode server.
      // `server.close()` is the only documented way to stop the spawned
      // opencode subprocess on :4096 — we MUST hold this handle for clean
      // shutdown (see dispose()).
      const { client, server } = await mod.createOpencode({});
      this.client = client;
      this.server = server;
      this.status = 'ready';
      this.error = null;
      logger.info('[OpencodeClientService] SDK initialized');
      // Restore persisted auth credentials into the fresh SDK instance.
      // auth.json is written by client.auth.set() from previous runs but
      // createOpencode() starts a clean server that doesn't auto-load it.
      await this.restoreAuth();
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
  ): Promise<Array<{ id: string; name?: string }>> {
    if (!this.client) return [];
    try {
      const raw = await this.client.config.providers();
      const providers = raw.data?.providers ?? [];
      const provider = providers.find((p) => p.id === providerId);
      const models = provider?.models;
      if (Array.isArray(models)) return models;
      if (models && typeof models === 'object') {
        return Object.entries(models).map(([id, model]) => ({
          id: model.id ?? id,
          name: model.name,
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

  /** Create a new Opencode session with an optional working directory */
  async createSession(
    title: string,
    directory?: string,
  ): Promise<{ id: string } | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.session.create({
        body: { title },
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
  ): Promise<{ info: import('@opencode-ai/sdk').Message; parts: Array<import('@opencode-ai/sdk').Part> } | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.session.prompt({
        path: { id: sessionId },
        body: {
          model,
          parts: [{ type: 'text', text }],
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
      if (!raw.data) {
        logger.warn(
          `[OpencodeClientService] promptAsync silent no-op for ${sessionId}: SDK returned neither data nor error (model may not be supported)`,
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
  ): Promise<boolean> {
    if (!this.client) return false;
    try {
      // Map old 'accept'/'deny' to the SDK's 'once'/'reject' convention.
      const sdkDecision: 'once' | 'always' | 'reject' =
        decision === 'accept' ? 'once' : 'reject';
      await this.respondToPermission(sessionId, permissionId, sdkDecision);
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
    await client.postSessionIdPermissionsPermissionId({
      path: { id: sdkId, permissionID: permissionId },
      body: { response: decision },
    });
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
  ): Promise<boolean> {
    const client = this.requireClient();
    const raw = await client.session.summarize({
      path: { id: sdkId },
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
   */
  async addMcp(
    name: string,
    config: import('@opencode-ai/sdk').McpLocalConfigInput | import('@opencode-ai/sdk').McpRemoteConfigInput,
  ): Promise<Record<string, import('@opencode-ai/sdk').McpStatusEntry>> {
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
   * POST /mcp/{name}/connect — connect a named MCP server.
   *
   * OPC-M4-3: throws AppError on SDK error envelope (never swallows to false).
   */
  async connectMcp(name: string): Promise<boolean> {
    const client = this.requireClient();
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
