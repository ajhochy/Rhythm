import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import type { OpencodeClient, Event } from '@opencode-ai/sdk';
import { logger } from '../utils/logger';
import { OpencodeAuthStore } from './opencode_auth_store';

type EngineStatus = 'uninitialized' | 'ready' | 'error';

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
    // If the engine was intentionally shut down, do not re-initialize.
    const svc = this as unknown as Record<string, unknown>;
    if (svc['_shuttingDown']) {
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

  /** List all provider IDs available in the SDK catalog (not auth state). */
  async listProviders(): Promise<string[]> {
    if (!this.client) return [];
    try {
      const raw = (await this.client.config.providers()) as unknown as {
        data?: { providers?: Array<{ id: string }> };
      };
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
      const raw = (await this.client.config.providers()) as unknown as {
        data?: {
          providers?: Array<{
            id: string;
            models?:
              | Array<{ id: string; name?: string }>
              | Record<string, { id?: string; name?: string }>;
          }>;
        };
      };
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
      const raw = (await this.client.auth.set({
        path: { id: providerId },
        body: { type: 'api', key: apiKey },
      })) as unknown as { data?: unknown; error?: unknown };
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
      const raw = (await this.client.session.create({
        body: { title },
        ...(directory ? { query: { directory } } : {}),
      })) as unknown as { data?: { id?: string }; error?: { message?: string } };
      const id = raw.data?.id;
      if (!id) {
        logger.error(
          '[OpencodeClientService] createSession failed: SDK returned %s %s',
          raw.error ? `error="${raw.error.message ?? JSON.stringify(raw.error)}"` : 'no id',
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
      const raw = (await this.client.session.prompt({
        path: { id: sessionId },
        body: {
          model,
          parts: [{ type: 'text', text }],
        },
        ...(directory ? { query: { directory } } : {}),
      })) as unknown as {
        data?: {
          info: import('@opencode-ai/sdk').Message;
          parts: Array<import('@opencode-ai/sdk').Part>;
        };
        error?: unknown;
      };
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
  async promptAsync(
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
    directory?: string,
  ): Promise<boolean> {
    if (!this.client) return false;
    try {
      const raw = (await this.client.session.promptAsync({
        path: { id: sessionId },
        body: {
          model,
          parts: [{ type: 'text', text }],
        },
        ...(directory ? { query: { directory } } : {}),
      })) as unknown as { data?: unknown; error?: unknown };
      if (raw.error) {
        logger.error(`[OpencodeClientService] promptAsync error for ${sessionId}:`, raw.error);
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
      const events = await this.client.event.subscribe(
        directory ? { query: { directory } } : undefined,
      );
      return events as unknown as { stream: AsyncIterable<Event> };
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
      const raw = (await this.client.provider.oauth.authorize({
        path: { id: providerId },
        body: { method: methodIndex ?? 0 },
        ...(directory ? { query: { directory } } : {}),
      })) as unknown as {
        data?: { url: string; method: string; instructions: string };
        error?: { data?: { message?: string } };
      };
      if (raw.error || !raw.data) {
        const message = raw.error?.data?.message ?? 'Unknown SDK error';
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
      const raw = (await this.client.provider.oauth.callback({
        path: { id: providerId },
        body: { method: methodIndex ?? 0, code },
        ...(directory ? { query: { directory } } : {}),
      })) as unknown as { data?: unknown; error?: unknown };
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
   */
  async respondPermission(
    sessionId: string,
    permissionId: string,
    decision: 'accept' | 'deny',
  ): Promise<boolean> {
    if (!this.client) return false;
    try {
      const sessionClient = this.client.session as unknown as Record<string, unknown>;
      const permApi = sessionClient['permission'] as {
        respond?: (opts: {
          path: { id: string; permissionId: string };
          body: { decision: 'accept' | 'deny' };
        }) => Promise<unknown>;
      } | undefined;
      if (!permApi || typeof permApi.respond !== 'function') {
        logger.info('[OpencodeClientService] SDK does not expose session.permission.respond — skipping');
        return false;
      }
      await permApi.respond({
        path: { id: sessionId, permissionId },
        body: { decision },
      });
      return true;
    } catch (err) {
      logger.error(`[OpencodeClientService] respondPermission failed for session ${sessionId}:`, err);
      return false;
    }
  }

  /** Abort a running session */
  async abortSession(sessionId: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      const raw = (await this.client.session.abort({
        path: { id: sessionId },
      })) as unknown as { data?: unknown; error?: unknown };
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
      const raw = (await this.client.auth.set({
        path: { id: providerId },
        body: {
          type: 'oauth',
          access: creds.access,
          refresh: creds.refresh,
          expires: creds.expires,
        } as unknown as { type: 'api'; key: string },
      })) as unknown as { data?: unknown; error?: unknown };
      return raw.data === true;
    } catch (err) {
      logger.error(`[OpencodeClientService] setOAuthCredentials failed for ${providerId}:`, err);
      return false;
    }
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
    this.server = null;
    this.client = null;
    this.status = 'uninitialized';
  }
  private _disposeLogged = false;
}
