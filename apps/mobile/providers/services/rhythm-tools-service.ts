export type ToolRequestInit = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

export interface ToolTransport {
  request<T>(
    path: string,
    init: ToolRequestInit,
  ): Promise<T>;
}

const TOOLS_CACHE_PREFIX = 'rhythm.tools.read-cache.v1';

export interface ToolsCacheScopeInput {
  accountUserId: string | number | null;
  pairedHost: {
    hostId: string;
    deviceId: string;
  } | null;
  runtimeCacheScope: string | null;
}

export function deriveToolsCacheScope({
  accountUserId,
  pairedHost,
  runtimeCacheScope,
}: ToolsCacheScopeInput): string {
  if (accountUserId !== null) {
    return pairedHost
      ? `account:${accountUserId}:host:${pairedHost.hostId}:device:${pairedHost.deviceId}`
      : `account:${accountUserId}:unpaired`;
  }
  return runtimeCacheScope
    ? `runtime:${runtimeCacheScope}`
    : 'signed-out';
}

export function getToolCacheStorageKey(
  scope: string,
  tool: ToolScreenId,
): string {
  const safeScope =
    scope.trim().replace(/[^a-zA-Z0-9._-]/g, '_') || 'signed-out';
  return `${TOOLS_CACHE_PREFIX}.${safeScope}.${tool}`;
}

export type ToolScreenState =
  | 'loading'
  | 'empty'
  | 'offline-cache'
  | 'expired-auth'
  | 'forbidden'
  | 'error';

const TOOL_SCREEN_DEFINITIONS = [
  { id: 'brain', title: 'Brain', route: '/tools/brain', origin: 'paired' },
  { id: 'research', title: 'Research', route: '/tools/research', origin: 'paired' },
  { id: 'schedules', title: 'Scheduled Jobs', route: '/tools/schedules', origin: 'paired' },
  { id: 'webhooks', title: 'Webhooks', route: '/tools/webhooks', origin: 'paired' },
  { id: 'profiles', title: 'Profiles', route: '/tools/profiles', origin: 'paired' },
  { id: 'cookbook', title: 'Cookbook', route: '/tools/cookbook', origin: 'paired' },
  { id: 'review', title: 'Review Queue', route: '/tools/review', origin: 'paired' },
  { id: 'report-card', title: 'Report Card', route: '/tools/report-card', origin: 'paired' },
  { id: 'email', title: 'Email', route: '/tools/email', origin: 'cloud' },
  { id: 'gallery', title: 'Gallery', route: '/tools/gallery', origin: 'cloud' },
  { id: 'skills', title: 'Skills', route: '/tools/skills', origin: 'paired' },
  { id: 'playbooks', title: 'Playbooks', route: '/tools/playbooks', origin: 'paired' },
  { id: 'mcp', title: 'MCP', route: '/tools/mcp', origin: 'paired' },
  { id: 'models', title: 'Providers & Models', route: '/tools/models', origin: 'paired' },
] as const satisfies readonly {
  id: string;
  title: string;
  route: string;
  origin: 'cloud' | 'paired';
}[];

export type ToolScreenId = (typeof TOOL_SCREEN_DEFINITIONS)[number]['id'];

export const TOOL_RESILIENT_STATES = [
  'loading',
  'empty',
  'offline-cache',
  'expired-auth',
  'forbidden',
  'error',
] as const satisfies readonly ToolScreenState[];

export const TOOL_SCREEN_MANIFEST = TOOL_SCREEN_DEFINITIONS.map((screen) => ({
  ...screen,
  accessibilityLabel: `${screen.title}. Open ${screen.title}.`,
  states: [...TOOL_RESILIENT_STATES],
}));

export const TOOL_SCREEN_ACCESSIBILITY = TOOL_SCREEN_MANIFEST;

export interface ToolRecord {
  id: string;
  [field: string]: unknown;
}

