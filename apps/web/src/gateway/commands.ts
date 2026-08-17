import type { GatewayMode } from '.';

// apps/api_server/src/routes/opencode_commands_routes.ts:41-60.
export interface CommandEntry {
  name: string;
  description?: string;
  source: string;
  managed: boolean;
  hints: string[];
}

export interface CommandGateway {
  readonly mode: GatewayMode;
  // GET /opencode/commands.
  list(): Promise<CommandEntry[]>;
}

export function createLiveCommandGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): CommandGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a commands token is required');
  return {
    mode: 'live',
    list: async () => {
      const result = await fetcher(`${apiBase}/opencode/commands`, { headers: { Authorization: `Bearer ${token}` } });
      if (!result.ok) throw new Error(`Load commands failed (${result.status})`);
      return result.json() as Promise<CommandEntry[]>;
    },
  };
}
