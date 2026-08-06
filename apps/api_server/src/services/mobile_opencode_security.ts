import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  basename,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { AppError } from '../errors/app_error';
import type {
  MobileOpenCodeOwnershipReader,
  MobileOpenCodeResourceKind,
} from '../repositories/mobile_opencode_ownership_repository';
import { canonicalize, containsReal } from '../utils/path_containment';
import type { MobileProjectScope } from './mobile_project_scope';
import type { MobileOpenCodeOperation } from './mobile_opencode_proxy_types';

export type MobileOpenCodeJsonFetcher = (
  path: string,
) => Promise<unknown>;

type JsonRecord = Record<string, unknown>;

export interface MobileOpenCodeOwnerScope {
  ownerUserId: number;
  ownership: MobileOpenCodeOwnershipReader;
}

export type MobileOpenCodeResourceScope = {
  engineSessions?: unknown[];
  sessions?: unknown[];
  sessionIds?: Set<string>;
  authorizedSessions?: Map<string, boolean>;
  permissions?: unknown[];
  questions?: unknown[];
  ptys?: unknown[];
  worktrees?: string[];
};

type ResourceScope = MobileOpenCodeResourceScope;

const OMIT = Symbol('omit-mobile-field');
const REDACTED_SECRET = '[redacted]';
const REDACTED_PATH = '[redacted-path]';

const OMITTED_HOST_FIELDS = new Set([
  'cwd',
  'home',
  'root',
  'roots',
  'workingdirectory',
  'worktree',
  'worktreedir',
]);

const PSEUDONYMOUS_SCOPE_FIELDS = new Set([
  'directory',
  'workspace',
  'workspaceid',
]);

const SECRET_CONTAINER_FIELDS = new Set([
  'env',
  'environment',
  'header',
  'headers',
]);

const SAFE_TOKEN_COUNTER_FIELDS = new Set([
  'cachedtokens',
  'inputtokens',
  'maxtokens',
  'outputtokens',
  'reasoningtokens',
  'tokencount',
  'tokenlimit',
  'tokens',
  'tokenusage',
  'totaltokens',
]);

const CONTENT_FIELDS = new Set([
  'content',
  'description',
  'name',
  'text',
  'title',
]);

const DIAGNOSTIC_FIELDS = new Set([
  'details',
  'diff',
  'error',
  'message',
  'output',
  'patch',
  'stack',
  'stderr',
  'stdout',
]);

