import {
  MissingProjectScopeError,
  withProjectScope,
} from '../../lib/transport/project-scoped-request.ts';
import {
  isOrganizedToolCatalog,
  sortToolCatalogRecords,
} from './tool-catalog-organizer.ts';

export type ToolRequestInit = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

export interface ToolTransport {
  request<T>(
    path: string,
    init: ToolRequestInit,
  ): Promise<T>;
  resourceConnection?(
    path: string,
    init: { headers?: Record<string, string> },
  ): Promise<{ url: string; headers: Record<string, string> }>;
}

export interface GalleryArtifactSource {
  kind: 'image' | 'video';
  uri: string;
  headers: Record<string, string>;
}

const TOOLS_CACHE_PREFIX = 'rhythm.tools.read-cache.v1';
const OPTIONAL_PROVIDER_AUTH_TIMEOUT_MS = 2_000;

export interface ToolsCacheScopeInput {
  accountUserId: string | number | null;
  activeProjectId?: string | null;
  pairedHost: {
    hostId: string;
    deviceId: string;
  } | null;
  runtimeCacheScope: string | null;
}

export function deriveToolsCacheScope({
  accountUserId,
  activeProjectId,
  pairedHost,
  runtimeCacheScope,
}: ToolsCacheScopeInput): string {
  const projectScope = activeProjectId?.trim()
    ? `:project:${activeProjectId.trim()}`
    : ':project:none';
  if (accountUserId !== null) {
    return pairedHost
      ? `account:${accountUserId}:host:${pairedHost.hostId}:device:${pairedHost.deviceId}${projectScope}`
      : `account:${accountUserId}:unpaired${projectScope}`;
  }
  return runtimeCacheScope
    ? `runtime:${runtimeCacheScope}${projectScope}`
    : `signed-out${projectScope}`;
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
  | 'missing-scope'
  | 'stale-project'
  | 'unauthorized-pairing'
  | 'version-mismatch'
  | 'network-failure'
  | 'expired-auth'
  | 'forbidden'
  | 'error';

export type ToolFailureState = Exclude<
  ToolScreenState,
  'loading' | 'empty' | 'offline-cache'
>;

export type ToolServiceAvailability =
  | 'connected'
  | 'offline'
  | 'expired-auth'
  | 'forbidden'
  | 'missing-scope'
  | 'unauthorized-pairing'
  | 'version-mismatch'
  | 'network-failure';

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
  { id: 'gallery', title: 'Gallery', route: '/tools/gallery', origin: 'paired' },
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
  'missing-scope',
  'stale-project',
  'unauthorized-pairing',
  'version-mismatch',
  'network-failure',
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
  /** Server-owned retry eligibility. Optional for older backends; only a strict `true` ever enables Retry. */
  canRetry?: boolean;
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
    'canRetry',
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
    'provider',
    'artifactType',
    'artifactUrl',
    'projectUrl',
    'canvaUrl',
    'sessionId',
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
    'connected',
    'authMethodCount',
    'models',
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

export function redactProviderAuthMetadata<T>(value: T): T {
  return safeCacheValue(value) as T;
}

function failureStatus(reason: unknown): number {
  return reason && typeof reason === 'object'
    ? Number((reason as { status?: unknown }).status) || 0
    : 0;
}

function failureCode(reason: unknown): string {
  return reason && typeof reason === 'object'
    ? String((reason as { code?: unknown }).code ?? '').toUpperCase()
    : '';
}

export function classifyToolFailure(
  reason: unknown,
  availability: ToolServiceAvailability,
  origin: 'cloud' | 'paired' = 'paired',
): ToolFailureState | null {
  if (availability === 'missing-scope') return 'missing-scope';
  if (availability === 'unauthorized-pairing') return 'unauthorized-pairing';
  if (availability === 'version-mismatch') return 'version-mismatch';
  if (availability === 'network-failure' || availability === 'offline') {
    return 'network-failure';
  }
  if (availability === 'expired-auth') return 'expired-auth';
  if (availability === 'forbidden') return 'forbidden';
  if (!reason) return null;

  const status = failureStatus(reason);
  const code = failureCode(reason);
  if (status === 404) return 'stale-project';
  if (status === 401) {
    if (code === 'EXPIRED_AUTH') return 'expired-auth';
    return origin === 'cloud' ? 'expired-auth' : 'unauthorized-pairing';
  }
  if (status === 403) return 'forbidden';
  if (
    status === 0 ||
    (
      reason &&
      typeof reason === 'object' &&
      (reason as { retryable?: unknown }).retryable === true
    )
  ) {
    return 'network-failure';
  }
  if (
    status === 400 &&
    reason &&
    typeof reason === 'object' &&
    (
      (reason as { kind?: unknown }).kind === 'missing-scope' ||
      /project|scope|X-Rhythm-Project-ID/i.test(
        String((reason as { message?: unknown }).message ?? ''),
      )
    )
  ) {
    return 'missing-scope';
  }
  return 'error';
}

function responseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  for (const key of ['items', 'data', 'results', 'all']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [record];
}

function normalizeRecord(value: unknown): ToolRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = [
    record.id,
    record.name,
    record.agentKind,
    record.externalId,
    record.providerID,
    record.providerId,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof id === 'string' ? { ...record, id } as ToolRecord : null;
}

function normalizedRecords(value: unknown): ToolRecord[] {
  return responseArray(value).flatMap((entry) => {
    const normalized = normalizeRecord(entry);
    return normalized ? [normalized] : [];
  });
}

export function normalizeToolScreenResponse(
  tool: ToolScreenId,
  value: unknown,
): ToolRecord[] {
  const finish = (records: ToolRecord[]): ToolRecord[] =>
    isOrganizedToolCatalog(tool)
      ? sortToolCatalogRecords(tool, records)
      : records;

  if (tool === 'report-card') {
    const agents =
      value &&
      typeof value === 'object' &&
      Array.isArray((value as { agents?: unknown }).agents)
        ? (value as { agents: unknown[] }).agents
        : value;
    return finish(normalizedRecords(agents));
  }

  if (tool === 'mcp' && value && typeof value === 'object' && !Array.isArray(value)) {
    return finish(Object.entries(value as Record<string, unknown>).flatMap(
      ([name, entry]) => {
        const normalized = normalizeRecord({
          id: name,
          name,
          ...(entry && typeof entry === 'object'
            ? entry as Record<string, unknown>
            : { status: String(entry) }),
        });
        return normalized ? [normalized] : [];
      },
    ));
  }

  if (tool === 'models') {
    const compound =
      value && typeof value === 'object'
        ? value as {
            providers?: unknown;
            auth?: unknown;
            config?: unknown;
          }
        : {};
    const providerPayload = compound.providers;
    const providerRecord =
      providerPayload && typeof providerPayload === 'object'
        ? providerPayload as Record<string, unknown>
        : {};
    const connected = new Set(
      Array.isArray(providerRecord.connected)
        ? providerRecord.connected.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
    );
    const config =
      compound.config && typeof compound.config === 'object'
        ? compound.config as Record<string, unknown>
        : {};
    const enabled = new Set(
      Array.isArray(config.enabled_providers)
        ? config.enabled_providers.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
    );
    const explicitlyConfigured = new Set(
      config.provider && typeof config.provider === 'object'
        ? Object.keys(config.provider as Record<string, unknown>)
        : [],
    );
    const configuredModel =
      typeof config.model === 'string' ? config.model.split('/')[0] : '';
    if (configuredModel) explicitlyConfigured.add(configuredModel);
    const disabled = new Set(
      Array.isArray(config.disabled_providers)
        ? config.disabled_providers.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
    );
    const visibleProviderIds = new Set([
      ...connected,
      ...enabled,
      ...explicitlyConfigured,
    ]);
    for (const providerId of disabled) visibleProviderIds.delete(providerId);
    const auth = redactProviderAuthMetadata(compound.auth);
    return finish(
      normalizedRecords(providerPayload)
        .filter((provider) => {
          const providerId = String(
            provider.id ?? provider.providerID ?? provider.providerId,
          );
          return visibleProviderIds.has(providerId);
        })
        .map((provider) => {
          const providerId = String(
            provider.id ?? provider.providerID ?? provider.providerId,
          );
          const providerAuth =
            auth && typeof auth === 'object'
              ? (auth as Record<string, unknown>)[providerId]
              : undefined;
          const providerModels =
            provider.models && typeof provider.models === 'object'
              ? Object.entries(provider.models as Record<string, unknown>)
                  .map(([modelId, model]) => ({
                    id: modelId,
                    name:
                      model && typeof model === 'object' &&
                      typeof (model as { name?: unknown }).name === 'string'
                        ? (model as { name: string }).name
                        : modelId,
                  }))
                  .sort((left, right) =>
                    left.name.localeCompare(right.name, 'en', {
                      numeric: true,
                      sensitivity: 'base',
                    }) || left.id.localeCompare(right.id, 'en'),
                  )
              : [];
          return {
            ...provider,
            id: providerId,
            providerID: providerId,
            models: providerModels,
            authMethodCount: Array.isArray(providerAuth)
              ? providerAuth.length
              : 0,
            configured: true,
            connected: connected.has(providerId),
            enabled:
              enabled.has(providerId) || explicitlyConfigured.has(providerId),
          };
        }),
    );
  }

  return finish(normalizedRecords(value));
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
    // Research retry eligibility is server-owned and strictly boolean; anything else is dropped (never enables Retry).
    if (kind === 'research' && 'canRetry' in safe && typeof safe.canRetry !== 'boolean') {
      delete safe.canRetry;
    }
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

export type RouterBackend = 'local' | 'jev' | 'custom' | 'systemone';
export type RouterFeatureMode = 'default' | 'off' | 'shadow' | 'on';
export const ROUTER_FEATURE_KEYS = [
  'model_routing',
  'tool_ranking',
  'memory_ranking',
  'capacity_routing',
] as const;
export type RouterFeatureKey = (typeof ROUTER_FEATURE_KEYS)[number];

export type RouterRoutingScope = 'first_prompt' | 'escalate_only' | 'every_prompt';

export interface RouterRouting {
  scope: RouterRoutingScope;
  escalateMinConfidence: number;
}

export type RouterTier = 'cheap' | 'standard' | 'frontier';
export type RouterTierSource = 'cost' | 'heuristic' | 'override';

export interface RouterCatalogModel {
  providerID: string;
  modelID: string;
  name: string;
  family?: string | null;
  tier: RouterTier;
  tierSource: RouterTierSource;
  costOutputUsd?: number | null;
  costInputUsd?: number | null;
  releaseDate?: string | null;
  contextLimit?: number | null;
  excluded: boolean;
  /** false = available but not enabled in Models curation, so not routable. Absent (older Macs) = enabled. */
  enabled?: boolean;
}

export type RouterTierMode = 'auto' | 'manual';

export interface RouterTierThresholds {
  mode?: RouterTierMode;
  cheapMaxOutputUsd: number;
  frontierMinOutputUsd: number;
  derivedFromModels?: number;
}

/** PUT shape: numbers are sent only in manual mode. */
export type RouterTierInput =
  | { mode: 'auto' }
  | { mode: 'manual'; cheapMaxOutputUsd: number; frontierMinOutputUsd: number };

/** Live model catalog the router chooses among; absent/empty when the engine is not running. */
export interface RouterCatalog {
  fetchedAt?: string | null;
  models: RouterCatalogModel[];
  tiers: RouterTierThresholds;
  curatedCount?: number;
  reason?: 'no_curated_models';
}

export interface RouterConfig {
  backend: RouterBackend;
  local: { baseUrl: string; model: string; scoreScale?: number };
  jev: { baseUrl: string; model: string; hasApiKey: boolean };
  custom: { baseUrl: string; model: string; scoreScale?: number; hasApiKey: boolean };
  /** Absent when the paired Mac predates the System One backend. */
  systemone?: { baseUrl: string; model: string; hasApiKey: boolean };
  timeoutMs: number;
  remoteDataConsent: boolean;
  features: Record<RouterFeatureKey, RouterFeatureMode>;
  /** Absent when the paired Mac predates routing scope. */
  routing?: RouterRouting;
  catalog?: RouterCatalog | null;
  lockedByEnv: string[];
  effective?: {
    backend: RouterBackend;
    baseUrl: string;
    model: string;
    features: Record<string, RouterFeatureMode>;
  };
}

/** Partial PUT/test body. `apiKey` is write-only; '' clears the saved key. */
export interface RouterConfigDraft {
  backend?: RouterBackend;
  local?: Partial<RouterConfig['local']>;
  jev?: { baseUrl?: string; model?: string; apiKey?: string };
  custom?: {
    baseUrl?: string;
    model?: string;
    scoreScale?: number;
    apiKey?: string;
  };
  systemone?: { baseUrl?: string; model?: string; apiKey?: string };
  timeoutMs?: number;
  remoteDataConsent?: boolean;
  features?: Partial<Record<RouterFeatureKey, RouterFeatureMode>>;
  routing?: Partial<RouterRouting>;
  tiers?: RouterTierInput;
  /** Keyed "provider/model"; replaces the saved overrides. */
  tierOverrides?: Record<string, RouterTier>;
  excludedModels?: string[];
}

export interface RouterTestResult {
  ok: boolean;
  backend?: RouterBackend;
  model?: string;
  latencyMs?: number;
  ranked?: { text: string; score: number }[];
  message?: string;
  /** System One only: the tier picked for the sample prompt. */
  tier?: string;
  probabilities?: Record<string, number>;
}

const ROUTER_CONFIG_PATH = '/mobile-gateway/tools/agent-decisions/config';

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

// ---- Research projects/runs (canonical contract; eleven exact paired operations) -----------------------------------------
// Structure copied from apps/web/src/gateway/research.ts and the API repository. Project/run responses are NOT run
// through the legacy job cache projection: opaque canonical fields are kept intact and only identity-critical shapes
// are validated.

export type ResearchModelRef = { providerId: string; modelId: string };
export type ResearchBudget = {
  maxPasses: number;
  maxTokens: number;
  maxCostUsd: number;
  maxWallClockMs: number;
};

export interface ResearchProject {
  id: string;
  ownerUserId: number;
  name: string;
  question: string;
  goals: unknown[];
  domain: string | null;
  profileId: string | null;
  passConfig: unknown[];
  modelPolicy: Record<string, unknown>;
  criticConfig: Record<string, unknown>;
  synthesisConfig: Record<string, unknown>;
  scheduleRef: string | null;
  budget: Record<string, unknown>;
  magazineArtifactId?: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchProjectInput {
  name: string;
  question: string;
  goals: unknown[];
  domain?: string | null;
  profileId?: string | null;
  passConfig?: unknown[];
  modelPolicy?: Record<string, unknown>;
  criticConfig?: Record<string, unknown>;
  synthesisConfig?: Record<string, unknown>;
  scheduleRef?: string | null;
  budget?: Record<string, unknown>;
}

export interface ResearchProjectRun {
  id: string;
  projectId: string;
  ownerUserId: number;
  triggerType: 'manual' | 'scheduled' | 'follow-up';
  configSnapshot: Record<string, unknown>;
  status: string;
  progress: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  canonicalArtifact: Record<string, unknown> | null;
  artifacts: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  usage: { tokens: number; costUsd: number };
}

/** Paired-only representation of the canonical Markdown export. */
export type ResearchMarkdownExport = { markdown: string };

export const DEFAULT_RESEARCH_BUDGET: ResearchBudget = {
  maxPasses: 3,
  maxTokens: 5_000_000,
  maxCostUsd: 5,
  maxWallClockMs: 30 * 60_000,
};
export const RESEARCH_BUDGET_KEYS = [
  'maxPasses',
  'maxTokens',
  'maxCostUsd',
  'maxWallClockMs',
] as const;
/** Server-owned bounds (agentResearchController BUDGET_BOUNDS); the server remains authoritative. */
export function validateResearchBudgetField(
  key: keyof ResearchBudget,
  value: unknown,
): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.';
  switch (key) {
    case 'maxPasses':
      return Number.isInteger(value) && value >= 0 && value <= 10
        ? null
        : 'Passes must be a whole number from 0 to 10.';
    case 'maxTokens':
      return Number.isInteger(value) && value >= 50_000 && value <= 100_000_000
        ? null
        : 'Tokens must be a whole number from 50,000 to 100,000,000.';
    case 'maxCostUsd':
      return value >= 0 && value <= 1_000 ? null : 'Cost must be from $0 to $1,000.';
    case 'maxWallClockMs':
      return Number.isInteger(value) && value >= 60_000 && value <= 21_600_000
        ? null
        : 'Time must be from 1 to 360 minutes.';
  }
}

/** Safe, user-facing failure when a canonical response does not have the expected shape. */
export class ResearchContractError extends Error {
  readonly code = 'RESEARCH_CONTRACT';
  constructor() {
    super('The paired Mac returned an unexpected Research response.');
    this.name = 'ResearchContractError';
  }
}

/** The paired Mac does not expose the Research project/run workflow (older exact-five gateway). */
export class ResearchWorkflowUnavailableError extends Error {
  readonly code = 'RESEARCH_WORKFLOW_UNAVAILABLE';
  constructor() {
    super('Research projects are not available on this paired Mac yet.');
    this.name = 'ResearchWorkflowUnavailableError';
  }
}

export type ResearchOperation =
  | 'listResearchProjects'
  | 'createResearchProject'
  | 'getResearchProject'
  | 'updateResearchProject'
  | 'listResearchProjectRuns'
  | 'startResearchProjectRun'
  | 'getResearchProjectRun'
  | 'cancelResearchProjectRun'
  | 'resumeResearchProjectRun'
  | 'finishResearchProjectRun'
  | 'exportResearchProjectRunMarkdown';

/**
 * Recognizes ONLY the exact older-gateway rejections: status 404 + code NOT_FOUND with the exact message
 * `MobileToolOperation not found` (any operation), or `ResearchJob not found` for the project LIST operation alone
 * (GET /projects falls through to the legacy /:id handler on an exact-five gateway). Genuine ResearchProject/Run 404s,
 * Mac-scope 404s, 401/403 and network failures are never classified here, and success never proves capability.
 */
export function isResearchOperationUnavailable(
  reason: unknown,
  operation: ResearchOperation,
): boolean {
  if (!reason || typeof reason !== 'object') return false;
  const { status, code, message } = reason as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (status !== 404 || String(code ?? '').toUpperCase() !== 'NOT_FOUND') return false;
  if (message === 'MobileToolOperation not found') return true;
  return operation === 'listResearchProjects' && message === 'ResearchJob not found';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const nullableString = (value: unknown) => value === null || typeof value === 'string';

export function parseResearchProject(value: unknown): ResearchProject {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    typeof value.ownerUserId !== 'number' || !Number.isFinite(value.ownerUserId) ||
    typeof value.name !== 'string' ||
    typeof value.question !== 'string' ||
    !Array.isArray(value.goals) ||
    !Array.isArray(value.passConfig) ||
    !isRecord(value.modelPolicy) ||
    !isRecord(value.criticConfig) ||
    !isRecord(value.synthesisConfig) ||
    !isRecord(value.budget) ||
    !nullableString(value.domain) ||
    !nullableString(value.profileId) ||
    !nullableString(value.scheduleRef) ||
    !nullableString(value.archivedAt) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new ResearchContractError();
  }
  return value as unknown as ResearchProject;
}

export function parseResearchProjectRun(value: unknown): ResearchProjectRun {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.projectId) ||
    typeof value.ownerUserId !== 'number' || !Number.isFinite(value.ownerUserId) ||
    !['manual', 'scheduled', 'follow-up'].includes(String(value.triggerType)) ||
    typeof value.status !== 'string' ||
    !isRecord(value.configSnapshot) ||
    !isRecord(value.progress) ||
    !isRecord(value.diagnostics) ||
    !nullableString(value.startedAt) ||
    !nullableString(value.completedAt) ||
    typeof value.createdAt !== 'string' ||
    !(value.canonicalArtifact === null || isRecord(value.canonicalArtifact)) ||
    !Array.isArray(value.artifacts) ||
    !Array.isArray(value.sources) ||
    !isRecord(value.usage) ||
    typeof value.usage.tokens !== 'number' || !Number.isFinite(value.usage.tokens) ||
    typeof value.usage.costUsd !== 'number' || !Number.isFinite(value.usage.costUsd)
  ) {
    throw new ResearchContractError();
  }
  return value as unknown as ResearchProjectRun;
}

