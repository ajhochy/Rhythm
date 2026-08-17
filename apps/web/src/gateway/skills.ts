import type { GatewayMode } from '.';

// #792/#793/#845/#874/#929 sidecar metadata joined onto a live engine skill by name —
// apps/api_server/src/routes/opencode_skills_routes.ts:105-164. Present only when the
// caller requests `?withMetadata=true`.
export interface SkillMetadata {
  confidence: number | null;
  version: number;
  status: 'active' | 'measuring' | 'reverted' | 'draft' | 'disabled' | 'rewrite-needed' | null;
  source: string | null;
  uses: number | null;
  baselineScore: number | null;
  postScore: number | null;
  measureReason: string | null;
  isExternalFork: boolean;
  env: { missing: string[]; satisfied: boolean };
}

// apps/api_server/src/routes/opencode_skills_routes.ts:90-98,144-146.
export interface SkillEntry {
  name: string;
  description?: string;
  location: string;
  managed: boolean;
  source: 'managed' | 'org' | 'external';
  metadata?: SkillMetadata;
}

export interface SkillWriteInput { name: string; description?: string; content: string }

export interface SkillGateway {
  readonly mode: GatewayMode;
  // GET /opencode/skills?withMetadata=true — apps/api_server/src/routes/opencode_skills_routes.ts:170-302.
  list(withMetadata?: boolean): Promise<SkillEntry[]>;
  // GET /opencode/skills/:name/content — apps/api_server/src/routes/opencode_skills_routes.ts:313-342.
  content(name: string): Promise<{ name: string; content: string }>;
  // POST /system/refresh — apps/api_server/src/routes/system_routes.ts:33-54.
  reload(): Promise<{ status: string; refreshed: string[] }>;
  // POST /opencode/skills — apps/api_server/src/routes/opencode_skills_routes.ts:397-407. Managed only.
  create(input: SkillWriteInput): Promise<SkillEntry>;
  // PUT /opencode/skills/:name — apps/api_server/src/routes/opencode_skills_routes.ts:411-421. Managed only.
  update(name: string, input: Omit<SkillWriteInput, 'name'>): Promise<SkillEntry>;
  // DELETE /opencode/skills/:name — apps/api_server/src/routes/opencode_skills_routes.ts:425-456. Managed only.
  remove(name: string): Promise<void>;
}

export class SkillGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) =>
  ({ 0: 'Skill service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Skill not found', 409: 'Skill name conflict' }[status] ?? `${operation} failed (${status})`);

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new SkillGatewayError(result.status, failureText(result.status, operation));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof SkillGatewayError) throw error;
    throw new SkillGatewayError(0, failureText(0, operation));
  }
}

export function createFixtureSkillGateway(): SkillGateway {
  const unsupported = async (): Promise<never> => { throw new SkillGatewayError(0, 'Fixture skill gateway is unsupported'); };
  return { mode: 'fixture', list: unsupported, content: unsupported, reload: unsupported, create: unsupported, update: unsupported, remove: unsupported };
}

export function createLiveSkillGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): SkillGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a skills token is required');
  const request = (path: string, init: RequestInit = {}) =>
    fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  return {
    mode: 'live',
    list: (withMetadata) => response<SkillEntry[]>('Load skills', request(`/opencode/skills${withMetadata ? '?withMetadata=true' : ''}`)),
    content: (name) => response<{ name: string; content: string }>('Load skill content', request(`/opencode/skills/${encodeURIComponent(name)}/content`)),
    reload: () => response<{ status: string; refreshed: string[] }>('Reload skill catalog', request('/system/refresh', { method: 'POST' })),
    create: (input) => response<SkillEntry>('Create skill', request('/opencode/skills', { method: 'POST', body: JSON.stringify(input) })),
    update: (name, input) => response<SkillEntry>('Update skill', request(`/opencode/skills/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(input) })),
    remove: (name) => response<void>('Delete skill', request(`/opencode/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })),
  };
}