const PLAIN_KEY_SECRET_OPERATIONS = new Set([
  'auth.remove',
  'auth.set',
  'config.get',
  'config.update',
  'global.config.get',
  'global.config.update',
  'provider.auth',
  'provider.list',
  'provider.oauth.authorize',
  'provider.oauth.callback',
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedField(field: string): string {
  return field.toLowerCase().replace(/[-_\s]/g, '');
}

function isSecretField(field: string): boolean {
  const normalized = normalizedField(field);
  if (SAFE_TOKEN_COUNTER_FIELDS.has(normalized)) return false;
  return normalized === 'token' ||
    normalized === 'apikey' ||
    normalized === 'password' ||
    normalized === 'secret' ||
    normalized === 'credential' ||
    normalized === 'credentials' ||
    normalized === 'authorization' ||
    normalized === 'bearer' ||
    normalized === 'privatekey' ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('authtoken') ||
    normalized.endsWith('bearertoken') ||
    normalized.endsWith('clientsecret') ||
    normalized.endsWith('credential') ||
    normalized.endsWith('idtoken') ||
    normalized.endsWith('privatekey') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('sessiontoken');
}

function isPathField(field: string): boolean {
  const normalized = normalizedField(field);
  return normalized === 'absolute' ||
    normalized === 'file' ||
    normalized === 'filepath' ||
    normalized === 'path' ||
    normalized === 'uri' ||
    normalized.endsWith('filepath');
}

function stringField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[field];
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * OpenCode already receives a canonical Rhythm-owned directory on every
 * gateway request. Treat returned resource metadata as belonging to that
 * project only when its path is within the selected root. Existing paths get
 * a realpath containment check; synthetic test/upstream metadata still has to
 * pass lexical containment.
 */
export function mobilePathBelongsToProject(
  value: unknown,
  project: MobileProjectScope,
): boolean {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  const candidate = resolve(value);
  const lexicalRelative = relative(project.root, candidate);
  if (
    lexicalRelative.startsWith('..') ||
    isAbsolute(lexicalRelative)
  ) {
    return false;
  }
  if (!existsSync(candidate)) return true;
  try {
    return containsReal(project.root, canonicalize(candidate));
  } catch {
    return false;
  }
}

function sessionBelongsToProject(
  value: unknown,
  project: MobileProjectScope,
): boolean {
  return mobilePathBelongsToProject(
    stringField(value, 'directory'),
    project,
  );
}

function ptyBelongsToProject(
  value: unknown,
  project: MobileProjectScope,
): boolean {
  return mobilePathBelongsToProject(
    stringField(value, 'cwd') ?? stringField(value, 'directory'),
    project,
  );
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function resourceOwnedByCaller(
  kind: MobileOpenCodeResourceKind,
  resourceId: string | undefined,
  project: MobileProjectScope,
  owner: MobileOpenCodeOwnerScope,
): boolean {
  if (
    !resourceId ||
    !Number.isSafeInteger(owner.ownerUserId) ||
    owner.ownerUserId <= 0
  ) {
    return false;
  }
  if (
    owner.ownership.isResourceOwnedBy(
      kind,
      resourceId,
      owner.ownerUserId,
      project.id,
    )
  ) {
    return true;
  }
  return kind === 'session' &&
    Boolean(
      owner.ownership.isSessionOwnedByDesktopCatalog?.(
        resourceId,
        owner.ownerUserId,
        project.id,
      ),
    );
}

function sessionVisibleInChatCatalog(
  resourceId: string | undefined,
  projectId: string | null,
  project: MobileProjectScope,
  owner: MobileOpenCodeOwnerScope,
): boolean {
  if (!resourceId) return false;
  if (
    projectId !== null &&
    owner.ownership.isResourceExplicitlyOwnedBy?.(
      'session',
      resourceId,
      owner.ownerUserId,
      project.id,
    )
  ) {
    return true;
  }
  const catalogPredicate = owner.ownership.isSessionVisibleInChatCatalog;
  if (catalogPredicate) {
    return catalogPredicate.call(
      owner.ownership,
      resourceId,
      owner.ownerUserId,
      projectId,
    );
  }
  // Older injected test repositories predate the catalog predicate. Preserve
  // their project-scoped behavior, but fail closed for unscoped discovery.
  return projectId !== null && resourceOwnedByCaller(
    'session',
    resourceId,
    project,
    owner,
  );
}

/** Bound the parent walk so malformed or cyclic ancestry cannot spin. */
const MAX_SESSION_ANCESTRY_DEPTH = 32;

async function engineSessions(
  fetchJson: MobileOpenCodeJsonFetcher,
  scope: ResourceScope,
): Promise<unknown[]> {
  if (!scope.engineSessions) {
    scope.engineSessions = asArray(await fetchJson('/session'));
  }
  return scope.engineSessions;
}

/**
 * A subagent runs in a child session the caller never created, so no ownership
 * row is ever written for it — children spawned inside the engine do not travel
 * through this proxy. Treating that as "not yours" silently dropped every
 * subagent approval out of the mobile permission list and turned replying to
 * one into a 404.
 *
 * Walk `parentID` instead: a session is addressable when it, or an ancestor,
 * carries a claim for this caller. The walk reads only the session collection
 * already fetched for this project, so no additional id is addressed upstream
 * and the #1175 no-oracle contract is untouched.
 */
function ancestryAuthorizesSession(
  session: unknown,
  sessionsById: Map<string, unknown>,
  project: MobileProjectScope,
  owner: MobileOpenCodeOwnerScope,
): boolean {
  let current: unknown = session;
  for (
    let depth = 0;
    current !== undefined && depth < MAX_SESSION_ANCESTRY_DEPTH;
    depth += 1
  ) {
    const currentId = stringField(current, 'id');
    if (
      currentId &&
      resourceOwnedByCaller('session', currentId, project, owner)
    ) {
      return true;
    }
    const parentId = stringField(current, 'parentID');
    if (!parentId) return false;
    current = sessionsById.get(parentId);
  }
  return false;
}

async function projectSessions(
  fetchJson: MobileOpenCodeJsonFetcher,
  project: MobileProjectScope,
  scope: ResourceScope,
  owner: MobileOpenCodeOwnerScope,
): Promise<unknown[]> {
  if (!scope.sessions) {
    const all = await engineSessions(fetchJson, scope);
    const sessionsById = new Map<string, unknown>();
    for (const session of all) {
      const id = stringField(session, 'id');
      if (id) sessionsById.set(id, session);
    }
    scope.sessions = all.filter((session) =>
      sessionBelongsToProject(session, project) &&
      ancestryAuthorizesSession(session, sessionsById, project, owner));
  }
  return scope.sessions;
}

async function projectSessionIds(
  fetchJson: MobileOpenCodeJsonFetcher,
  project: MobileProjectScope,
  scope: ResourceScope,
  owner: MobileOpenCodeOwnerScope,
): Promise<Set<string>> {
  if (!scope.sessionIds) {
    scope.sessionIds = new Set(
      (await projectSessions(fetchJson, project, scope, owner))
        .map((session) => stringField(session, 'id'))
        .filter((id): id is string => Boolean(id)),
    );
  }
  return scope.sessionIds;
}

/**
 * Answer "is this one session addressable by this caller" without enumerating
 * the project's sessions when a durable ownership row already settles it.
 *
 * An explicit `mobile_opencode_resource_owners` row is keyed on
 * (kind, id, owner, project), so a hit proves both dimensions the list-based
 * filter checks — this gateway itself claimed that session for this user in
 * this project. That is one indexed local read and no upstream traffic.
 *
 * Everything else falls through to the unchanged `/session` path: desktop
 * catalog sessions, the NULL-project fallback, and any id with no ownership
 * row. Crucially the fallback still decides membership by inspecting the
 * project's own session list, never by addressing the requested id upstream,
 * so the #1175 contract that a global OpenCode id cannot act as an oracle
 * holds for every id this fast path does not already own.
 *
 * Tradeoff: the fast path trusts the ownership row instead of re-reading the
 * engine's `directory` for that session. The row is written by this gateway
 * when it claims the resource, so the two only diverge if a session's
 * directory changes after the claim.
 */
async function sessionAuthorizedForCaller(
  sessionId: string,
  project: MobileProjectScope,
  fetchJson: MobileOpenCodeJsonFetcher,
  scope: ResourceScope,
  owner: MobileOpenCodeOwnerScope,
): Promise<boolean> {
  // A resolved list already carries the answer for every id.
  if (scope.sessionIds) return scope.sessionIds.has(sessionId);

  const memo = scope.authorizedSessions ??= new Map<string, boolean>();
  const cached = memo.get(sessionId);
  if (cached !== undefined) return cached;

  const explicitlyOwned = owner.ownership.isResourceExplicitlyOwnedBy?.(
    'session',
    sessionId,
    owner.ownerUserId,
    project.id,
  );
  if (explicitlyOwned === true) {
    memo.set(sessionId, true);
    return true;
  }

  const authorized = (await projectSessionIds(
    fetchJson,
    project,
    scope,
    owner,
  )).has(sessionId);
  memo.set(sessionId, authorized);
  return authorized;
}

/**
 * Filter a small engine-side list down to rows whose session the caller may
 * address. Distinct sessions across pending permissions/questions are few, and
 * `sessionAuthorizedForCaller` memoizes per id, so this stays bounded by the
 * list rather than by session history.
 */
async function filterBySessionAuthorization(
  rows: unknown[],
  project: MobileProjectScope,
  fetchJson: MobileOpenCodeJsonFetcher,
  scope: ResourceScope,
  owner: MobileOpenCodeOwnerScope,
): Promise<unknown[]> {
  const kept: unknown[] = [];
  for (const row of rows) {
    const sessionId =
      stringField(row, 'sessionID') ??
      stringField(row, 'sessionId');
    if (sessionId === undefined) continue;
    if (
      await sessionAuthorizedForCaller(
        sessionId,
        project,
        fetchJson,
        scope,
        owner,
      )
    ) {
      kept.push(row);
    }
  }
  return kept;
}

async function projectPermissions(
  fetchJson: MobileOpenCodeJsonFetcher,
  project: MobileProjectScope,
  scope: ResourceScope,
  owner: MobileOpenCodeOwnerScope,
): Promise<unknown[]> {
  if (!scope.permissions) {
    scope.permissions = await filterBySessionAuthorization(
      asArray(await fetchJson('/permission')),
      project,
      fetchJson,
      scope,
      owner,
    );
  }
  return scope.permissions;
}

async function projectQuestions(
  fetchJson: MobileOpenCodeJsonFetcher,
  project: MobileProjectScope,
  scope: ResourceScope,
  owner: MobileOpenCodeOwnerScope,
): Promise<unknown[]> {
  if (!scope.questions) {
    scope.questions = await filterBySessionAuthorization(
      asArray(await fetchJson('/question')),
      project,
      fetchJson,
      scope,
      owner,
    );
  }
  return scope.questions;
}

async function projectPtys(
  fetchJson: MobileOpenCodeJsonFetcher,
  project: MobileProjectScope,
  scope: ResourceScope,
  owner: MobileOpenCodeOwnerScope,
): Promise<unknown[]> {
  if (!scope.ptys) {
    scope.ptys = asArray(await fetchJson('/pty'))
      .filter((pty) =>
        ptyBelongsToProject(pty, project) &&
        resourceOwnedByCaller(
          'pty',
          stringField(pty, 'id'),
          project,
          owner,
        ));
  }
  return scope.ptys;
}

async function projectWorktrees(
  fetchJson: MobileOpenCodeJsonFetcher,
  scope: ResourceScope,
): Promise<string[]> {
  if (!scope.worktrees) {
    scope.worktrees = asArray(await fetchJson('/experimental/worktree'))
      .filter((entry): entry is string =>
        typeof entry === 'string' &&
        isAbsolute(entry) &&
        !entry.includes('\0')
      );
  }
  return scope.worktrees;
}

function worktreeReference(
  project: MobileProjectScope,
  directory: string,
): string {
  const normalized = resolve(directory);
  const digest = createHash('sha256')
    .update(project.id)
    .update('\0')
    .update(normalized)
    .digest('base64url')
    .slice(0, 24);
  const label = encodeURIComponent(basename(normalized) || 'worktree');
  return `rhythm-worktree://${digest}/${label}`;
}

export async function resolveMobileWorktreeReference(
  reference: unknown,
  project: MobileProjectScope,
  fetchJson: MobileOpenCodeJsonFetcher,
): Promise<string> {
  if (typeof reference !== 'string') throw resourceNotFound();
  const scope: ResourceScope = {};
  const directories = await projectWorktrees(fetchJson, scope);
  const match = directories.find((directory) =>
    worktreeReference(project, directory) === reference
  );
  if (!match) throw resourceNotFound();
  return match;
}

function templateParameters(
  operation: MobileOpenCodeOperation,
  path: string,
): Record<string, string> {
  const templates = operation.path.slice(1).split('/');
  const actual = path.slice(1).split('/');
  const parameters: Record<string, string> = {};
  for (const [index, template] of templates.entries()) {
    if (!template.startsWith('{') || !template.endsWith('}')) continue;
    parameters[template.slice(1, -1)] = decodeURIComponent(actual[index]);
  }
  return parameters;
}

function resourceNotFound(): AppError {
  return AppError.notFound('Mobile OpenCode resource');
}

function messageRecord(
  messages: unknown[],
  messageId: string,
): JsonRecord | undefined {
  return messages.find((message) => {
    if (!isRecord(message)) return false;
    return stringField(message.info, 'id') === messageId;
  }) as JsonRecord | undefined;
}

function partExists(message: JsonRecord, partId: string): boolean {
  return asArray(message.parts)
    .some((part) => stringField(part, 'id') === partId);
}

async function authorizeMessageAndPart(
  sessionId: string,
  messageId: string,
  partId: string | undefined,
  fetchJson: MobileOpenCodeJsonFetcher,
): Promise<void> {
  const messages = asArray(
    await fetchJson(`/session/${encodeURIComponent(sessionId)}/message`),
  );
  const message = messageRecord(messages, messageId);
  if (!message || (partId && !partExists(message, partId))) {
    throw resourceNotFound();
  }
}

/**
 * Authorize every ID-addressed paired operation against resources visible
 * from the selected canonical project. The check happens before the requested
 * mutation/read is forwarded, so a global OpenCode ID cannot act as an oracle.
 */
export async function authorizeMobileOpenCodeOperation(
  operation: MobileOpenCodeOperation,
  path: string,
  project: MobileProjectScope,
  fetchJson: MobileOpenCodeJsonFetcher,
  query?: URLSearchParams,
  body?: unknown,
  owner?: MobileOpenCodeOwnerScope,
  sharedScope?: ResourceScope,
): Promise<void> {
  if (!owner) throw resourceNotFound();
  const parameters = templateParameters(operation, path);
  const scope: ResourceScope = sharedScope ?? {};
  const bodyRecord = isRecord(body) ? body : {};
  const sessionId =
    parameters.sessionID ??
    (typeof bodyRecord.parentID === 'string' ? bodyRecord.parentID : undefined);
  if (sessionId) {
    const authorized = await sessionAuthorizedForCaller(
      sessionId,
      project,
      fetchJson,
      scope,
      owner,
    );
    if (!authorized) throw resourceNotFound();
  }

  const messageId =
    parameters.messageID ??
    query?.get('messageID') ??
    (operation.operationId !== 'session.init' &&
    typeof bodyRecord.messageID === 'string'
      ? bodyRecord.messageID
      : undefined);
  const partId =
    parameters.partID ??
    (typeof bodyRecord.partID === 'string' ? bodyRecord.partID : undefined);
  if (messageId) {
    if (!sessionId) throw resourceNotFound();
    await authorizeMessageAndPart(
      sessionId,
      messageId,
      partId,
      fetchJson,
    );
  } else if (partId) {
    throw resourceNotFound();
  }

  const requestId = parameters.requestID;
  if (requestId && operation.operationId.startsWith('permission.')) {
    const permissions = await projectPermissions(
      fetchJson,
      project,
      scope,
      owner,
    );
    if (!permissions.some((request) => stringField(request, 'id') === requestId)) {
      throw resourceNotFound();
    }
  }
  if (requestId && operation.operationId.startsWith('question.')) {
    const questions = await projectQuestions(
      fetchJson,
      project,
      scope,
      owner,
    );
    if (!questions.some((request) => stringField(request, 'id') === requestId)) {
      throw resourceNotFound();
    }
  }

  const ptyId = parameters.ptyID;
  if (ptyId) {
    const ptys = await projectPtys(
      fetchJson,
      project,
      scope,
      owner,
    );
    if (!ptys.some((pty) => stringField(pty, 'id') === ptyId)) {
      throw resourceNotFound();
    }
  }
}

function projectRelativePath(
  value: string,
  project: MobileProjectScope,
): string | null {
  if (value.includes('\0')) return null;
  if (!isAbsolute(value)) {
    const candidate = resolve(project.root, value);
    if (!mobilePathBelongsToProject(candidate, project)) return null;
    return value.replace(/\\/g, '/');
  }
  if (!mobilePathBelongsToProject(value, project)) return null;
  return relative(project.root, resolve(value)).replace(/\\/g, '/') || '.';
}

function sanitizeUrl(value: string, project: MobileProjectScope): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return REDACTED_PATH;
  }
  if (parsed.protocol === 'file:') {
    try {
      const relativePath = projectRelativePath(fileURLToPath(parsed), project);
      return relativePath === null
        ? REDACTED_PATH
        : `rhythm-project://${encodeURIComponent(project.id)}/${relativePath
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`;
    } catch {
      return REDACTED_PATH;
    }
  }
  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (isSecretField(key)) parsed.searchParams.set(key, REDACTED_SECRET);
  }
  return parsed.toString();
}