function parseResearchList<T>(value: unknown, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new ResearchContractError();
  return value.map(parse);
}

export function parseResearchMarkdownExport(value: unknown): string {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.markdown !== 'string'
  ) {
    throw new ResearchContractError();
  }
  return value.markdown;
}

function requireResearchId(value: unknown): string {
  if (!nonEmptyString(value)) throw new Error('A Research project and run identity is required.');
  return encodeURIComponent(value);
}

// Run-state predicates (match LiveResearchTool, not the older fixture).
export const RESEARCH_ACTIVE_STATES = ['pending', 'running', 'resumable', 'working'];
export const researchRunActive = (run: Pick<ResearchProjectRun, 'status'> | null | undefined) =>
  Boolean(run) && RESEARCH_ACTIVE_STATES.includes(run!.status);
export function researchStages(run: ResearchProjectRun): Record<string, unknown>[] {
  return (Array.isArray(run.progress.stages) ? run.progress.stages : []).filter(
    (stage): stage is Record<string, unknown> => isRecord(stage),
  );
}
const researchStageDone = (run: ResearchProjectRun, match: (role: string) => boolean) =>
  researchStages(run).some(
    (stage) => stage.status === 'done' && typeof stage.role === 'string' && match(stage.role),
  );
export const researchHasEvidence = (run: ResearchProjectRun) =>
  researchStageDone(run, (role) => !['plan', 'critic', 'synthesis'].includes(role));
