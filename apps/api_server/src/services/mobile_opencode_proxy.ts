import { Buffer } from 'node:buffer';
import { relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AppError } from '../errors/app_error';
import {
  type MobileOpenCodeOwnershipStore,
} from '../repositories/mobile_opencode_ownership_repository';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  asOpenCodeAgentId,
  asRhythmProfileId,
} from '../models/agent_session';
import { logger } from '../utils/logger';
import {
  expandProfileSkillAllowlist,
  resolveProfileScope,
} from './agent_profile_scope';
import { capMcpAllowlistForProvider } from './gemini_tool_cap';
import { expandMcpAllowlist } from './mcp_allowlist_expander';
import { OPENCODE_ENGINE_PORT } from './opencode_client_service';
import {
  getMobileOpenCodeOwnershipRepository,
} from './mobile_opencode_ownership_runtime';
import {
  resolveMobileProjectPath,
  type MobileProjectScope,
} from './mobile_project_scope';
import { MOBILE_OPENCODE_OPERATION_MANIFEST } from './mobile_opencode_operations.generated';
import {
  authorizeMobileOpenCodeOperation,
  resolveMobileWorktreeReference,
  shapeMobileOpenCodeResponse,
  shapeMobileOpenCodeTextResponse,
  type MobileOpenCodeJsonFetcher,
} from './mobile_opencode_security';
import {
  resolveProfileIdForOpenCodeAgent,
  safeMobileSessionProfileState,
} from './mobile_profile_catalog';
import {
  applySelectiveDeferral,
  toolCountsForRoleConfig,
} from './tool_surface_estimator';
import { listOwnerUnscopedMobileChats } from './mobile_chat_catalog';
import { canUpdateMobileSessionState } from './mobile_session_state_scope';

export { MOBILE_OPENCODE_OPERATION_MANIFEST };
export type { MobileOpenCodeOperation } from './mobile_opencode_proxy_types';

const ROOT_FIELDS = new Set([
  'root',
  'cwd',
  'directory',
  'workingdirectory',
  'worktreedir',
  'workspace',
  'workspaceid',
  'roots',
]);

const SCOPED_PATH_QUERY_OPERATIONS = new Set([
  'experimental.session.list',
  'file.list',
  'file.read',
  'session.list',
]);

const PROMPT_FILE_PART_OPERATIONS = new Set([
  'session.prompt',
  'session.prompt_async',
]);

export const MOBILE_OPENCODE_REQUEST_BODY_LIMIT_BYTES = 512 * 1024;
export const MOBILE_OPENCODE_RESPONSE_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
export const MOBILE_SESSION_MESSAGE_PAGE_SIZE = 20;
const MOBILE_OPENCODE_TIMEOUT_MS = 30_000;

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface MobileOpenCodeProxyOptions {
  baseUrl?: string;
  fetchFn?: FetchFn;
  requestBodyLimitBytes?: number;
  responseBodyLimitBytes?: number;
  timeoutMs?: number;
  ownershipRepository?: MobileOpenCodeOwnershipStore;
  preparePromptStream?: (
    input: MobilePromptStreamInput,
  ) => Promise<void>;
}

export interface MobilePromptStreamInput {
  directory: string;
  projectId: string;
  sdkSessionId: string;
  userId: number;
}

export interface MobileOpenCodeForwardInput {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: unknown;
  project: MobileProjectScope;
  userId: number;
  accept?: string;
  ownerUnscopedDiscovery?: boolean;
}

export interface MobileOpenCodeProxyResponse {
  status: number;
  contentType?: string;
  headers?: Record<string, string>;
  body: Uint8Array;
}

function operationNotAllowed(): AppError {
  return new AppError(
    403,
    'OPERATION_NOT_ALLOWED',
    'OpenCode operation is not allowed for mobile',
  );
}

function decodeSafeSegments(path: string): string[] | null {
  if (
    !path.startsWith('/') ||
    path.includes('?') ||
    path.includes('#') ||
    path.length > 2_048
  ) {
    return null;
  }
  const rawSegments = path.slice(1).split('/');
  if (rawSegments.some((segment) => segment === '')) return null;
  try {
    const segments = rawSegments.map((segment) => decodeURIComponent(segment));
    if (segments.some((segment) =>
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('\0')
    )) {
      return null;
    }
    return segments;
  } catch {
    return null;
  }
}