function sanitizePathMetadata(
  value: unknown,
  project: MobileProjectScope,
  field: string,
): unknown {
  const wrapped = isRecord(value) && typeof value.text === 'string';
  const rawValue = typeof value === 'string'
    ? value
    : wrapped
      ? value.text as string
      : null;
  if (rawValue === null) return REDACTED_PATH;
  const normalized = normalizedField(field);
  const safeValue =
    normalized === 'uri' && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawValue)
      ? sanitizeUrl(rawValue, project)
      : projectRelativePath(rawValue, project) ?? REDACTED_PATH;
  if (wrapped) {
    return { text: safeValue };
  }
  return safeValue;
}

function scrubDiagnosticText(
  value: string,
  project: MobileProjectScope,
): string {
  let safe = value.split(project.root).join('.');
  safe = safe.replace(
    /file:\/\/\/[^\s"'`()[\]{}<>]+/g,
    (candidate) => sanitizeUrl(candidate, project),
  );
  safe = safe.replace(
    /(^|[\s"'(=:])((?:\/(?!\/)[A-Za-z0-9._~@%+-]+){2,}(?::\d+(?::\d+)?)?)/gm,
    (match, prefix: string, candidate: string) =>
      candidate === '/dev/null'
        ? match
        : `${prefix}${REDACTED_PATH}`,
  );
  safe = safe.replace(
    /(^|[\s"'(=])([A-Za-z]:\\(?:[^\\\s"'()[\]{}<>]+\\?){2,})/gm,
    `$1${REDACTED_PATH}`,
  );
  safe = safe.replace(
    /\bBearer\s+[A-Za-z0-9._~+/-]+/gi,
    `Bearer ${REDACTED_SECRET}`,
  );
  safe = safe.replace(
    /\b(api[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|password|private[-_ ]?key|refresh[-_ ]?token|secret|credential)\s*([:=])\s*([^\s,;]+)/gi,
    (_match, label: string, separator: string) =>
      `${label}${separator}${REDACTED_SECRET}`,
  );
  return safe;
}

function scrubMobileValue(
  value: unknown,
  project: MobileProjectScope,
  field = '',
  depth = 0,
  redactPlainKey = false,
): unknown | typeof OMIT {
  if (depth > 32) return OMIT;
  const normalized = normalizedField(field);
  if (OMITTED_HOST_FIELDS.has(normalized)) return OMIT;
  if (SECRET_CONTAINER_FIELDS.has(normalized)) return OMIT;
  if (
    isSecretField(field) ||
    (redactPlainKey && normalized === 'key')
  ) {
    return REDACTED_SECRET;
  }
  if (PSEUDONYMOUS_SCOPE_FIELDS.has(normalized)) return project.id;
  if (isPathField(field)) return sanitizePathMetadata(value, project, field);

  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        scrubMobileValue(
          entry,
          project,
          '',
          depth + 1,
          redactPlainKey,
        )
      )
      .filter((entry) => entry !== OMIT);
  }
  if (isRecord(value)) {
    const safe: JsonRecord = {};
    for (const [childField, child] of Object.entries(value)) {
      const scrubbed = scrubMobileValue(
        child,
        project,
        childField,
        depth + 1,
        redactPlainKey,
      );
      if (scrubbed !== OMIT) safe[childField] = scrubbed;
    }
    return safe;
  }
  if (typeof value === 'string') {
    if (
      CONTENT_FIELDS.has(normalized) ||
      DIAGNOSTIC_FIELDS.has(normalized) ||
      value.includes(project.root)
    ) {
      return scrubDiagnosticText(value, project);
    }
  }
  return value;
}

function safeProjectView(
  value: unknown,
  project: MobileProjectScope,
): JsonRecord {
  const source = isRecord(value) ? value : {};
  const safe: JsonRecord = {
    id: project.id,
    directory: project.id,
  };
  for (const field of ['name', 'icon', 'time', 'vcs']) {
    if (!(field in source)) continue;
    const scrubbed = scrubMobileValue(source[field], project, field);
    if (scrubbed !== OMIT) safe[field] = scrubbed;
  }
  return safe;
}

function safeWorktreeValue(
  value: unknown,
  project: MobileProjectScope,
  authoritative: string[],
): unknown {
  if (typeof value === 'string') {
    const matched = authoritative.find((directory) =>
      resolve(directory) === resolve(value)
    );
    return matched ? worktreeReference(project, matched) : REDACTED_PATH;
  }
  if (!isRecord(value)) return null;
  const directory = stringField(value, 'directory');
  const matched = directory && authoritative.find((candidate) =>
    resolve(candidate) === resolve(directory)
  );
  if (!matched) return null;
  const scrubbed = scrubMobileValue(value, project);
  if (!isRecord(scrubbed)) return null;
  return {
    ...scrubbed,
    directory: worktreeReference(project, matched),
  };
}

function safeUnscopedChatSessionView(
  value: unknown,
  project: MobileProjectScope,
): unknown {
  const scrubbed = scrubMobileValue(value, project);
  if (!isRecord(scrubbed)) return null;
  const {
    directory: _directory,
    project: _project,
    projectID: _projectID,
    projectId: _projectId,
    ...safe
  } = scrubbed;
  return {
    ...safe,
    projectId: null,
  };
}

function messageBelongsToSession(value: unknown, sessionId: string): boolean {
  if (!isRecord(value)) return false;
  const info = isRecord(value.info) ? value.info : {};
  return stringField(info, 'sessionID') === sessionId ||
    stringField(info, 'sessionId') === sessionId;
}

/**
 * Adapt successful OpenCode JSON into a phone-safe, project-pseudonymous
 * representation. Filtering is operation-aware so required non-sensitive
 * protocol fields remain intact instead of applying a destructive blanket
 * string replacement.
 */
export async function shapeMobileOpenCodeResponse(
  operation: MobileOpenCodeOperation,
  value: unknown,
  project: MobileProjectScope,
  fetchJson: MobileOpenCodeJsonFetcher,
  requestPath?: string,
  owner?: MobileOpenCodeOwnerScope,
  ownerUnscopedDiscovery = false,
  sharedScope?: ResourceScope,
): Promise<unknown> {
  if (!owner) throw resourceNotFound();
  // Reuse the authorization pass's scope when the caller threads one through,
  // so a single request resolves each upstream collection at most once.
  const scope: ResourceScope = sharedScope ?? {};
  let scopedValue = value;
  switch (operation.operationId) {
    case 'path.get':
      scopedValue = { directory: project.id };
      break;
    case 'project.current':
      scopedValue = safeProjectView(value, project);
      break;
    case 'project.list':
      scopedValue = asArray(value)
        .filter((candidate) => {
          const path =
            stringField(candidate, 'worktree') ??
            stringField(candidate, 'directory');
          return mobilePathBelongsToProject(path, project);
        })
        .slice(0, 1)
        .map((candidate) => safeProjectView(candidate, project));
      break;
    case 'session.list':
      scopedValue = asArray(value)
        .filter((session) =>
          sessionBelongsToProject(session, project) &&
          sessionVisibleInChatCatalog(
            stringField(session, 'id'),
            project.id,
            project,
            owner,
          ));
      break;
    case 'experimental.session.list':
      scopedValue = ownerUnscopedDiscovery
        ? asArray(value)
          .filter((session) =>
            sessionVisibleInChatCatalog(
              stringField(session, 'id'),
              null,
              project,
              owner,
            ))
          .map((session) => safeUnscopedChatSessionView(session, project))
          .filter((session) => session !== null)
        : asArray(value)
          .filter((session) =>
            sessionBelongsToProject(session, project) &&
            sessionVisibleInChatCatalog(
              stringField(session, 'id'),
              project.id,
              project,
              owner,
            ));
      break;
    case 'session.children':
      scopedValue = asArray(value)
        .filter((session) =>
          sessionBelongsToProject(session, project) &&
          resourceOwnedByCaller(
            'session',
            stringField(session, 'id'),
            project,
            owner,
          ));
      break;
    case 'session.messages': {
      const parameters = requestPath
        ? templateParameters(operation, requestPath)
        : {};
      const sessionId = parameters.sessionID;
      scopedValue = sessionId
        ? asArray(value)
          .filter((message) => messageBelongsToSession(message, sessionId))
        : [];
      break;
    }
    case 'session.status': {
      const sessionIds = await projectSessionIds(
        fetchJson,
        project,
        scope,
        owner,
      );
      scopedValue = isRecord(value)
        ? Object.fromEntries(
          Object.entries(value)
            .filter(([id]) => sessionIds.has(id)),
        )
        : {};
      break;
    }
    case 'permission.list':
      scopedValue = await projectPermissions(
        fetchJson,
        project,
        scope,
        owner,
      );
      break;
    case 'question.list':
      scopedValue = await projectQuestions(
        fetchJson,
        project,
        scope,
        owner,
      );
      break;
    case 'pty.list':
      scopedValue = asArray(value)
        .filter((pty) =>
          ptyBelongsToProject(pty, project) &&
          resourceOwnedByCaller(
            'pty',
            stringField(pty, 'id'),
            project,
            owner,
          ));
      break;
    case 'worktree.list': {
      const authoritative = await projectWorktrees(fetchJson, scope);
      scopedValue = authoritative.map((directory) =>
        worktreeReference(project, directory)
      );
      break;
    }
    case 'worktree.create': {
      const authoritative = await projectWorktrees(fetchJson, scope);
      scopedValue = safeWorktreeValue(value, project, authoritative);
      if (scopedValue === null) {
        throw new AppError(
          502,
          'OPENCODE_SCOPE_CHECK_FAILED',
          'OpenCode returned an unverified worktree',
        );
      }
      break;
    }
    default:
      break;
  }
  const scrubbed = scrubMobileValue(
    scopedValue,
    project,
    '',
    0,
    PLAIN_KEY_SECRET_OPERATIONS.has(operation.operationId),
  );
  if (
    operation.operationId === 'worktree.create' &&
    isRecord(scopedValue) &&
    typeof scopedValue.directory === 'string' &&
    isRecord(scrubbed)
  ) {
    return {
      ...scrubbed,
      directory: scopedValue.directory,
    };
  }
  return scrubbed === OMIT ? null : scrubbed;
}

export function shapeMobileOpenCodeTextResponse(
  operation: MobileOpenCodeOperation,
  value: string,
  project: MobileProjectScope,
): string {
  if (operation.operationId !== 'vcs.diff.raw') {
    throw new AppError(
      502,
      'OPENCODE_UNSUPPORTED_RESPONSE',
      'OpenCode returned an unsupported mobile response',
    );
  }
  return scrubDiagnosticText(value, project);
}

export async function mobileSessionBelongsToProject(
  sessionId: string,
  project: MobileProjectScope,
  fetchJson: MobileOpenCodeJsonFetcher,
  owner?: MobileOpenCodeOwnerScope,
  sharedScope?: ResourceScope,
): Promise<boolean> {
  if (!owner) return false;
  return sessionAuthorizedForCaller(
    sessionId,
    project,
    fetchJson,
    sharedScope ?? {},
    owner,
  );
}

function mobileSseType(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const payload = isRecord(value.payload) ? value.payload : value;
  return typeof payload.type === 'string' ? payload.type : null;
}

function collectSseResourceEvidence(
  value: unknown,
  paths: string[],
  sessionIds: Set<string>,
  resourceIds: Set<string>,
  depth = 0,
): void {
  if (depth > 8 || !isRecord(value)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        collectSseResourceEvidence(
          child,
          paths,
          sessionIds,
          resourceIds,
          depth + 1,
        );
      }
    }
    return;
  }
  for (const [field, child] of Object.entries(value)) {
    const normalized = normalizedField(field);
    if (
      typeof child === 'string' &&
      (
        normalized === 'cwd' ||
        normalized === 'directory' ||
        normalized === 'root' ||
        normalized === 'worktree' ||
        normalized === 'worktreedir'
      )
    ) {
      paths.push(child);
    }
    if (
      typeof child === 'string' &&
      (field === 'sessionID' || field === 'sessionId')
    ) {
      sessionIds.add(child);
    }
    if (
      typeof child === 'string' &&
      (
        normalized === 'messageid' ||
        normalized === 'partid' ||
        normalized === 'permissionid' ||
        normalized === 'ptyid' ||
        normalized === 'questionid' ||
        normalized === 'requestid'
      )
    ) {
      resourceIds.add(child);
    }
    collectSseResourceEvidence(
      child,
      paths,
      sessionIds,
      resourceIds,
      depth + 1,
    );
  }
}

/**
 * Require every delivered event to carry authoritative selected-project path
 * evidence and internally consistent resource ownership. Global OpenCode
 * events are directory-wrapped; events without that wrapper fail closed.
 */
export function mobileSseEventBelongsToProject(
  value: unknown,
  project: MobileProjectScope,
  expectedSessionId?: string,
): boolean {
  const type = mobileSseType(value);
  if (type === 'server.connected' || type === 'server.heartbeat') return true;
  if (!isRecord(value) || !mobilePathBelongsToProject(value.directory, project)) {
    return false;
  }
  const paths: string[] = [];
  const sessionIds = new Set<string>();
  const resourceIds = new Set<string>();
  collectSseResourceEvidence(value, paths, sessionIds, resourceIds);
  if (paths.some((path) => !mobilePathBelongsToProject(path, project))) {
    return false;
  }
  const payload = isRecord(value.payload) ? value.payload : value;
  const properties = isRecord(payload.properties)
    ? payload.properties
    : {};
  const info = isRecord(properties.info) ? properties.info : {};
  if (
    type?.startsWith('session.') &&
    typeof info.id === 'string'
  ) {
    sessionIds.add(info.id);
  }
  if (
    expectedSessionId &&
    (
      sessionIds.size === 0 ||
      [...sessionIds].some((id) => id !== expectedSessionId)
    )
  ) {
    return false;
  }
  if (
    type &&
    /^(message|part|permission|question)\./.test(type) &&
    sessionIds.size === 0
  ) {
    return false;
  }
  if (
    type?.startsWith('pty.') &&
    resourceIds.size === 0 &&
    typeof info.id !== 'string'
  ) {
    return false;
  }
  return true;
}

function collectOwnedSseIds(
  value: unknown,
  sessionIds: Set<string>,
  ptyIds: Set<string>,
  depth = 0,
): void {
  if (depth > 8 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const child of value) {
      collectOwnedSseIds(child, sessionIds, ptyIds, depth + 1);
    }
    return;
  }
  for (const [field, child] of Object.entries(value)) {
    if (
      typeof child === 'string' &&
      (field === 'sessionID' || field === 'sessionId')
    ) {
      sessionIds.add(child);
    }
    if (
      typeof child === 'string' &&
      (field === 'ptyID' || field === 'ptyId')
    ) {
      ptyIds.add(child);
    }
    collectOwnedSseIds(child, sessionIds, ptyIds, depth + 1);
  }
}

function mobileSseEventBelongsToOwnedSessionDirectory(
  value: unknown,
  project: MobileProjectScope,
  owner: MobileOpenCodeOwnerScope,
  sessionIds: Set<string>,
): boolean {
  if (!isRecord(value) || sessionIds.size === 0) return false;
  const eventDirectory = value.directory;
  if (
    typeof eventDirectory !== 'string' ||
    eventDirectory.includes('\0')
  ) {
    return false;
  }
  const resolveDirectory =
    owner.ownership.resolveSessionDirectoryForOwner;
  if (!resolveDirectory) return false;

  const authorizedDirectories = [...sessionIds].map((sessionId) =>
    resolveDirectory.call(
      owner.ownership,
      sessionId,
      owner.ownerUserId,
      project.id,
    )
  );
  if (authorizedDirectories.some((directory) => !directory)) return false;
  let normalizedEventDirectory: string;
  try {
    normalizedEventDirectory = canonicalize(eventDirectory);
  } catch {
    return false;
  }
  if (authorizedDirectories.some((directory) => {
    try {
      return canonicalize(directory!) !== normalizedEventDirectory;
    } catch {
      return true;
    }
  })) {
    return false;
  }

  const paths: string[] = [];
  const nestedSessionIds = new Set<string>();
  const resourceIds = new Set<string>();
  collectSseResourceEvidence(
    value,
    paths,
    nestedSessionIds,
    resourceIds,
  );
  const sessionScope = {
    id: project.id,
    root: normalizedEventDirectory,
  };
  return paths.every((path) =>
    mobilePathBelongsToProject(path, sessionScope)
  );
}

export function mobileSseEventBelongsToOwner(
  value: unknown,
  project: MobileProjectScope,
  owner: MobileOpenCodeOwnerScope,
  expectedSessionId?: string,
): boolean {
  const type = mobileSseType(value);
  if (type === 'server.connected' || type === 'server.heartbeat') return true;

  const sessionIds = new Set<string>();
  const ptyIds = new Set<string>();
  collectOwnedSseIds(value, sessionIds, ptyIds);
  const payload = isRecord(value) && isRecord(value.payload)
    ? value.payload
    : value;
  const properties = isRecord(payload) && isRecord(payload.properties)
    ? payload.properties
    : {};
  const info = isRecord(properties.info) ? properties.info : {};
  if (type?.startsWith('session.') && typeof info.id === 'string') {
    sessionIds.add(info.id);
  }
  if (type?.startsWith('pty.') && typeof info.id === 'string') {
    ptyIds.add(info.id);
  }
  if (
    !mobileSseEventBelongsToProject(
      value,
      project,
      expectedSessionId,
    ) &&
    !mobileSseEventBelongsToOwnedSessionDirectory(
      value,
      project,
      owner,
      sessionIds,
    )
  ) {
    return false;
  }
  if (
    expectedSessionId &&
    (
      sessionIds.size === 0 ||
      [...sessionIds].some((id) => id !== expectedSessionId)
    )
  ) {
    return false;
  }
  if (
    sessionIds.size > 0 &&
    [...sessionIds].some((id) =>
      !resourceOwnedByCaller('session', id, project, owner))
  ) {
    return false;
  }
  if (
    ptyIds.size > 0 &&
    [...ptyIds].some((id) =>
      !resourceOwnedByCaller('pty', id, project, owner))
  ) {
    return false;
  }
  if (
    type &&
    /^(session|message|part|permission|question)\./.test(type) &&
    sessionIds.size === 0
  ) {
    return false;
  }
  if (type?.startsWith('pty.') && ptyIds.size === 0) return false;
  return true;
}

export function shapeMobileSseEvent(
  value: unknown,
  project: MobileProjectScope,
): unknown {
  const scrubbed = scrubMobileValue(value, project, '', 0, true);
  return scrubbed === OMIT ? null : scrubbed;
}
