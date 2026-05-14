// Type declarations for @opencode-ai/sdk
// The SDK is ESM-only and uses "exports" in package.json, which is incompatible
// with this project's CommonJS TypeScript configuration. These minimal type
// declarations provide what OpencodeClientService needs without requiring
// TypeScript to resolve the SDK's module graph.

declare module '@opencode-ai/sdk' {
  export function createOpencode(options?: Record<string, unknown>): Promise<{
    client: OpencodeClient;
  }>;

  export function createOpencodeClient(options?: {
    baseUrl?: string;
  }): OpencodeClient;

  export interface OpencodeClient {
    config: {
      providers(): Promise<{
        providers?: Array<{ id: string; models?: Array<{ id: string; name?: string }> }>;
      }>;
    };
    auth: {
      set(options: {
        path: { id: string };
        body: { type: 'api'; key: string };
      }): Promise<boolean>;
    };
    session: {
      list(): Promise<Array<{ id: string }>>;
      create(options: { body: { title: string } }): Promise<{ id: string }>;
      prompt(options: {
        path: { id: string };
        body: {
          model?: { providerID: string; modelID: string };
          parts: Array<{ type: 'text'; text: string }>;
        };
      }): Promise<unknown>;
    };
    event: {
      subscribe(): Promise<{
        stream: AsyncIterable<{ type: string; properties?: Record<string, unknown> }>;
      }>;
    };
  }
}
