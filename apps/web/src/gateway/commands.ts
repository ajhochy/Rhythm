import type { GatewayMode } from '.';

// apps/api_server/src/routes/opencode_commands_routes.ts:41-60.
export interface CommandEntry {
  name: string;
  description?: string;
  source: string;
  managed: boolean;
  hints: string[];
}

// GET /opencode/commands/:name/content response — opencode_commands_routes.ts:66-92
// (readManagedCommand). Only ever populated for a managed (Rhythm-authored) command.
export interface ManagedCommandContent {
  name: string;
  frontmatter: { description?: string; agent?: string; model?: string | null; subtask?: boolean };
  template: string;
}

export interface ManagedCommandInput {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
  template: string;
}

export interface CommandGateway {
  readonly mode: GatewayMode;
  // GET /opencode/commands.
  list(): Promise<CommandEntry[]>;
  // GET /opencode/commands/:name/content — opencode_commands_routes.ts:68-92.
  content(name: string): Promise<ManagedCommandContent>;
  // POST /opencode/commands — opencode_commands_routes.ts:96-151. Reloads the engine config
  // on success so the new slash command is dispatchable immediately.
  create(input: ManagedCommandInput): Promise<ManagedCommandContent>;
  // PUT /opencode/commands/:name — opencode_commands_routes.ts:155-216.
  update(name: string, input: ManagedCommandInput): Promise<ManagedCommandContent>;
  // DELETE /opencode/commands/:name — opencode_commands_routes.ts:220-249. Managed files only.
  remove(name: string): Promise<void>;
}

export class CommandGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) =>
  ({ 0: 'Playbook catalog service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Playbook not found', 409: 'That name is already in use' }[status] ?? `${operation} failed (${status})`);

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new CommandGatewayError(result.status, failureText(result.status, operation));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof CommandGatewayError) throw error;
    throw new CommandGatewayError(0, failureText(0, operation));
  }
}

export function createFixtureCommandGateway(): CommandGateway {
  const unsupported = async (): Promise<never> => { throw new CommandGatewayError(0, 'Fixture command gateway is unsupported'); };
  return { mode: 'fixture', list: unsupported, content: unsupported, create: unsupported, update: unsupported, remove: unsupported };
}

export function createLiveCommandGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): CommandGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a commands token is required');
  const request = (path: string, init: RequestInit = {}) =>
    fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  return {
    mode: 'live',
    list: async () => {
      const data = await response<unknown[]>('Load commands', request('/opencode/commands'));
      if (!Array.isArray(data)) return [];
      return data.map((item) => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        return {
          name: typeof record.name === 'string' ? record.name : '',
          description: typeof record.description === 'string' ? record.description : undefined,
          source: typeof record.source === 'string' ? record.source : 'command',
          managed: record.managed === true,
          hints: Array.isArray(record.hints) ? record.hints.filter((hint): hint is string => typeof hint === 'string') : [],
        };
      }).filter((entry) => entry.name);
    },
    content: (name) => response<ManagedCommandContent>('Load playbook content', request(`/opencode/commands/${encodeURIComponent(name)}/content`)),
    create: (input) => response<ManagedCommandContent>('Create playbook', request('/opencode/commands', { method: 'POST', body: JSON.stringify(input) })),
    update: (name, input) => response<ManagedCommandContent>('Update playbook', request(`/opencode/commands/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(input) })),
    remove: (name) => response<void>('Delete playbook', request(`/opencode/commands/${encodeURIComponent(name)}`, { method: 'DELETE' })),
  };
}