export interface ToolListResponse<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface BrainRecord extends ToolRecord {
  title?: string;
  content?: string;
  tags?: string[];
  updatedAt?: string;
}

export interface ResearchRecord extends ToolRecord {
  query: string;
  status: string;
  report?: string | null;
  error?: string | null;
  sourcesJson?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScheduledJobRecord extends ToolRecord {
  name: string;
  cron?: string;
  enabled?: boolean;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
}

export interface WebhookRecord extends ToolRecord {
  name: string;
  url?: string;
  secret?: string;
  enabled?: boolean;
  eventTypes?: string[];
}

export interface ProfileRecord extends ToolRecord {
  label?: string;
  prompt?: string;
  model?: string | null;
  permissionScope?: string[] | null;
  isManager?: boolean;
  allowedDelegates?: string[];
  projection?: {
    status: string;
    updatedAt?: string;
  };
}

export interface RecipeRecord extends ToolRecord {
  title: string;
  description?: string;
  prompt?: string;
}

export interface ProposalRecord extends ToolRecord {
  title: string;
  status: string;
  risk: string;
  rationale?: string;
  kind?: string;
}

export type ToolCacheKind =
  | 'brain'
  | 'research'
  | 'schedules'
  | 'webhooks'
  | 'profiles'
  | 'cookbook'
  | 'review'
  | 'report-card'
  | 'email'
  | 'gallery'
  | 'skills'
  | 'playbooks'
  | 'mcp'
  | 'models';

const CACHE_FIELDS: Record<ToolCacheKind, ReadonlySet<string>> = {
  brain: new Set(['id', 'title', 'content', 'tags', 'updatedAt', 'createdAt']),
  research: new Set([
    'id',
    'query',
    'status',
    'report',
    'error',
    'sourcesJson',
    'createdAt',
    'updatedAt',
  ]),
  schedules: new Set([
    'id',
    'name',
    'description',
    'cron',
    'cronExpression',
    'timezone',
    'enabled',
    'lastRunAt',
    'lastRunStatus',
    'lastError',
    'agentConfigId',
    'updatedAt',
  ]),
  webhooks: new Set([
    'id',
    'name',
    'url',
    'enabled',
    'eventTypes',
    'eventTypesJson',
    'lastTriggeredAt',
    'triggerCount',
    'updatedAt',
  ]),
  profiles: new Set([
    'id',
    'label',
    'icon',
    'description',
    'prompt',
    'systemPrompt',
    'model',
    'modelProvider',
    'modelId',
    'permissionScope',
    'allowedMcpsJson',
    'allowedSkillsJson',
    'corePermissionsJson',
    'allowedMcps',
    'allowedSkills',
    'isManager',
    'allowedDelegates',
    'allowedDelegatesJson',
    'projection',
    'updatedAt',
  ]),
  cookbook: new Set([
    'id',
    'title',
    'description',
    'prompt',
    'boundConfigId',
    'createdAt',
    'updatedAt',
  ]),
  review: new Set([
    'id',
    'title',
    'status',
    'risk',
    'rationale',
    'kind',
    'targetRef',
    'auditRunId',
    'createdAt',
    'updatedAt',
  ]),
  'report-card': new Set([
    'agentKind',
    'agentLabel',
    'label',
    'runs',
    'totalRuns',
    'measurableRuns',
    'completionRate',
    'escalationRate',
    'correctionRate',
    'avgCorrectionsPerRun',
    'tokenWasteRate',
    'wastePercentOfSpend',
    'repeatedMistakes',
    'windowDays',
  ]),
  email: new Set([
    'id',
    'externalId',
    'from',
    'fromName',
    'fromEmail',
    'sender',
    'subject',
    'snippet',
    'receivedAt',
    'threadId',
    'isUnread',
  ]),
  gallery: new Set([
    'id',
    'title',
    'name',
    'status',
    'thumbnailUrl',
    'previewUrl',
    'createdAt',
    'updatedAt',
  ]),
  skills: new Set([
    'id',
    'name',
    'description',
    'managed',
    'source',
    'metadata',
    'updatedAt',
  ]),
  playbooks: new Set([
    'id',
    'name',
    'description',
    'managed',
    'source',
    'hints',
    'updatedAt',
  ]),
  mcp: new Set(['id', 'name', 'status', 'type', 'url', 'enabled', 'error']),
  models: new Set([
    'id',
    'name',
    'providerID',
    'providerId',
    'status',
    'capabilities',
    'limit',
    'configured',
    'enabled',
  ]),
};

const SENSITIVE_KEY = /(authorization|cookie|credential|password|secret|token|oauth|api[_-]?key)/i;

function safeCacheValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeCacheValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, child]) => [key, safeCacheValue(child)]),
  );
}

