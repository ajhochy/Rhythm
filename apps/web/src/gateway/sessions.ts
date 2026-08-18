import type { Profile, Session, TranscriptBlock, TranscriptMessage } from '../types';
import type { GatewayMode } from '.';

export type SessionWireEvent = {
  v?: number;
  type: string;
  id?: string;
  data?: unknown;
  session?: unknown;
  messageId?: string;
  partId?: string;
  field?: string;
  delta?: string;
  working?: boolean;
  status?: string;
  attempt?: number;
  reason?: string;
  part?: unknown;
  info?: unknown;
  // notification.push frame — apps/api_server/src/controllers/notifications_agent_controller.ts:6-32;
  // broadcast shape {v:1,type:'notification.push',id,title,body} at apps/api_server/src/app.ts:155-157.
  title?: string;
  body?: string;
  // post-m1-phase-5: permission.asked/permission.replied and question.asked/question.resolved
  // frames — canonical shapes only, never a raw engine literal. sessionId here is the LOCAL
  // session id (never the SDK id). apps/api_server/src/services/opencode_stream_bridge.ts:359-391,535-556;
  // apps/api_server/src/controllers/agent_sessions_controller.ts:1369-1417,1423-1502.
  sessionId?: string;
  permissionID?: string;
  directory?: string;
  tool?: string;
  patterns?: string[];
  createdAt?: string;
  requestId?: string;
  callId?: string;
  questions?: unknown[];
  rejected?: boolean;
};
export type SessionSocket = { send(frame: unknown): void; close(): void };
export type TranscriptPageInfo = { nextCursor: string | null; hasMore: boolean };
// apps/api_server/src/services/tool_surface_estimator.ts:39-52.
export type ToolSurfaceServerEntry = { name: string; toolCount: number; estimatedTokens: number };
export type ToolSurfaceReport = { mcpRole: string | null; servers: ToolSurfaceServerEntry[]; builtins: ToolSurfaceServerEntry; totalToolCount: number; totalEstimatedTokens: number };

// post-m1-phase-6: canonical file/diff/worktree boundary shapes. Field vocabulary verified
// against apps/api_server/src/routes/agent_sessions_routes.ts:86-94,110-112,121-122 and
// apps/api_server/src/controllers/agent_sessions_controller.ts:2441-2539 (files/vcs proxy),
// :1616-1659 (worktree reset/remove), :1817-1846 (revert/unrevert).
export interface SessionFileEntry { name: string; type?: string }
export interface SessionFileStatusEntry { path: string; status?: string }
// GET /:id/files/content response spreads the engine body + a server-added `resolvedPath`
// (secret-bearing absolute path) — the gateway strips that field before it ever reaches a
// component; never forward it to the renderer (post-m1-p6-c2b).
export interface SessionFileContent { content?: string; type?: string; mimeType?: string; encoding?: string }
// GET /:id/diff — exactly @opencode-ai/sdk's FileDiff shape (node_modules/@opencode-ai/sdk/gen/types.gen.d.ts:32-38).
export interface SessionFileDiffEntry { file: string; before: string; after: string; additions: number; deletions: number }
// GET /:id/vcs/diff?mode=git|branch — canonical {file,patch?,additions,deletions,status?} (post-m1-p6-c2d).
export interface SessionVcsDiffEntry { file: string; patch?: string; additions: number; deletions: number; status?: string }
// GET /projects/:id/branches — apps/api_server/src/controllers/projects_controller.ts:161-175.
export interface ProjectBranches { current: string | null; local: string[]; recent: string[] }

