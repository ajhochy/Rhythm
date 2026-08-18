import type { GatewayMode } from '.';

// Canonical live MCP catalog entry — apps/api_server/src/routes/opencode_mcp_routes.ts:78-159.
// `source` provenance (`curated | rhythm | adhoc`) is derived server-side from the live
// engine status map cross-referenced with the curated catalog — never a renderer guess.
export interface McpServer {
  name: string;
  status: string;
  error: string | null;
  environment?: Record<string, string>;
  requiredEnv: string[];
  needsCredentials: boolean;
  source: 'curated' | 'rhythm' | 'adhoc';
  tools: string[];
}

export interface AddMcpServerInput {
  name: string;
  command?: string;
  url?: string;
  environment?: Record<string, string>;
}

export interface McpGateway {
  readonly mode: GatewayMode;
  // GET /opencode/mcp — apps/api_server/src/routes/opencode_mcp_routes.ts:80-159.
  list(): Promise<McpServer[]>;
  // POST /opencode/mcp — apps/api_server/src/routes/opencode_mcp_routes.ts:163-213.
  add(input: AddMcpServerInput): Promise<McpServer>;
  // POST /opencode/mcp/:name/credentials — apps/api_server/src/routes/opencode_mcp_routes.ts:274-343.
  setCredentials(name: string, environment: Record<string, string>): Promise<McpServer>;
  // POST /opencode/mcp/:name/oauth/start — apps/api_server/src/routes/opencode_mcp_routes.ts:371-392.
  startOAuth(name: string): Promise<{ authorizationUrl: string }>;
  // GET /opencode/mcp/:name/oauth/status — apps/api_server/src/routes/opencode_mcp_routes.ts:395-401.
  oauthStatus(name: string): Promise<{ status: string }>;
  // POST /opencode/mcp/:name/connect — apps/api_server/src/routes/opencode_mcp_routes.ts:405-419.
  connect(name: string): Promise<{ ok: boolean; authorizationUrl: string | null }>;
  // POST /opencode/mcp/:name/disconnect — apps/api_server/src/routes/opencode_mcp_routes.ts:423-434.
  disconnect(name: string): Promise<{ ok: boolean }>;
  // DELETE /opencode/mcp/:name — apps/api_server/src/routes/opencode_mcp_routes.ts:438-449.
  remove(name: string): Promise<void>;
}

export class McpGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) =>
  ({ 0: 'MCP service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'MCP server not found' }[status] ?? `${operation} failed (${status})`);

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new McpGatewayError(result.status, failureText(result.status, operation));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof McpGatewayError) throw error;
    throw new McpGatewayError(0, failureText(0, operation));
  }
}

export function createFixtureMcpGateway(): McpGateway {
  const unsupported = async (): Promise<never> => { throw new McpGatewayError(0, 'Fixture MCP gateway is unsupported'); };
  return { mode: 'fixture', list: unsupported, add: unsupported, setCredentials: unsupported, startOAuth: unsupported, oauthStatus: unsupported, connect: unsupported, disconnect: unsupported, remove: unsupported };
}

export function createLiveMcpGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): McpGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an MCP token is required');
  const request = (path: string, init: RequestInit = {}) =>
    fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  return {
    mode: 'live',
    list: () => response<McpServer[]>('Load MCP servers', request('/opencode/mcp')),
    add: (input) => response<McpServer>('Add MCP server', request('/opencode/mcp', { method: 'POST', body: JSON.stringify(input) })),
    setCredentials: (name, environment) => response<McpServer>('Set MCP credentials', request(`/opencode/mcp/${encodeURIComponent(name)}/credentials`, { method: 'POST', body: JSON.stringify({ environment }) })),
    startOAuth: (name) => response<{ authorizationUrl: string }>('Start MCP OAuth', request(`/opencode/mcp/${encodeURIComponent(name)}/oauth/start`, { method: 'POST' })),
    oauthStatus: (name) => response<{ status: string }>('Load MCP OAuth status', request(`/opencode/mcp/${encodeURIComponent(name)}/oauth/status`)),
    connect: (name) => response<{ ok: boolean; authorizationUrl: string | null }>('Connect MCP server', request(`/opencode/mcp/${encodeURIComponent(name)}/connect`, { method: 'POST' })),
    disconnect: (name) => response<{ ok: boolean }>('Disconnect MCP server', request(`/opencode/mcp/${encodeURIComponent(name)}/disconnect`, { method: 'POST' })),
    remove: (name) => response<void>('Remove MCP server', request(`/opencode/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' })),
  };
}
