import type { OpencodeClient } from '@opencode-ai/sdk';
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

  async initialize(): Promise<void> {
    try {
      // Dynamic import — SDK is ESM-only, api_server uses CommonJS.
      // Node.js import() can load ESM modules from CJS at runtime.
      const mod = (await import('@opencode-ai/sdk')) as {
        createOpencode: (opts?: Record<string, unknown>) => Promise<{
          client: OpencodeClient;
        }>;
      };
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

  /** List connected provider IDs (e.g. ['anthropic', 'openai']) */
  async listProviders(): Promise<string[]> {
    if (!this.client) return [];
    try {
      const res = await this.client.config.providers();
      const providers = res.providers ?? [];
      return providers.map((p) => p.id);
    } catch {
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
    } catch {
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
    } catch {
      return false;
    }
  }

  /** Create a new Opencode session */
  async createSession(
    title: string,
  ): Promise<{ id: string } | null> {
    if (!this.client) return null;
    try {
      const session = await this.client.session.create({
        body: { title },
      });
      return { id: session.id };
    } catch {
      return null;
    }
  }

  /** Send a prompt to a session and get the response */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async prompt(
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
  ): Promise<any | null> {
    if (!this.client) return null;
    try {
      const result = await this.client.session.prompt({
        path: { id: sessionId },
        body: {
          model,
          parts: [{ type: 'text', text }],
        },
      });
      return result;
    } catch {
      return null;
    }
  }

  /** Subscribe to Opencode event stream. Returns null if not ready. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async subscribeToEvents(): Promise<any | null> {
    if (!this.client) return null;
    try {
      const events = await this.client.event.subscribe();
      return events;
    } catch {
      return null;
    }
  }

  /** Clean up */
  dispose(): void {
    this.client = null;
    this.status = 'uninitialized';
  }
}