export const researchHasSynthesis = (run: ResearchProjectRun) =>
  researchStageDone(run, (role) => role === 'synthesis');
export const researchBudgetExhausted = (run: ResearchProjectRun) =>
  run.diagnostics.budgetExhausted === true;
export const canCancelResearchRun = (run: ResearchProjectRun) => researchRunActive(run);
export const canResumeResearchRun = (run: ResearchProjectRun) => run.status === 'error';
export const canFinishResearchRun = (run: ResearchProjectRun) =>
  !researchRunActive(run) &&
  researchHasEvidence(run) &&
  (!researchHasSynthesis(run) || researchBudgetExhausted(run));
/** Stricter than the desktop button: the FIRST done synthesis stage must carry a nonblank string report. */
export function researchReportReady(run: ResearchProjectRun): boolean {
  const synthesis = researchStages(run).find(
    (stage) => stage.status === 'done' && stage.role === 'synthesis',
  );
  return Boolean(synthesis) && typeof synthesis!.report === 'string' && synthesis!.report.trim().length > 0;
}

export function researchPolicyRef(
  policy: Record<string, unknown>,
  side: 'lead' | 'researcher',
): ResearchModelRef | null {
  const value = policy[side];
  return isRecord(value) && typeof value.providerId === 'string' && typeof value.modelId === 'string'
    ? { providerId: value.providerId, modelId: value.modelId }
    : null;
}
export const researchHasModelPolicy = (policy: Record<string, unknown>) =>
  'lead' in policy || 'researcher' in policy;