function templateSegments(path: string): string[] {
  return path.slice(1).split('/');
}

function matchesTemplate(template: string, segments: string[]): boolean {
  const expected = templateSegments(template);
  return expected.length === segments.length &&
    expected.every((segment, index) =>
      (segment.startsWith('{') && segment.endsWith('}')) ||
      segment === segments[index]);
}

function templateSpecificity(path: string): number {
  return templateSegments(path).reduce(
    (score, segment) =>
      score + (segment.startsWith('{') ? 0 : 1_000) + segment.length,
    0,
  );
}

export function matchMobileOpenCodeOperation(
  method: string,
  path: string,
): (typeof MOBILE_OPENCODE_OPERATION_MANIFEST)[number] | null {
  const segments = decodeSafeSegments(path);
  if (!segments) return null;
  const normalizedMethod = method.toUpperCase();
  let best: (typeof MOBILE_OPENCODE_OPERATION_MANIFEST)[number] | null = null;
  let bestSpecificity = -1;
  for (const operation of MOBILE_OPENCODE_OPERATION_MANIFEST) {
    if (
      operation.method !== normalizedMethod ||
      !matchesTemplate(operation.path, segments)
    ) {
      continue;
    }
    const specificity = templateSpecificity(operation.path);
    if (specificity > bestSpecificity) {
      best = operation;
      bestSpecificity = specificity;
    }
  }
  return best;
}

function safeForwardPath(path: string): string {
  const segments = decodeSafeSegments(path);
  if (!segments) throw operationNotAllowed();
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function stripRootFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRootFields);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([field]) => !ROOT_FIELDS.has(field.toLowerCase()))
      .map(([field, child]) => [field, stripRootFields(child)]),
  );
}

function recordField(
  value: unknown,
  field: string,
): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[field]
    : undefined;
}

function stringRecordField(
  value: unknown,
  ...fields: string[]
): string | null {
  for (const field of fields) {
    const candidate = recordField(value, field);
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }
  return null;
}

function reconcileCatalogSession(
  value: unknown,
  input: MobileOpenCodeForwardInput,
  ownership: MobileOpenCodeOwnershipStore,
  failureMode: 'required' | 'opportunistic',
): void {
  const sdkSessionId = stringRecordField(value, 'id');
  if (
    !sdkSessionId ||
    !ownership.isResourceExplicitlyOwnedBy?.(
      'session',
      sdkSessionId,
      input.userId,
      input.project.id,
    )
  ) {
    return;
  }
  const time = recordField(value, 'time');
  const archived = recordField(time, 'archived');
  const updated = recordField(time, 'updated');
  const model = recordField(value, 'model');
  const opencodeAgentId = stringRecordField(value, 'agent');
  const profileId = resolveProfileIdForOpenCodeAgent(
    opencodeAgentId,
    new AgentConfigsRepository().list(),
  );
  const updatedAt =
    typeof updated === 'number' && Number.isFinite(updated)
      ? new Date(updated).toISOString()
      : undefined;
  const archivedAt =
    typeof archived === 'number' && archived > 0
      ? new Date(archived).toISOString()
      : null;
  try {
    new AgentSessionsRepository().reconcileMobileSession({
      sdkSessionId,
      ownerUserId: input.userId,
      projectId: input.project.id,
      cwd: input.project.root,
      name: stringRecordField(value, 'title', 'name') ?? 'Untitled chat',
      archivedAt,
      updatedAt,
      profileId: profileId ? asRhythmProfileId(profileId) : null,
      opencodeAgentId: opencodeAgentId
        ? asOpenCodeAgentId(opencodeAgentId)
        : null,
      providerId: stringRecordField(model, 'providerID', 'providerId'),
      modelId: stringRecordField(model, 'id', 'modelID', 'modelId'),
    });
  } catch (error) {
    if (failureMode === 'required') {
      throw new AppError(
        500,
        'SESSION_CATALOG_PERSISTENCE_FAILED',
        'Session catalog update failed',
      );
    }
    logger.error(
      '[MobileOpenCodeProxy] opportunistic session catalog reconciliation failed',
      {
        error_class: error instanceof Error ? error.name : 'UnknownError',
        sdk_session_id: sdkSessionId,
      },
    );
  }
}