export function sanitizeToolCache(
  kind: ToolCacheKind,
  value: unknown,
): ToolRecord[] {
  const source = Array.isArray(value)
    ? value
    : value &&
        typeof value === 'object' &&
        Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : [];
  const allowed = CACHE_FIELDS[kind];
  return source.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const safe = Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .filter(([key]) => allowed.has(key) && !SENSITIVE_KEY.test(key))
        .map(([key, child]) => [key, safeCacheValue(child)]),
    );
    const id =
      typeof safe.id === 'string'
        ? safe.id
        : typeof safe.name === 'string'
          ? safe.name
          : typeof safe.agentKind === 'string'
            ? safe.agentKind
            : typeof safe.externalId === 'string'
              ? safe.externalId
              : null;
    return id ? [{ ...safe, id } as ToolRecord] : [];
  });
}

export function serializeProfileScope(
  permissionScope: string[] | undefined,
): { permissionScope: string[] | null } {
  return {
    permissionScope:
      permissionScope === undefined ? null : [...permissionScope],
  };
}

function body(value: unknown): string {
  return JSON.stringify(value);
}

function queryPath(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export class RhythmToolsService {
  private readonly cloud: ToolTransport;
  private readonly paired: ToolTransport;

  constructor(options: { cloud: ToolTransport; paired: ToolTransport }) {
    this.cloud = options.cloud;
    this.paired = options.paired;
  }

  private pairedRequest<T>(
    path: string,
    init: ToolRequestInit = { method: 'GET' },
  ): Promise<T> {
    return this.paired.request<T>(path, init);
  }

  private cloudRequest<T>(
    path: string,
    init: ToolRequestInit = { method: 'GET' },
  ): Promise<T> {
    return this.cloud.request<T>(path, init);
  }

  listBrain(query?: string): Promise<BrainRecord[]> {
    return this.pairedRequest(
      query
        ? queryPath('/mobile-gateway/tools/agent-memory/search', { q: query })
        : '/mobile-gateway/tools/agent-memory',
    );
  }

  getBrain(id: string): Promise<BrainRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-memory/${encodeURIComponent(id)}`);
  }

  createBrain(input: Partial<BrainRecord>): Promise<BrainRecord> {
    return this.pairedRequest('/mobile-gateway/tools/agent-memory', {
      method: 'POST',
      body: body(input),
    });
  }

  updateBrain(id: string, input: Partial<BrainRecord>): Promise<BrainRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-memory/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: body(input),
    });
  }

  deleteBrain(id: string): Promise<void> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-memory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  listResearch(): Promise<ResearchRecord[]> {
    return this.pairedRequest('/mobile-gateway/tools/agent-research');
  }

  getResearch(id: string): Promise<ResearchRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-research/${encodeURIComponent(id)}`);
  }

  createResearch(query: string): Promise<ResearchRecord> {
    return this.pairedRequest('/mobile-gateway/tools/agent-research', {
      method: 'POST',
      body: body({ query }),
    });
  }

  retryResearch(id: string): Promise<ResearchRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-research/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    });
  }

  deleteResearch(id: string): Promise<void> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-research/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  listSchedules(): Promise<ScheduledJobRecord[]> {
    return this.pairedRequest('/mobile-gateway/tools/agent-schedules');
  }

  getSchedule(id: string): Promise<ScheduledJobRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-schedules/${encodeURIComponent(id)}`);
  }

  createSchedule(input: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord> {
    return this.pairedRequest('/mobile-gateway/tools/agent-schedules', {
      method: 'POST',
      body: body(input),
    });
  }

  updateSchedule(
    id: string,
    input: Partial<ScheduledJobRecord>,
  ): Promise<ScheduledJobRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: body(input),
    });
  }

  deleteSchedule(id: string): Promise<void> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  triggerSchedule(id: string): Promise<unknown> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-schedules/${encodeURIComponent(id)}/trigger-now`, {
      method: 'POST',
    });
  }

  listWebhooks(): Promise<WebhookRecord[]> {
    return this.pairedRequest('/mobile-gateway/tools/agent-webhooks');
  }

  getWebhook(id: string): Promise<WebhookRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-webhooks/${encodeURIComponent(id)}`);
  }

  createWebhook(input: Partial<WebhookRecord>): Promise<WebhookRecord> {
    return this.pairedRequest('/mobile-gateway/tools/agent-webhooks', {
      method: 'POST',
      body: body(input),
    });
  }

  revokeWebhook(id: string): Promise<void> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-webhooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  rotateWebhookSecret(id: string): Promise<WebhookRecord> {
    return this.pairedRequest(
      `/mobile-gateway/tools/agent-webhooks/${encodeURIComponent(id)}/rotate-secret`,
      { method: 'POST' },
    );
  }

  listProfiles(): Promise<ProfileRecord[]> {
    return this.pairedRequest('/mobile-gateway/tools/agent-configs');
  }

  getProfile(id: string): Promise<ProfileRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-configs/${encodeURIComponent(id)}`);
  }

  createProfile(input: Partial<ProfileRecord>): Promise<ProfileRecord> {
    return this.pairedRequest('/mobile-gateway/tools/agent-configs', {
      method: 'POST',
      body: body(input),
    });
  }

  async updateProfile(
    id: string,
    input: Partial<ProfileRecord>,
  ): Promise<ProfileRecord> {
    const updated = await this.pairedRequest<ProfileRecord>(
      `/mobile-gateway/tools/agent-configs/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: body(input) },
    );
    await this.pairedRequest(
      `/mobile-gateway/tools/agent-configs/${encodeURIComponent(id)}/resync-agent-file`,
      { method: 'POST' },
    );
    return updated;
  }

  deleteProfile(id: string): Promise<void> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-configs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  listRecipes(): Promise<RecipeRecord[]> {
    return this.pairedRequest('/mobile-gateway/tools/agent-cookbook');
  }

  getRecipe(id: string): Promise<RecipeRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-cookbook/${encodeURIComponent(id)}`);
  }

  createRecipe(input: Partial<RecipeRecord>): Promise<RecipeRecord> {
    return this.pairedRequest('/mobile-gateway/tools/agent-cookbook', {
      method: 'POST',
      body: body(input),
    });
  }

  updateRecipe(id: string, input: Partial<RecipeRecord>): Promise<RecipeRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-cookbook/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: body(input),
    });
  }

  deleteRecipe(id: string): Promise<void> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-cookbook/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  runRecipe(id: string): Promise<unknown> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-cookbook/${encodeURIComponent(id)}/run`, {
      method: 'POST',
    });
  }

  listProposals(status?: string): Promise<ProposalRecord[]> {
    return this.pairedRequest(
      queryPath('/mobile-gateway/tools/agent-org-proposals', { status }),
    );
  }

  approveProposal(id: string): Promise<ProposalRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-org-proposals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  }

  rejectProposal(id: string, reason?: string): Promise<ProposalRecord> {
    return this.pairedRequest(`/mobile-gateway/tools/agent-org-proposals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: body({ reason }),
    });
  }

  getReportCard(windowDays = 30): Promise<unknown> {
    return this.pairedRequest(
      queryPath('/mobile-gateway/tools/agents/run-quality', { windowDays }),
    );
  }

  listEmailSignals(limit = 20): Promise<unknown> {
    return this.cloudRequest(
      queryPath('/integrations/gmail-signals', { limit }),
    );
  }

  listGalleryDesigns(): Promise<unknown> {
    return this.cloudRequest('/agent-designs');
  }

  listSkills(): Promise<unknown> {
    return this.pairedRequest('/mobile-gateway/tools/opencode/skills?withMetadata=true');
  }

  getSkill(name: string): Promise<unknown> {
    return this.pairedRequest(`/mobile-gateway/tools/opencode/skills/${encodeURIComponent(name)}/content`);
  }

  createSkill(input: unknown): Promise<unknown> {
    return this.pairedRequest('/mobile-gateway/tools/opencode/skills', {
      method: 'POST',
      body: body(input),
    });
  }

  updateSkill(name: string, input: unknown): Promise<unknown> {
    return this.pairedRequest(`/mobile-gateway/tools/opencode/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: body(input),
    });
  }

  deleteSkill(name: string): Promise<void> {
    return this.pairedRequest(`/mobile-gateway/tools/opencode/skills/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  listPlaybooks(): Promise<unknown> {
    return this.pairedRequest('/mobile-gateway/tools/opencode/commands');
  }

  getPlaybook(name: string): Promise<unknown> {
    return this.pairedRequest(`/mobile-gateway/tools/opencode/commands/${encodeURIComponent(name)}/content`);
  }

  createPlaybook(input: unknown): Promise<unknown> {
    return this.pairedRequest('/mobile-gateway/tools/opencode/commands', {
      method: 'POST',
      body: body(input),
    });
  }

  updatePlaybook(name: string, input: unknown): Promise<unknown> {
    return this.pairedRequest(`/mobile-gateway/tools/opencode/commands/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: body(input),
    });
  }

  deletePlaybook(name: string): Promise<void> {
    return this.pairedRequest(`/mobile-gateway/tools/opencode/commands/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  listMcp(projectId?: string): Promise<unknown> {
    return this.pairedRequest(
      queryPath('/mobile-gateway/opencode/mcp', { projectId }),
    );
  }

  addMcp(input: unknown): Promise<unknown> {
    return this.pairedRequest('/mobile-gateway/opencode/mcp', {
      method: 'POST',
      body: body(input),
    });
  }

  connectMcp(name: string): Promise<unknown> {
    return this.pairedRequest(`/mobile-gateway/opencode/mcp/${encodeURIComponent(name)}/connect`, {
      method: 'POST',
    });
  }

  disconnectMcp(name: string): Promise<unknown> {
    return this.pairedRequest(`/mobile-gateway/opencode/mcp/${encodeURIComponent(name)}/disconnect`, {
      method: 'POST',
    });
  }

  startMcpOAuth(name: string): Promise<unknown> {
    return this.pairedRequest(`/mobile-gateway/opencode/mcp/${encodeURIComponent(name)}/auth`, {
      method: 'POST',
    });
  }

  listProviders(): Promise<unknown> {
    return this.pairedRequest('/mobile-gateway/opencode/provider');
  }

  listProviderAuth(): Promise<unknown> {
    return this.pairedRequest('/mobile-gateway/opencode/provider/auth');
  }

  getConfig(): Promise<unknown> {
    return this.pairedRequest('/mobile-gateway/opencode/config');
  }
}

export const TOOL_SCREEN_MANIFEST_WITH_STATES =
  TOOL_SCREEN_ACCESSIBILITY;