export interface SessionGateway {
  readonly mode: GatewayMode;
  profiles(): Promise<Profile[]>;
  list(): Promise<Session[]>;
  detail(localId: string): Promise<Session>;
  create(input: { profileId: string; cwd: string; name: string; isolateWorktree: boolean; worktreeName?: string; branch?: string; createBranch?: boolean; stash?: 'stash' | 'discard' }): Promise<Session>;
  // post-m1-phase-6 c1b/c2a: GET /:id/files/find-files?query&limit&type — returns relative paths.
  findFiles(localId: string, query: string, opts?: { limit?: number; type?: 'file' | 'directory' }): Promise<string[]>;
  // GET /:id/files/list?path — engine-shaped entries scoped to the session/worktree directory.
  listFiles(localId: string, path?: string): Promise<SessionFileEntry[]>;
  // GET /:id/files/content?path — never exposes the server's `resolvedPath`.
  fileContent(localId: string, path: string): Promise<SessionFileContent>;
  // GET /:id/files/status
  fileStatus(localId: string): Promise<SessionFileStatusEntry[]>;
  // GET /:id/diff — canonical session FileDiff[] (post-m1-p6-c2c).
  sessionDiff(localId: string): Promise<SessionFileDiffEntry[]>;
  // GET /:id/vcs/diff?mode=git|branch (post-m1-p6-c2d).
  vcsDiff(localId: string, mode: 'git' | 'branch'): Promise<SessionVcsDiffEntry[]>;
  // GET /:id/vcs/diff/raw — raw text/x-diff patch, never re-encoded (post-m1-p6-c2e).
  vcsDiffRaw(localId: string): Promise<string>;
  // POST /:id/revert {messageId} / POST /:id/unrevert (post-m1-p6-c2f).
  revert(localId: string, messageId: string): Promise<void>;
  unrevert(localId: string): Promise<void>;
  // POST /:id/worktree/reset — surfaces the bounded 502 WORKTREE_RESET_FAILED (post-m1-p6-c3d).
  resetWorktree(localId: string): Promise<void>;
  // POST /:id/worktree/remove — surfaces the bounded 502 WORKTREE_REMOVE_FAILED; returns the
  // updated session with worktree metadata cleared (post-m1-p6-c3e).
  removeWorktreeSession(localId: string): Promise<Session>;
  // GET /projects/:id/branches (post-m1-p6-c3a).
  branches(projectId: string): Promise<ProjectBranches>;
  // #841 — GET /:id/tool-surface — apps/api_server/src/controllers/agent_sessions_controller.ts:2199-2260,
  // apps/api_server/src/services/tool_surface_estimator.ts:39-52 (post-m1-p5-c3f).
  toolSurface(localId: string): Promise<ToolSurfaceReport>;
  // post-m1-p5-c3f: real and callable, but always rejects. The opencode engine has no primitive
  // to execute a single MCP tool for a session outside a model-originated MCP App interactive
  // binding (client.session.mcpAppExecution needs a live callId+proof issued FOR that specific
  // model-created request — opencode_client_service.ts:2741-2764); there is no generic "run this
  // tool now" endpoint (checked the full tool.*/mcp.* surface in
  // services/mobile_opencode_operations.generated.ts). Honest rejection here, not a fabricated
  // success, until the engine gains that capability.
  dispatchMcp(localId: string, server: string, tool: string, args: Record<string, unknown>): Promise<never>;
  createProfile(input: ProfileMutation): Promise<Profile>;
  patchProfile(id: string, input: ProfileMutation): Promise<Profile>;
  deleteProfile(id: string): Promise<void>;
  hardDelete(localId: string): Promise<void>;
  cancel(localId: string): Promise<void>;
  resume(localId: string): Promise<Session>;
  // post-m1-phase-5 c1e: the ONLY supported values are the canonical default|acceptEdits|plan|
  // bypassPermissions — display labels never cross this boundary. PATCH body is exactly
  // {permissionMode}. apps/api_server/src/models/agent_session.ts:22-34,92.
  updatePermissionMode(localId: string, mode: string): Promise<void>;
  childMessages(parentLocalId: string, childSdkId: string): Promise<TranscriptMessage[]>;
  // post-m1-phase-4 c2f: canonical older-page pagination.
  // apps/api_server/src/controllers/agent_sessions_controller.ts:2365-2393 — GET .../messages?limit=&before=
  // returns { messages, pageInfo: { nextCursor, hasMore } }.
  pageOlder(localId: string, before: string): Promise<{ messages: TranscriptMessage[]; pageInfo: TranscriptPageInfo }>;
  /** onReconnect fires after every OPEN that is not the first — never on initial connect. */
  connect(onEvent: (event: SessionWireEvent) => void, onError: () => void, onReconnect?: () => void): SessionSocket;
}