const SESSION_STATE_RESPONSE_OPERATIONS = new Set([
  'experimental.session.list',
  'session.children',
  'session.create',
  'session.list',
  'session.update',
]);

function attachSafeSessionState(
  operationId: string,
  value: unknown,
  input: MobileOpenCodeForwardInput,
): unknown {
  if (!SESSION_STATE_RESPONSE_OPERATIONS.has(operationId)) return value;

  const attach = (candidate: unknown): unknown => {
    const sdkSessionId = stringRecordField(candidate, 'id');
    if (
      !sdkSessionId ||
      !candidate ||
      typeof candidate !== 'object'
    ) {
      return candidate;
    }
    const sessions = new AgentSessionsRepository();
    const local = sessions.findBySdkSessionId(sdkSessionId);
    if (
      !local ||
      !canUpdateMobileSessionState(local, input.userId, input.project.id)
    ) {
      return candidate;
    }
    return {
      ...(candidate as Record<string, unknown>),
      rhythm: safeMobileSessionProfileState(
        local,
        new AgentConfigsRepository().list(),
      ),
    };
  };

  return Array.isArray(value) ? value.map(attach) : attach(value);
}

function invalidPromptFileUrl(): AppError {
  return AppError.forbidden('Project path is outside the selected project');
}

function validDataUrl(value: string): boolean {
  const comma = value.indexOf(',');
  if (comma < 'data:'.length) return false;

  const metadata = value.slice('data:'.length, comma);
  const payload = value.slice(comma + 1);
  if (/[\u0000-\u001f\u007f]/.test(metadata + payload)) return false;

  const parameters = metadata.split(';');
  const base64 = parameters.at(-1)?.toLowerCase() === 'base64';
  if (base64) {
    return payload.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(payload);
  }
  try {
    decodeURIComponent(payload);
    return true;
  } catch {
    return false;
  }
}

function sanitizePromptFileUrl(
  value: unknown,
  project: MobileProjectScope,
): string {
  if (typeof value !== 'string') throw invalidPromptFileUrl();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidPromptFileUrl();
  }

  if (url.protocol === 'data:') {
    if (!validDataUrl(value)) throw invalidPromptFileUrl();
    return value;
  }
  if (url.protocol !== 'file:') throw invalidPromptFileUrl();

  let nativePath: string;
  try {
    nativePath = fileURLToPath(url);
  } catch {
    throw invalidPromptFileUrl();
  }
  const canonicalPath = resolveMobileProjectPath(project, nativePath);
  return pathToFileURL(canonicalPath).href;
}

function sanitizeRequestBodyBeforeScope(
  value: unknown,
  operationId: string,
  project: MobileProjectScope,
): unknown {
  if (
    operationId === 'worktree.remove' ||
    operationId === 'worktree.reset'
  ) {
    return value;
  }

  const stripped = stripRootFields(value);
  if (
    !PROMPT_FILE_PART_OPERATIONS.has(operationId) ||
    typeof stripped !== 'object' ||
    stripped === null ||
    Array.isArray(stripped)
  ) {
    return stripped;
  }

  const body = stripped as Record<string, unknown>;
  if (!Array.isArray(body.parts)) return body;
  return {
    ...body,
    parts: body.parts.map((part) => {
      if (
        typeof part !== 'object' ||
        part === null ||
        Array.isArray(part) ||
        (part as Record<string, unknown>).type !== 'file'
      ) {
        return part;
      }
      const file = part as Record<string, unknown>;
      return {
        ...file,
        url: sanitizePromptFileUrl(file.url, project),
      };
    }),
  };
}

