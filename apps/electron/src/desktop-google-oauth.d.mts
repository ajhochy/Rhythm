import type { DesktopAuthLoginResponse } from './google-oauth-core.mjs';

export function runDesktopGoogleOAuth(input: {
  clientId: string;
  apiBase: string;
  openExternal(url: string): Promise<void>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  createLoopbackServer?: typeof import('node:http').createServer;
  onListening?(details: { address: '127.0.0.1'; port: number; callbackUrl: string }): void;
}): Promise<DesktopAuthLoginResponse>;