export interface ProfileMutation {
  label: string;
  icon: string;
  enabled: boolean;
  isAgent: boolean;
  isManager: boolean;
  systemPrompt: string | null;
  allowedMcpsJson: string | null;
  allowedSkillsJson: string | null;
  corePermissionsJson: string | null;
  allowedDelegatesJson: string | null;
  presetId: string | null;
  sortOrder: number;
  modelProvider: string | null;
  modelId: string | null;
  ocAgent: string | null;
  sessionSelectable: boolean;
  modelTierHint: string | null;
  defaultAnthropicAccountId: string | null;
}

export class SessionGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) => {
  const label: Record<number, string> = { 0: 'Session service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Session not found' };
  return label[status] ?? `${operation} failed (${status})`;
};

async function response<T>(operation: string, request: Promise<Response>): Promise<T> {
  try {
    const result = await request;
    if (!result.ok) {
      // Prefer the server's own explanation (e.g. the 410 "SDK session ... no longer
      // exists" body) over a generic label — callers (resume's start-fresh state)
      // need the honest, specific text, not a collapsed "Session not found".
      let detail: string | undefined;
      try {
        const body = await result.clone().json();
        if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string') {
          detail = (body as Record<string, unknown>).error as string;
        }
      } catch { /* body is not JSON — fall back to the generic label */ }
      throw new SessionGatewayError(result.status, detail ?? failureText(result.status, operation));
    }
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof SessionGatewayError) throw error;
    throw new SessionGatewayError(0, failureText(0, operation));
  }
}

const string = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
// A persisted message's canonical identity is its (possibly numeric) `sdkMessageId`/`id` —
// `string()` above intentionally rejects numbers, so message-id resolution needs its own
// coercion instead of silently collapsing every numeric id to ''.
const idOf = (value: unknown): string | undefined => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;

// c2j (child-session navigation) only: a `tool` part whose `tool` is `task` names the
// child SDK session it delegated to inline in its output text ("task_id: <id> (for
// resuming...)"). Surface it as a clickable `children` block carrying that id so the
// transcript can open the child by its own SDK identity — never the local row id.
// Every other part kind still falls through to the plain-markdown mapping below;
// richer per-type rendering (reasoning/tool/file/agent) is a separate concern.
const TASK_ID_PATTERN = /task_id:\s*(\S+)/;

export function mapPart(raw: Record<string, unknown>, id: string): TranscriptBlock {
  if (raw.type === 'tool' && raw.tool === 'task') {
    const state = record(raw.state);
    const match = TASK_ID_PATTERN.exec(string(state.output));
    return { id, kind: 'children', content: string(state.title, 'Child session'), meta: string(state.status), childSessionId: match?.[1] };
  }
  // post-m1-phase-4 c2d: preserve every other canonical part type instead of collapsing it to
  // markdown. Field vocabulary from apps/api_server/src/services/opencode_stream_bridge.ts:1250-1339.
  if (raw.type === 'reasoning') return { id, kind: 'reasoning', title: 'Reasoning', content: string(raw.text) };
  if (raw.type === 'tool') {
    const state = record(raw.state);
    return { id, kind: 'tool', title: string(state.title, string(raw.tool, 'Tool')), content: string(state.output), meta: string(state.status) };
  }
  if (raw.type === 'step-start') return { id, kind: 'step-start', content: string(raw.snapshot) };
  if (raw.type === 'step-finish') return { id, kind: 'step-finish', content: string(raw.snapshot), meta: string(raw.reason) };
  if (raw.type === 'compaction') return { id, kind: 'compaction', content: raw.auto === true ? 'Context compacted automatically' : 'Context compacted' };
  if (raw.type === 'file') return { id, kind: 'file', title: string(raw.filename), content: string(raw.url), meta: string(raw.mime) };
  if (raw.type === 'agent') { const source = record(raw.source); return { id, kind: 'agent', title: string(raw.name, 'Agent'), content: string(source.value) }; }
  return { id, kind: 'markdown', content: string(raw.text, string(raw.content)) };
}

function mapMessage(value: unknown): TranscriptMessage {
  const source = record(value);
  const info = record(source.info);
  const parts = Array.isArray(source.parts) ? source.parts : [];
  const wireRole = string(info.role, string(source.role));
  const role = wireRole === 'input' ? 'user' : wireRole === 'output' ? 'assistant' : wireRole;
  // c2f/c2d: prefer the canonical SDK message id (stable across reload) over the internal
  // numeric row id, and over the raw-SDK `info.id` shape used by live (non-REST) frames.
  const id = idOf(source.sdkMessageId) ?? idOf(info.id) ?? idOf(source.id) ?? '';
  return {
    id,
    role: ['user', 'assistant', 'system'].includes(role) ? role as TranscriptMessage['role'] : 'system',
    createdAt: string(info.time?.toString?.(), string(source.createdAt, new Date(0).toISOString())),
    blocks: parts.map((part, index) => mapPart(record(part), string(record(part).id, `${id}-${index}`))),
  };
}