async function sanitizeRequestBody(
  value: unknown,
  operationId: string,
  project: MobileProjectScope,
  fetchJson: MobileOpenCodeJsonFetcher,
): Promise<unknown> {
  if (
    operationId === 'worktree.remove' ||
    operationId === 'worktree.reset'
  ) {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value)
    ) {
      throw AppError.badRequest('Invalid worktree request');
    }
    const body = value as Record<string, unknown>;
    const directory = await resolveMobileWorktreeReference(
      body.directory,
      project,
      fetchJson,
    );
    const stripped = stripRootFields(body);
    if (
      typeof stripped !== 'object' ||
      stripped === null ||
      Array.isArray(stripped)
    ) {
      throw AppError.badRequest('Invalid worktree request');
    }
    return {
      ...stripped,
      directory,
    };
  }
  return sanitizeRequestBodyBeforeScope(value, operationId, project);
}

const MOBILE_CORE_PERMISSION_ACTIONS = new Set([
  'allow',
  'ask',
  'deny',
] as const);

type MobileCorePermissionRule = {
  permission: string;
  pattern: string;
  action: 'allow' | 'ask' | 'deny';
};

function expandMobileCorePermissions(
  corePermissionsJson: string | null,
): MobileCorePermissionRule[] | undefined {
  if (corePermissionsJson === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(corePermissionsJson);
  } catch {
    throw AppError.internal('Mobile profile permissions are invalid');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw AppError.internal('Mobile profile permissions are invalid');
  }

  const rules: MobileCorePermissionRule[] = [];
  for (const [permission, value] of Object.entries(parsed)) {
    if (!permission.trim()) {
      throw AppError.internal('Mobile profile permissions are invalid');
    }
    if (typeof value === 'string') {
      if (!MOBILE_CORE_PERMISSION_ACTIONS.has(
        value as MobileCorePermissionRule['action'],
      )) {
        throw AppError.internal('Mobile profile permissions are invalid');
      }
      rules.push({
        permission,
        pattern: '*',
        action: value as MobileCorePermissionRule['action'],
      });
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw AppError.internal('Mobile profile permissions are invalid');
    }
    for (const [pattern, action] of Object.entries(value)) {
      if (
        !pattern.trim() ||
        typeof action !== 'string' ||
        !MOBILE_CORE_PERMISSION_ACTIONS.has(
          action as MobileCorePermissionRule['action'],
        )
      ) {
        throw AppError.internal('Mobile profile permissions are invalid');
      }
      rules.push({
        permission,
        pattern,
        action: action as MobileCorePermissionRule['action'],
      });
    }
  }
  return rules;
}

async function applyMobileSessionCreateScope(
  value: unknown,
  operationId: string,
): Promise<unknown> {
  if (
    operationId !== 'session.create' ||
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return value;
  }

  const body = value as Record<string, unknown>;
  const rawProfileId = body.profileId;
  // Older mobile clients did not send the selected profile until a follow-up
  // state PATCH. Preserve their create behavior while current clients move the
  // profile identity into this atomic request.
  if (rawProfileId === undefined) return body;
  if (typeof rawProfileId !== 'string' || rawProfileId.trim() === '') {
    throw AppError.badRequest('profileId must be a non-empty string');
  }

  const profileId = rawProfileId.trim();
  const profile = new AgentConfigsRepository().getById(profileId);
  if (
    !profile ||
    !profile.sessionSelectable ||
    agentConfigExecutionBlockReason(profile) !== null ||
    !profile.ocAgent
  ) {
    throw AppError.notFound('Mobile profile');
  }

  // Resolve the exact same profile tuple used by desktop/WS creation. The
  // custom profileId is gateway metadata only and must never reach OpenCode.
  const scope = await resolveProfileScope(profileId);
  const scopedBody = Object.fromEntries(
    Object.entries(body).filter(([field]) =>
      field !== 'profileId' &&
      field !== 'agent' &&
      field !== 'model' &&
      field !== 'permission' &&
      field !== 'mcpAllowlist' &&
      field !== 'skillAllowlist'),
  );

  scopedBody.agent = profile.ocAgent;
  scopedBody.model = {
    providerID: scope.model.providerID,
    id: scope.model.modelID,
  };

  const permission = expandMobileCorePermissions(
    profile.corePermissionsJson,
  );
  if (permission !== undefined) scopedBody.permission = permission;

  if (scope.mcpRoleConfig) {
    const expanded = applySelectiveDeferral(
      expandMcpAllowlist(scope.mcpRoleConfig),
      toolCountsForRoleConfig(scope.mcpRoleConfig.mcpServers),
      scope.model.providerID,
    );
    const capped = capMcpAllowlistForProvider(
      expanded,
      scope.model.providerID,
    );
    if (capped.trimmed) {
      logger.warn(capped.warning ?? '[GeminiToolCap] allowlist trimmed');
    }
    scopedBody.mcpAllowlist = capped.allowlist;
  }

  const skillAllowlist = expandProfileSkillAllowlist(
    scope.allowedSkillsJson,
  );
  if (skillAllowlist !== undefined) {
    scopedBody.skillAllowlist = skillAllowlist;
  }

  return scopedBody;
}