export class RhythmToolsService {
  private readonly cloud: ToolTransport;
  private readonly paired: ToolTransport;
  private readonly projectId: string;
  private readonly abortController = new AbortController();

  constructor(options: {
    cloud: ToolTransport;
    paired: ToolTransport;
    projectId?: string | null;
  }) {
    this.cloud = options.cloud;
    this.paired = options.paired;
    this.projectId = options.projectId?.trim() ?? '';
  }

  forProject(projectId: string | null | undefined): RhythmToolsService {
    return new RhythmToolsService({
      cloud: this.cloud,
      paired: this.paired,
      projectId,
    });
  }

  cancel(): void {
    this.abortController.abort();
  }

  private pairedRequest<T>(
    path: string,
    init: ToolRequestInit = { method: 'GET' },
  ): Promise<T> {
    if (!this.projectId) {
      return Promise.reject(new MissingProjectScopeError());
    }
    return this.paired.request<T>(
      path,
      withProjectScope(
        this.projectId,
        init,
        this.abortController.signal,
      ),
    );
  }

  private cloudRequest<T>(
    path: string,
    init: ToolRequestInit = { method: 'GET' },
  ): Promise<T> {
    return this.cloud.request<T>(path, init);
  }

  async loadScreen(tool: ToolScreenId): Promise<ToolRecord[]> {
    let response: unknown;
    switch (tool) {
      case 'brain':
        response = await this.listBrain();
        break;
      case 'research':
        response = await this.listResearch();
        break;
      case 'schedules':
        response = await this.listSchedules();
        break;
      case 'webhooks':
        response = await this.listWebhooks();
        break;
      case 'profiles':
        response = await this.listProfiles();
        break;
      case 'cookbook':
        response = await this.listRecipes();
        break;
      case 'review':
        response = await this.listProposals('proposed');
        break;
      case 'report-card':
        response = await this.getReportCard();
        break;
      case 'email':
        response = await this.listEmailSignals();
        break;
      case 'gallery':
        response = await this.listGalleryDesigns();
        break;
      case 'skills':
        response = await this.listSkills();
        break;
      case 'playbooks':
        response = await this.listPlaybooks();
        break;
      case 'mcp':
        response = await this.listMcp();
        break;
      case 'models': {
        const [providers, auth, config] = await Promise.all([
          this.listProviders(),
          Promise.race([
            this.listProviderAuth().catch(() => undefined),
            new Promise<undefined>((resolve) => {
              setTimeout(resolve, OPTIONAL_PROVIDER_AUTH_TIMEOUT_MS);
            }),
          ]),
          this.getConfig(),
        ]);
        response = { providers, auth, config };
        break;
      }
    }
    return normalizeToolScreenResponse(tool, response);
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

  // ---- Research projects and runs: exactly eleven operations under /mobile-gateway/tools/agent-research ----
  // Every request goes through pairedRequest (Mac project header + abort signal). Each ID is a separately encoded path
  // segment; an empty identity is rejected rather than substituted. Only an exact older-gateway rejection becomes
  // ResearchWorkflowUnavailableError; every other failure keeps its real status/code.

  private async researchRequest<T>(
    operation: ResearchOperation,
    path: string,
    init?: ToolRequestInit,
  ): Promise<T> {
    try {
      return await this.pairedRequest<T>(path, init);
    } catch (reason) {
      if (isResearchOperationUnavailable(reason, operation)) {
        throw new ResearchWorkflowUnavailableError();
      }
      throw reason;
    }
  }

  async listResearchProjects(): Promise<ResearchProject[]> {
    return parseResearchList(
      await this.researchRequest<unknown>(
        'listResearchProjects',
        '/mobile-gateway/tools/agent-research/projects',
      ),
      parseResearchProject,
    );
  }

  async createResearchProject(input: ResearchProjectInput): Promise<ResearchProject> {
    return parseResearchProject(
      await this.researchRequest<unknown>(
        'createResearchProject',
        '/mobile-gateway/tools/agent-research/projects',
        { method: 'POST', body: body(input) },
      ),
    );
  }

  async getResearchProject(projectId: string): Promise<ResearchProject> {
    const id = requireResearchId(projectId);
    return parseResearchProject(
      await this.researchRequest<unknown>(
        'getResearchProject',
        `/mobile-gateway/tools/agent-research/projects/${id}`,
      ),
    );
  }

  async updateResearchProject(
    projectId: string,
    patch: Partial<ResearchProjectInput>,
  ): Promise<ResearchProject> {
    const id = requireResearchId(projectId);
    return parseResearchProject(
      await this.researchRequest<unknown>(
        'updateResearchProject',
        `/mobile-gateway/tools/agent-research/projects/${id}`,
        { method: 'PATCH', body: body(patch) },
      ),
    );
  }

  async listResearchProjectRuns(projectId: string): Promise<ResearchProjectRun[]> {
    const id = requireResearchId(projectId);
    return parseResearchList(
      await this.researchRequest<unknown>(
        'listResearchProjectRuns',
        `/mobile-gateway/tools/agent-research/projects/${id}/runs`,
      ),
      parseResearchProjectRun,
    );
  }

  async startResearchProjectRun(projectId: string): Promise<ResearchProjectRun> {
    const id = requireResearchId(projectId);
    return parseResearchProjectRun(
      await this.researchRequest<unknown>(
        'startResearchProjectRun',
        `/mobile-gateway/tools/agent-research/projects/${id}/runs`,
        { method: 'POST', body: body({ triggerType: 'manual' }) },
      ),
    );
  }

  async getResearchProjectRun(projectId: string, runId: string): Promise<ResearchProjectRun> {
    const project = requireResearchId(projectId);
    const run = requireResearchId(runId);
    return parseResearchProjectRun(
      await this.researchRequest<unknown>(
        'getResearchProjectRun',
        `/mobile-gateway/tools/agent-research/projects/${project}/runs/${run}`,
      ),
    );
  }

  private async researchRunAction(
    operation: ResearchOperation,
    action: 'cancel' | 'resume' | 'finish',
    projectId: string,
    runId: string,
  ): Promise<ResearchProjectRun> {
    const project = requireResearchId(projectId);
    const run = requireResearchId(runId);
    return parseResearchProjectRun(
      await this.researchRequest<unknown>(
        operation,
        `/mobile-gateway/tools/agent-research/projects/${project}/runs/${run}/${action}`,
        { method: 'POST' },
      ),
    );
  }

  cancelResearchProjectRun(projectId: string, runId: string): Promise<ResearchProjectRun> {
    return this.researchRunAction('cancelResearchProjectRun', 'cancel', projectId, runId);
  }

  resumeResearchProjectRun(projectId: string, runId: string): Promise<ResearchProjectRun> {
    return this.researchRunAction('resumeResearchProjectRun', 'resume', projectId, runId);
  }

  finishResearchProjectRun(projectId: string, runId: string): Promise<ResearchProjectRun> {
    return this.researchRunAction('finishResearchProjectRun', 'finish', projectId, runId);
  }

  /** Paired representation of the canonical export: a strict `{markdown}` JSON envelope on the same approved GET path. */
  async exportResearchProjectRunMarkdown(projectId: string, runId: string): Promise<string> {
    const project = requireResearchId(projectId);
    const run = requireResearchId(runId);
    return parseResearchMarkdownExport(
      await this.researchRequest<unknown>(
        'exportResearchProjectRunMarkdown',
        `/mobile-gateway/tools/agent-research/projects/${project}/runs/${run}/export?format=markdown`,
      ),
    );
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
    return this.pairedRequest('/mobile-gateway/tools/agent-designs');
  }

  getGalleryDesign(id: string): Promise<unknown> {
    return this.pairedRequest(
      `/mobile-gateway/tools/agent-designs/${encodeURIComponent(id)}`,
    );
  }

  async getGalleryArtifactSource(
    item: ToolRecord,
  ): Promise<GalleryArtifactSource | null> {
    const artifactType = String(item.artifactType ?? '')
      .trim()
      .toLowerCase()
      .replace(/^\./, '');
    const kind = new Set(['mp4', 'mov', 'm4v', 'webm']).has(artifactType)
      ? 'video'
      : new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']).has(artifactType)
        ? 'image'
        : null;
    if (!kind) return null;

    const artifactUrl =
      typeof item.artifactUrl === 'string' ? item.artifactUrl.trim() : '';
    if (artifactUrl) {
      try {
        const external = new URL(artifactUrl);
        if (
          external.protocol === 'https:' &&
          !external.hostname.toLowerCase().endsWith('.ts.net')
        ) {
          return { kind, uri: external.toString(), headers: {} };
        }
      } catch {
        // Relative media-store locators are resolved through the relay below.
      }
    }

    if (!this.projectId || !this.paired.resourceConnection) {
      throw new Error('Artifact unavailable');
    }
    const mediaArtifact = artifactUrl.match(/^\/artifacts\/([A-Za-z0-9_-]+)$/);
    const path = mediaArtifact
      ? `/mobile-gateway/artifacts/${encodeURIComponent(mediaArtifact[1]!)}`
      : `/mobile-gateway/tools/agent-designs/${encodeURIComponent(item.id)}/artifact`;
    const scoped = withProjectScope<ToolRequestInit>(
      this.projectId,
      { method: 'GET' },
      this.abortController.signal,
    );
    const connection = await this.paired.resourceConnection(path, {
      headers: scoped.headers,
    });
    return { kind, uri: connection.url, headers: connection.headers };
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

  /**
   * Router settings are Mac-global (mac-global-admin), so they do not require
   * an active project. The project header is sent only when one is selected.
   */
  private routerRequest<T>(path: string, init: ToolRequestInit): Promise<T> {
    const scoped = this.projectId
      ? withProjectScope(this.projectId, init, this.abortController.signal)
      : { ...init, signal: this.abortController.signal };
    return this.paired.request<T>(path, scoped);
  }

  getRouterConfig(): Promise<RouterConfig> {
    return this.routerRequest(ROUTER_CONFIG_PATH, { method: 'GET' });
  }

  saveRouterConfig(partial: RouterConfigDraft): Promise<RouterConfig> {
    return this.routerRequest(ROUTER_CONFIG_PATH, {
      method: 'PUT',
      body: body(partial),
    });
  }

  testRouterConfig(draft: RouterConfigDraft = {}): Promise<RouterTestResult> {
    return this.routerRequest(`${ROUTER_CONFIG_PATH}/test`, {
      method: 'POST',
      body: body(draft),
    });
  }

  getConfig(): Promise<unknown> {
    return this.pairedRequest('/mobile-gateway/opencode/config');
  }
}

export const TOOL_SCREEN_MANIFEST_WITH_STATES =
  TOOL_SCREEN_ACCESSIBILITY;