export function toSessionViewModel(value: unknown, messages: unknown[] = [], transcriptPage?: unknown): Session {
  const source = record(value);
  const status = string(source.status, source.working === true ? 'working' : 'idle');
  const page = record(transcriptPage);
  return {
    id: string(source.id), name: string(source.name, 'Untitled session'), scope: source.scope === 'scheduled' || source.scope === 'background' ? source.scope : 'chats',
    group: source.archived === true ? 'archived' : status === 'resumable' || status === 'closed' ? 'resumable' : 'active',
    status: ['starting', 'working', 'idle', 'resumable', 'closed', 'error'].includes(status) ? status as Session['status'] : 'idle',
    connectionState: 'online', profileId: string(source.profileId, string(source.profile_id)), projectId: string(source.projectId, string(source.project_id)), projectName: string(source.projectName, 'Live workspace'),
    cwd: string(source.cwd), branch: string(source.branch, 'main'), dirtyCount: 0, isolateWorktree: source.isolateWorktree === true || Boolean(source.worktreePath), account: string(source.anthropicAccountId),
    // post-m1-phase-6 c3b/c3d/c3e: the resolved isolated-worktree identity — never defaulted
    // to 'main' or synthesized client-side. apps/api_server/src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts:96-100.
    worktreeName: typeof source.worktreeName === 'string' && source.worktreeName ? source.worktreeName : undefined,
    worktreePath: typeof source.worktreePath === 'string' && source.worktreePath ? source.worktreePath : undefined,
    worktreeBranch: typeof source.worktreeBranch === 'string' && source.worktreeBranch ? source.worktreeBranch : undefined,
    model: string(source.modelId, 'Configured model'), modelId: string(source.modelId) || undefined, providerId: string(source.providerId) || undefined, sdkSessionId: string(source.sdkSessionId) || undefined, thinkingBudget: 'Medium', permissionMode: string(source.permissionMode, 'default'), fastMode: source.fastMode === true,
    createdAt: string(source.createdAt, new Date(0).toISOString()), updatedAt: string(source.updatedAt, string(source.createdAt, new Date(0).toISOString())), cost: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalBudget: 0,
    // post-m1-phase-5 c2d: preserve canonical delegation identity instead of dropping it — a
    // child's parentSessionId is what makes its transcript/composer read-only, never a fixture-only
    // `parentId`. apps/api_server/src/models/agent_session.ts:46-145.
    parentSessionId: typeof source.parentSessionId === 'string' && source.parentSessionId ? source.parentSessionId : undefined,
    opencodeAgentId: string(source.opencodeAgentId) || undefined,
    delegationDepth: typeof source.delegationDepth === 'number' ? source.delegationDepth : undefined,
    childIds: [], messages: messages.map(mapMessage), artifacts: [],
    transcriptCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null,
    transcriptHasMore: page.hasMore === true,
  };
}