function scopedQuery(
  callerQuery: URLSearchParams,
  project: MobileProjectScope,
  operationId: string,
  ownerUnscopedDiscovery = false,
): URLSearchParams {
  const scoped = new URLSearchParams();
  for (const [field, value] of callerQuery.entries()) {
    const normalizedField = field.toLowerCase();
    if (ROOT_FIELDS.has(normalizedField)) continue;
    if (
      operationId === 'session.messages' &&
      normalizedField === 'limit'
    ) {
      continue;
    }
    if (
      normalizedField === 'path' &&
      SCOPED_PATH_QUERY_OPERATIONS.has(operationId)
    ) {
      const containedRoot = resolveMobileProjectPath(project, '.');
      const containedPath = resolveMobileProjectPath(project, value);
      // OpenCode resolves file/session paths relative to its `directory`
      // context. Forwarding an absolute path makes its path.join() treat the
      // root prefix as a literal child and silently read an empty document.
      scoped.append(field, relative(containedRoot, containedPath) || '.');
      continue;
    }
    scoped.append(field, value);
  }
  if (operationId === 'session.messages') {
    scoped.set('limit', String(MOBILE_SESSION_MESSAGE_PAGE_SIZE));
  }
  if (!ownerUnscopedDiscovery) scoped.set('directory', project.root);
  return scoped;
}

async function readBoundedBody(
  response: Response,
  limitBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > limitBytes
  ) {
    await response.body?.cancel();
    throw new AppError(
      502,
      'UPSTREAM_RESPONSE_TOO_LARGE',
      'OpenCode response exceeded the mobile gateway limit',
    );
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limitBytes) {
        await reader.cancel();
        throw new AppError(
          502,
          'UPSTREAM_RESPONSE_TOO_LARGE',
          'OpenCode response exceeded the mobile gateway limit',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function normalizedUpstreamError(status: number): MobileOpenCodeProxyResponse {
  const clientSafeStatus = [400, 404, 409, 422, 429].includes(status)
    ? status
    : 502;
  return {
    status: clientSafeStatus,
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({
      error: {
        code: 'OPENCODE_UPSTREAM_ERROR',
        message: 'OpenCode request failed',
        upstreamStatus: status,
      },
    })),
  };
}

function responseResourceId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(id)
    ? id
    : null;
}

