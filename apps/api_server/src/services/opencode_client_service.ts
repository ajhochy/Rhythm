import type { OpencodeClient, Event } from '@opencode-ai/sdk';
import { logger } from '../utils/logger';

type EngineStatus = 'uninitialized' | 'ready' | 'error';

export class OpencodeClientService {
  private status: EngineStatus = 'uninitialized';
  private client: OpencodeClient | null = null;
  private error: Error | null = null;

  get isReady(): boolean {
    return this.status === 'ready';
  }

  get statusMessage(): string {
    if (this.status === 'ready') return 'Opencode SDK ready';
    if (this.status === 'error')
      return `Opencode SDK error: ${this.error?.message}`;
    return 'Opencode SDK not initialized';
  }

  async initialize(config?: { directory?: string }): Promise<void> {
    try {
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
        }>;
        createOpencodeClient: (config?: {
          baseUrl?: string;
          directory?: string;
        }) => OpencodeClient;
      };
      // Use createOpencode which starts an in-process Opencode server
      const { client } = await mod.createOpencode({});
      this.client = client;
      this.status = 'ready';
      this.error = null;
      logger.info('[OpencodeClientService] SDK initialized');
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        '[OpencodeClientService] Failed to initialize:',
        this.error,
      );
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

  /** Get available models for a provider */
  async listModels(
    providerId: string,
  ): Promise<Array<{ id: string; name?: string }>> {
    if (!this.client) return [];
    try {
      const res = await this.client.config.providers();
      const provider = (res.providers ?? []).find(
        (p) => p.id === providerId,
      );
      return provider?.models ?? [];
    } catch (err) {
      logger.error(`[OpencodeClientService] listModels failed for ${providerId}:`, err);
      return [];
    }
  }

  /** Set auth credentials for a provider via API key */
  async setAuth(providerId: string, apiKey: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.auth.set({
        path: { id: providerId },
        body: { type: 'api', key: apiKey },
      });
      return true;
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
      const session = await this.client.session.create({
        body: { title },
        ...(directory ? { query: { directory } } : {}),
      });
      return { id: session.id };
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
      const result = await this.client.session.prompt({
        path: { id: sessionId },
        body: {
          model,
          parts: [{ type: 'text', text }],
        },
        ...(directory ? { query: { directory } } : {}),
      });
      return result;
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
      await this.client.session.promptAsync({
        path: { id: sessionId },
        body: {
          model,
          parts: [{ type: 'text', text }],
        },
        ...(directory ? { query: { directory } } : {}),
      });
      return true;
    } catch (err) {
      logger.error(`[OpencodeClientService] promptAsync failed for session ${sessionId}:`, err);
      return false;
    }
  }

  /** Subscribe to Opencode event stream. Returns null if not ready. */
  async subscribeToEvents(): Promise<{ stream: AsyncIterable<Event> } | null> {
    if (!this.client) return null;
    try {
      const events = await this.client.event.subscribe();
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
      const result = await this.client.provider.oauth.authorize({
        path: { id: providerId },
        body: { method: methodIndex ?? 0 },
        ...(directory ? { query: { directory } } : {}),
      });
      return {
        url: result.url,
        method: result.method,
        instructions: result.instructions,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[OpencodeClientService] getOAuthUrl failed for ${providerId}:`, err);
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
      const result = await this.client.provider.oauth.callback({
        path: { id: providerId },
        body: { method: methodIndex ?? 0, code },
        ...(directory ? { query: { directory } } : {}),
      });
      return result;
    } catch (err) {
      logger.error(`[OpencodeClientService] OAuth callback failed for ${providerId}:`, err);
      return false;
    }
  }

  /** Abort a running session */
  async abortSession(sessionId: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.session.abort({ path: { id: sessionId } });
      return true;
    } catch (err) {
      logger.error(`[OpencodeClientService] abortSession failed for ${sessionId}:`, err);
      return false;
    }
  }

  /** Clean up */
  dispose(): void {
    this.client = null;
    this.status = 'uninitialized';
  }
}