function mapProfile(value: unknown): Profile {
  const source = record(value);
  const modelProvider = typeof source.modelProvider === 'string' ? source.modelProvider : null;
  const modelId = typeof source.modelId === 'string' ? source.modelId : null;
  const parseList = (raw: unknown) => {
    try { const parsed = JSON.parse(string(raw, '[]')); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; }
    catch { return []; }
  };
  const parsePermissions = (raw: unknown): Profile['permissionRules'] => {
    try { return record(JSON.parse(string(raw, '{}'))) as Profile['permissionRules']; }
    catch { return {}; }
  };
  return {
    id: string(source.id), icon: string(source.icon, 'AG'), label: string(source.label, string(source.id)),
    systemPrompt: string(source.systemPrompt), managerAgent: source.isManager === true,
    allowedDelegates: parseList(source.allowedDelegatesJson), selectable: source.sessionSelectable !== false,
    enabled: source.enabled !== false, modelProvider, modelId,
    provider: modelProvider ?? 'Configured', model: modelId ?? 'Configured model', defaultAccount: '',
    mcps: parseList(source.allowedMcpsJson), skills: parseList(source.allowedSkillsJson),
    permissionRules: parsePermissions(source.corePermissionsJson), managedSkills: false,
    isDefault: source.isDefault === true, updatedAt: string(source.updatedAt, new Date(0).toISOString()),
    isAgent: source.isAgent !== false, isManager: source.isManager === true,
    allowedMcpsJson: typeof source.allowedMcpsJson === 'string' ? source.allowedMcpsJson : null,
    allowedSkillsJson: typeof source.allowedSkillsJson === 'string' ? source.allowedSkillsJson : null,
    corePermissionsJson: typeof source.corePermissionsJson === 'string' ? source.corePermissionsJson : null,
    allowedDelegatesJson: typeof source.allowedDelegatesJson === 'string' ? source.allowedDelegatesJson : null,
    presetId: typeof source.presetId === 'string' ? source.presetId : null,
    sortOrder: typeof source.sortOrder === 'number' ? source.sortOrder : 0,
    ocAgent: typeof source.ocAgent === 'string' ? source.ocAgent : null,
    sessionSelectable: source.sessionSelectable !== false,
    modelTierHint: typeof source.modelTierHint === 'string' ? source.modelTierHint : null,
    defaultAnthropicAccountId: typeof source.defaultAnthropicAccountId === 'string' ? source.defaultAnthropicAccountId : null,
  };
}

export function createFixtureSessionsGateway(_fetcher?: typeof fetch): SessionGateway {
  const unsupported = async (): Promise<never> => { throw new SessionGatewayError(0, 'Fixture sessions gateway is unsupported'); };
  return {
    mode: 'fixture', profiles: unsupported, list: unsupported, detail: unsupported, create: unsupported, createProfile: unsupported, patchProfile: unsupported, deleteProfile: unsupported, hardDelete: unsupported, cancel: unsupported, resume: unsupported, childMessages: unsupported, pageOlder: unsupported, updatePermissionMode: unsupported,
    findFiles: unsupported, listFiles: unsupported, fileContent: unsupported, fileStatus: unsupported, sessionDiff: unsupported, vcsDiff: unsupported, vcsDiffRaw: unsupported, revert: unsupported, unrevert: unsupported, resetWorktree: unsupported, removeWorktreeSession: unsupported, branches: unsupported, toolSurface: unsupported, dispatchMcp: unsupported,
    connect: () => ({ send: () => undefined, close: () => undefined }),
  };
}