function operationPathParameter(
  operationPath: string,
  requestPath: string,
  parameter: string,
): string | null {
  const template = operationPath.slice(1).split('/');
  const actual = requestPath.slice(1).split('/');
  const index = template.indexOf(`{${parameter}}`);
  if (index < 0 || index >= actual.length) return null;
  try {
    const decoded = decodeURIComponent(actual[index]);
    return /^[A-Za-z0-9_-]{1,256}$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export class MobileOpenCodeProxy {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly requestBodyLimitBytes: number;
  private readonly responseBodyLimitBytes: number;
  private readonly timeoutMs: number;
  private readonly configuredOwnershipRepository?:
    MobileOpenCodeOwnershipStore;
  private readonly preparePromptStream: (
    input: MobilePromptStreamInput,
  ) => Promise<void>;

  constructor(options: MobileOpenCodeProxyOptions = {}) {
    this.baseUrl = (
      options.baseUrl ?? `http://127.0.0.1:${OPENCODE_ENGINE_PORT}`
    ).replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.requestBodyLimitBytes =
      options.requestBodyLimitBytes ??
      MOBILE_OPENCODE_REQUEST_BODY_LIMIT_BYTES;
    this.responseBodyLimitBytes =
      options.responseBodyLimitBytes ??
      MOBILE_OPENCODE_RESPONSE_BODY_LIMIT_BYTES;
    this.timeoutMs = options.timeoutMs ?? MOBILE_OPENCODE_TIMEOUT_MS;
    this.configuredOwnershipRepository = options.ownershipRepository;
    this.preparePromptStream = options.preparePromptStream ??
      (async ({ directory, sdkSessionId, userId }) => {
        const localSession = new AgentSessionsRepository()
          .findBySdkSessionId(sdkSessionId);
        if (!localSession || localSession.ownerUserId !== userId) return;
        const { streamBridge } = await import('./opencode_stream_bridge');
        await streamBridge.streamSession(
          localSession.id,
          sdkSessionId,
          directory,
        );
      });
  }

  async forward(
    input: MobileOpenCodeForwardInput,
  ): Promise<MobileOpenCodeProxyResponse> {
    const operation = matchMobileOpenCodeOperation(input.method, input.path);
    if (!operation?.allowed) throw operationNotAllowed();
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
      throw AppError.unauthorized('Paired user ownership is required');
    }
    const ownership = this.configuredOwnershipRepository ??
      getMobileOpenCodeOwnershipRepository();
    const owner = {
      ownerUserId: input.userId,
      ownership,
    };
    const addressedSessionId = operationPathParameter(
      operation.path,
      input.path,
      'sessionID',
    );
    const authoritativeSessionDirectory = addressedSessionId
      ? ownership.resolveSessionDirectoryForOwner?.(
          addressedSessionId,
          input.userId,
          input.project.id,
        )
      : null;
    const requestProject = authoritativeSessionDirectory
      ? { ...input.project, root: authoritativeSessionDirectory }
      : input.project;

    const ownerUnscopedDiscovery = input.ownerUnscopedDiscovery === true;
    if (
      ownerUnscopedDiscovery &&
      operation.operationId !== 'experimental.session.list'
    ) {
      throw operationNotAllowed();
    }

    const query = scopedQuery(
      input.query,
      requestProject,
      operation.operationId,
      ownerUnscopedDiscovery,
    );
    if (ownerUnscopedDiscovery) {
      const requestedLimit = Number(query.get('limit'));
      const requestedCursor = Number(query.get('cursor'));
      const limit = Number.isSafeInteger(requestedLimit)
        ? Math.max(1, Math.min(100, requestedLimit))
        : 100;
      const cursor = Number.isSafeInteger(requestedCursor) && requestedCursor >= 0
        ? requestedCursor
        : 0;
      const page = await listOwnerUnscopedMobileChats({
        archived: query.get('archived') === 'true',
        cursor,
        limit,
        ownerUserId: input.userId,
        projectId: input.project.id,
        sessionId: query.get('search')?.trim() || undefined,
      });
      const safeBody = Buffer.from(JSON.stringify(
        page.items.map((item) => {
          const projectId = typeof item.projectId === 'string' &&
              item.projectId.trim().length > 0
            ? item.projectId
            : null;
          return {
            ...item,
            projectId,
            ...(projectId === null
              ? { routingProjectId: input.project.id }
              : {}),
          };
        }),
      ));
      if (safeBody.byteLength > this.responseBodyLimitBytes) {
        throw new AppError(
          502,
          'UPSTREAM_RESPONSE_TOO_LARGE',
          'OpenCode response exceeded the mobile gateway limit',
        );
      }
      return {
        status: 200,
        contentType: 'application/json',
        ...(page.nextCursor === null
          ? {}
          : { headers: { 'x-next-cursor': String(page.nextCursor) } }),
        body: safeBody,
      };
    }
    const url = `${this.baseUrl}${safeForwardPath(input.path)}?${query.toString()}`;
    const acceptsBody = operation.method !== 'GET';
    const callerBody = !acceptsBody || input.body === undefined
      ? undefined
      : JSON.stringify(input.body);
    if (
      callerBody !== undefined &&
      Buffer.byteLength(callerBody, 'utf8') > this.requestBodyLimitBytes
    ) {
      throw new AppError(
        413,
        'REQUEST_TOO_LARGE',
        'OpenCode request exceeded the mobile gateway limit',
      );
    }
    if (acceptsBody && input.body !== undefined) {
      // Reject invalid file URLs and strip caller roots before any owner
      // preflight performs network I/O. Worktree refs are resolved later
      // because their authoritative map comes from the selected project.
      sanitizeRequestBodyBeforeScope(
        input.body,
        operation.operationId,
        requestProject,
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const fetchJson: MobileOpenCodeJsonFetcher = async (path) => {
        const scoped = new URLSearchParams({ directory: requestProject.root });
        const response = await this.fetchFn(
          `${this.baseUrl}${path}?${scoped.toString()}`,
          {
            method: 'GET',
            redirect: 'error',
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new AppError(
            502,
            'OPENCODE_SCOPE_CHECK_FAILED',
            'OpenCode could not validate the selected mobile resource',
          );
        }
        const body = await readBoundedBody(
          response,
          this.responseBodyLimitBytes,
        );
        try {
          return JSON.parse(Buffer.from(body).toString('utf8'));
        } catch {
          throw new AppError(
            502,
            'OPENCODE_SCOPE_CHECK_FAILED',
            'OpenCode returned an invalid mobile resource response',
          );
        }
      };
      await authorizeMobileOpenCodeOperation(
        operation,
        input.path,
        requestProject,
        fetchJson,
        input.query,
        input.body,
        owner,
      );
      const sanitizedBody = !acceptsBody || input.body === undefined
        ? undefined
        : await sanitizeRequestBody(
          input.body,
          operation.operationId,
          requestProject,
          fetchJson,
        );
      const scopedBody = sanitizedBody === undefined
        ? undefined
        : await applyMobileSessionCreateScope(
          sanitizedBody,
          operation.operationId,
        );
      const encodedBody = scopedBody === undefined
        ? undefined
        : JSON.stringify(scopedBody);
      if (
        encodedBody !== undefined &&
        Buffer.byteLength(encodedBody, 'utf8') > this.requestBodyLimitBytes
      ) {
        throw new AppError(
          413,
          'REQUEST_TOO_LARGE',
          'OpenCode request exceeded the mobile gateway limit',
        );
      }
      if (
        operation.operationId === 'session.prompt_async' &&
        addressedSessionId
      ) {
        await this.preparePromptStream({
          directory: requestProject.root,
          projectId: input.project.id,
          sdkSessionId: addressedSessionId,
          userId: input.userId,
        });
      }
      const response = await this.fetchFn(url, {
        method: operation.method,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          ...(input.accept ? { Accept: input.accept } : {}),
          ...(operation.operationId === 'pty.connectToken'
            ? { 'x-opencode-ticket': '1' }
            : {}),
          ...(encodedBody !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        ...(encodedBody !== undefined ? { body: encodedBody } : {}),
      });

      if (!response.ok) {
        await response.body?.cancel();
        return normalizedUpstreamError(response.status);
      }
      const contentType =
        response.headers.get('content-type') ?? undefined;
      const body = await readBoundedBody(
        response,
        this.responseBodyLimitBytes,
      );
      const releaseDeletedOwnership = (): void => {
        const sessionId = operationPathParameter(
          operation.path,
          input.path,
          'sessionID',
        );
        const ptyId = operationPathParameter(
          operation.path,
          input.path,
          'ptyID',
        );
        if (operation.operationId === 'session.delete' && sessionId) {
          ownership.releaseResource(
            'session',
            sessionId,
            input.userId,
            input.project.id,
          );
        }
        if (operation.operationId === 'pty.remove' && ptyId) {
          ownership.releaseResource(
            'pty',
            ptyId,
            input.userId,
            input.project.id,
          );
        }
      };
      if (
        body.byteLength > 0 &&
        contentType?.toLowerCase().includes('application/json')
      ) {
        let value: unknown;
        try {
          value = JSON.parse(Buffer.from(body).toString('utf8'));
        } catch {
          throw new AppError(
            502,
            'OPENCODE_INVALID_RESPONSE',
            'OpenCode returned an invalid mobile response',
          );
        }
        const claim = (
          kind: 'session' | 'pty',
          resourceId: string | null,
        ): void => {
          if (
            !resourceId ||
            !ownership.claimResource(
              kind,
              resourceId,
              input.userId,
              input.project.id,
            )
          ) {
            throw new AppError(
              502,
              'OPENCODE_OWNERSHIP_CONFLICT',
              'OpenCode returned an unowned mobile resource',
            );
          }
        };
        if (
          operation.operationId === 'session.create' ||
          operation.operationId === 'session.fork'
        ) {
          claim('session', responseResourceId(value));
        }
        if (operation.operationId === 'session.children') {
          if (!Array.isArray(value)) {
            throw new AppError(
              502,
              'OPENCODE_OWNERSHIP_CONFLICT',
              'OpenCode returned an invalid child-session response',
            );
          }
          for (const child of value) {
            claim('session', responseResourceId(child));
          }
        }
        if (operation.operationId === 'pty.create') {
          claim('pty', responseResourceId(value));
        }
        if (
          operation.operationId === 'session.create' ||
          operation.operationId === 'session.update'
        ) {
          reconcileCatalogSession(value, input, ownership, 'required');
        }
        if (
          operation.operationId === 'session.list' ||
          operation.operationId === 'experimental.session.list'
        ) {
          for (const session of Array.isArray(value) ? value : []) {
            reconcileCatalogSession(
              session,
              input,
              ownership,
              'opportunistic',
            );
          }
        }
        if (operation.operationId === 'session.delete') {
          const deletedSdkSessionId = operationPathParameter(
            operation.path,
            input.path,
            'sessionID',
          );
          if (
            deletedSdkSessionId &&
            ownership.isResourceOwnedBy(
              'session',
              deletedSdkSessionId,
              input.userId,
              input.project.id,
            )
          ) {
            const catalog = new AgentSessionsRepository();
            const local = catalog.findBySdkSessionId(deletedSdkSessionId);
            if (
              local?.ownerUserId === input.userId &&
              local.projectId === input.project.id
            ) {
              catalog.deleteById(local.id);
            }
          }
        }
        releaseDeletedOwnership();
        const safeValue = await shapeMobileOpenCodeResponse(
          operation,
          value,
          requestProject,
          fetchJson,
          input.path,
          owner,
          ownerUnscopedDiscovery,
        );
        const safeBody = Buffer.from(JSON.stringify(
          attachSafeSessionState(
            operation.operationId,
            safeValue,
            input,
          ),
        ));
        if (safeBody.byteLength > this.responseBodyLimitBytes) {
          throw new AppError(
            502,
            'UPSTREAM_RESPONSE_TOO_LARGE',
            'OpenCode response exceeded the mobile gateway limit',
          );
        }
        return {
          status: response.status,
          contentType,
          ...(operation.operationId === 'experimental.session.list' &&
              /^\d+$/.test(response.headers.get('x-next-cursor') ?? '')
            ? {
                headers: {
                  'x-next-cursor': response.headers.get('x-next-cursor')!,
                },
              }
            : {}),
          body: safeBody,
        };
      }
      if (body.byteLength > 0) {
        releaseDeletedOwnership();
        const safeText = shapeMobileOpenCodeTextResponse(
          operation,
          Buffer.from(body).toString('utf8'),
          input.project,
        );
        const safeBody = Buffer.from(safeText);
        if (safeBody.byteLength > this.responseBodyLimitBytes) {
          throw new AppError(
            502,
            'UPSTREAM_RESPONSE_TOO_LARGE',
            'OpenCode response exceeded the mobile gateway limit',
          );
        }
        return {
          status: response.status,
          contentType,
          body: safeBody,
        };
      }
      releaseDeletedOwnership();
      return {
        status: response.status,
        contentType,
        body,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      const causeCode = error instanceof Error &&
          typeof error.cause === 'object' &&
          error.cause !== null &&
          'code' in error.cause
        ? String(error.cause.code)
        : 'UNKNOWN';
      // Intentionally omit the URL, headers, body, and raw error message:
      // each can contain a project path, prompt, or credential.
      logger.warn(
        `[MobileOpenCodeProxy] upstream fetch failed (${error instanceof Error ? error.name : 'UnknownError'}/${causeCode})`,
      );
      throw new AppError(
        502,
        'OPENCODE_UNAVAILABLE',
        'OpenCode is unavailable',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
