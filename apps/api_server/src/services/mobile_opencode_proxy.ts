import { Buffer } from 'node:buffer';
import { relative } from 'node:path';

import { AppError } from '../errors/app_error';
import { logger } from '../utils/logger';
import { OPENCODE_ENGINE_PORT } from './opencode_client_service';
import {
  resolveMobileProjectPath,
  type MobileProjectScope,
} from './mobile_project_scope';
import { MOBILE_OPENCODE_OPERATION_MANIFEST } from './mobile_opencode_operations.generated';

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

export const MOBILE_OPENCODE_REQUEST_BODY_LIMIT_BYTES = 512 * 1024;
export const MOBILE_OPENCODE_RESPONSE_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
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
}

export interface MobileOpenCodeForwardInput {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: unknown;
  project: MobileProjectScope;
  accept?: string;
}

export interface MobileOpenCodeProxyResponse {
  status: number;
  contentType?: string;
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

function scopedQuery(
  callerQuery: URLSearchParams,
  project: MobileProjectScope,
  operationId: string,
): URLSearchParams {
  const scoped = new URLSearchParams();
  for (const [field, value] of callerQuery.entries()) {
    const normalizedField = field.toLowerCase();
    if (ROOT_FIELDS.has(normalizedField)) continue;
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
  scoped.set('directory', project.root);
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

export class MobileOpenCodeProxy {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly requestBodyLimitBytes: number;
  private readonly responseBodyLimitBytes: number;
  private readonly timeoutMs: number;

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
  }

  async forward(
    input: MobileOpenCodeForwardInput,
  ): Promise<MobileOpenCodeProxyResponse> {
    const operation = matchMobileOpenCodeOperation(input.method, input.path);
    if (!operation?.allowed) throw operationNotAllowed();

    const query = scopedQuery(input.query, input.project, operation.operationId);
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
    const sanitizedBody = !acceptsBody || input.body === undefined
      ? undefined
      : stripRootFields(input.body);
    const encodedBody = sanitizedBody === undefined
      ? undefined
      : JSON.stringify(sanitizedBody);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
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
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? undefined,
        body: await readBoundedBody(response, this.responseBodyLimitBytes),
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