export function createLiveSessionsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch, WebSocketImpl: typeof WebSocket = WebSocket): SessionGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit live token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  return {
    mode: 'live',
    profiles: async () => (await response<unknown[]>('Load profiles', request('/agent-configs'))).map(mapProfile),
    list: async () => {
      const body = await response<{ sessions?: unknown[] }>('Load sessions', request('/agent-sessions?scope=chats'));
      return (body.sessions ?? []).map((item) => toSessionViewModel(item));
    },
    detail: async (localId) => {
      const body = await response<{ session: unknown; messages?: unknown[]; transcriptPage?: unknown }>('Load session', request(`/agent-sessions/${encodeURIComponent(localId)}?transcriptLimit=50`));
      return toSessionViewModel(body.session, body.messages ?? [], body.transcriptPage);
    },
    // post-m1-phase-4 c2f: exclusive `before` cursor, canonical `pageInfo.nextCursor`/`hasMore`.
    pageOlder: async (localId, before) => {
      const body = await response<{ messages?: unknown[]; pageInfo?: TranscriptPageInfo }>(
        'Load older messages',
        request(`/agent-sessions/${encodeURIComponent(localId)}/messages?limit=50&before=${encodeURIComponent(before)}`),
      );
      return { messages: (body.messages ?? []).map(mapMessage), pageInfo: body.pageInfo ?? { nextCursor: null, hasMore: false } };
    },
    create: async (input) => toSessionViewModel(await response<unknown>('Create session', request('/agent-sessions', { method: 'POST', body: JSON.stringify(input) }))),
    createProfile: async (input) => mapProfile(await response<unknown>('Create profile', request('/agent-configs', { method: 'POST', body: JSON.stringify(input) }))),
    patchProfile: async (id, input) => mapProfile(await response<unknown>('Update profile', request(`/agent-configs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }))),
    deleteProfile: async (id) => response<void>('Delete profile', request(`/agent-configs/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    hardDelete: async (localId) => response<void>('Delete session', request(`/agent-sessions/${encodeURIComponent(localId)}/hard`, { method: 'DELETE', body: JSON.stringify({ removeWorktree: true }) })),
    cancel: async (localId) => response<void>('Cancel session', request(`/agent-sessions/${encodeURIComponent(localId)}/cancel`, { method: 'POST' })),
    // post-m1-phase-5 c1e: exactly {permissionMode} — no other fields ride along.
    updatePermissionMode: async (localId, mode) => response<void>('Update permission mode', request(`/agent-sessions/${encodeURIComponent(localId)}`, { method: 'PATCH', body: JSON.stringify({ permissionMode: mode }) })),
    // OPC-M1-5 resume: re-attaches the persisted sdkSessionId server-side. A 410 (the
    // SDK session is gone) surfaces the server's own explanatory text via SessionGatewayError
    // rather than a generic label — the caller renders it verbatim as the start-fresh state.
    resume: async (localId) => toSessionViewModel(await response<unknown>('Resume session', request(`/agent-sessions/${encodeURIComponent(localId)}/resume`, { method: 'POST' }))),
    // post-m1-phase-6 c1b/c2a: relative paths only — never absolute, never a fixture list.
    findFiles: async (localId, query, opts) => {
      const params = new URLSearchParams({ query });
      if (opts?.limit != null) params.set('limit', String(opts.limit));
      if (opts?.type) params.set('type', opts.type);
      const data = await response<unknown>('Find files', request(`/agent-sessions/${encodeURIComponent(localId)}/files/find-files?${params.toString()}`));
      return Array.isArray(data) ? data.filter((item): item is string => typeof item === 'string') : [];
    },
    listFiles: async (localId, path = '') => {
      const data = await response<unknown>('List files', request(`/agent-sessions/${encodeURIComponent(localId)}/files/list?path=${encodeURIComponent(path)}`));
      return Array.isArray(data) ? data.map((item) => record(item)).map((item) => ({ name: string(item.name), type: string(item.type) || undefined })) : [];
    },
    fileContent: async (localId, path) => {
      const data = record(await response<unknown>('Load file content', request(`/agent-sessions/${encodeURIComponent(localId)}/files/content?path=${encodeURIComponent(path)}`)));
      // c2b: `resolvedPath` is a secret-bearing absolute path — deliberately dropped here so it
      // can never reach a component, even if a future response shape starts including it.
      return { content: typeof data.content === 'string' ? data.content : undefined, type: string(data.type) || undefined, mimeType: string(data.mimeType) || undefined, encoding: string(data.encoding) || undefined };
    },
    fileStatus: async (localId) => {
      const data = await response<unknown>('Load file status', request(`/agent-sessions/${encodeURIComponent(localId)}/files/status`));
      return Array.isArray(data) ? data.map((item) => record(item)).map((item) => ({ path: string(item.path), status: string(item.status) || undefined })) : [];
    },
    sessionDiff: async (localId) => {
      const data = await response<unknown>('Load session diff', request(`/agent-sessions/${encodeURIComponent(localId)}/diff`));
      return Array.isArray(data) ? data.map((item) => record(item)).map((item) => ({ file: string(item.file), before: string(item.before), after: string(item.after), additions: Number(item.additions) || 0, deletions: Number(item.deletions) || 0 })) : [];
    },
    vcsDiff: async (localId, mode) => {
      const data = await response<unknown>('Load VCS diff', request(`/agent-sessions/${encodeURIComponent(localId)}/vcs/diff?mode=${mode}`));
      return Array.isArray(data) ? data.map((item) => record(item)).map((item) => ({ file: string(item.file), patch: typeof item.patch === 'string' ? item.patch : undefined, additions: Number(item.additions) || 0, deletions: Number(item.deletions) || 0, status: string(item.status) || undefined })) : [];
    },
    // c2e: the raw text/x-diff patch — never routed through response()'s JSON parsing, so the
    // exact exported bytes are preserved instead of being re-encoded through a display string.
    vcsDiffRaw: async (localId) => {
      const result = await request(`/agent-sessions/${encodeURIComponent(localId)}/vcs/diff/raw`);
      if (!result.ok) throw new SessionGatewayError(result.status, failureText(result.status, 'Export patch'));
      return result.text();
    },
    revert: async (localId, messageId) => { await response<void>('Revert session', request(`/agent-sessions/${encodeURIComponent(localId)}/revert`, { method: 'POST', body: JSON.stringify({ messageId }) })); },
    unrevert: async (localId) => { await response<void>('Restore session', request(`/agent-sessions/${encodeURIComponent(localId)}/unrevert`, { method: 'POST' })); },
    // c3d/c3e: both surface the server's bounded 502 (WORKTREE_RESET_FAILED/WORKTREE_REMOVE_FAILED)
    // as a SessionGatewayError instead of swallowing it into a false "success".
    resetWorktree: async (localId) => { await response<void>('Reset worktree', request(`/agent-sessions/${encodeURIComponent(localId)}/worktree/reset`, { method: 'POST' })); },
    removeWorktreeSession: async (localId) => toSessionViewModel(await response<unknown>('Remove worktree', request(`/agent-sessions/${encodeURIComponent(localId)}/worktree/remove`, { method: 'POST' }))),
    branches: async (projectId) => {
      const data = record(await response<unknown>('Load branches', request(`/projects/${encodeURIComponent(projectId)}/branches`)));
      return {
        current: typeof data.current === 'string' ? data.current : null,
        local: Array.isArray(data.local) ? data.local.filter((item): item is string => typeof item === 'string') : [],
        recent: Array.isArray(data.recent) ? data.recent.filter((item): item is string => typeof item === 'string') : [],
      };
    },
    toolSurface: (localId) => response<ToolSurfaceReport>('Load tool surface', request(`/agent-sessions/${encodeURIComponent(localId)}/tool-surface`)),
    dispatchMcp: async () => { throw new SessionGatewayError(0, 'The engine has no primitive to dispatch a single MCP tool outside a model-originated request'); },
    childMessages: async (parentLocalId, childSdkId) => {
      const body = await response<{ messages?: unknown[] }>(
        'Load child session',
        request(`/agent-sessions/${encodeURIComponent(parentLocalId)}/children/${encodeURIComponent(childSdkId)}/messages`),
      );
      return (body.messages ?? []).map((item) => mapMessage(item));
    },
    // Reconnect: the socket auto-reconnects with bounded exponential backoff (250ms-30s,
    // mirroring the Flutter client) whenever it closes for a reason other than an explicit
    // caller close(). Frames sent while disconnected queue (bounded to 50, oldest dropped)
    // and flush in order on the next OPEN. `onReconnect` fires on every OPEN after the
    // first so the caller can resubscribe by local session id and rehydrate the transcript.
    connect: (onEvent, onError, onReconnect) => {
      const MAX_QUEUE = 50;
      const queue: unknown[] = [];
      let socket: WebSocket | undefined;
      let closedByCaller = false;
      let firstOpen = true;
      let attempt = 0;

      const flush = () => { while (queue.length > 0 && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(queue.shift())); };

      const open = () => {
        if (closedByCaller) return;
        socket = new WebSocketImpl('ws://127.0.0.1:4098/ws/agents');
        socket.addEventListener('open', () => {
          attempt = 0;
          const reconnected = !firstOpen;
          firstOpen = false;
          flush();
          if (reconnected) onReconnect?.();
        });
        socket.addEventListener('message', (event) => { try { onEvent(JSON.parse(String(event.data)) as SessionWireEvent); } catch { onError(); } });
        socket.addEventListener('error', onError);
        socket.addEventListener('close', () => {
          if (closedByCaller) return;
          const delay = Math.min(250 * 2 ** attempt, 30_000);
          attempt += 1;
          setTimeout(open, delay);
        });
      };
      open();

      return {
        // Always enqueue-then-flush (rather than send-if-open) so a frame sent the instant
        // a reconnect lands never jumps ahead of frames still waiting from the outage.
        send: (frame) => {
          queue.push(frame);
          if (queue.length > MAX_QUEUE) queue.shift();
          flush();
        },
        close: () => { closedByCaller = true; queue.length = 0; socket?.close(); },
      };
    },
  };
}
