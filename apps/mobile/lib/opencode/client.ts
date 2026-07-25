import {
  createOpencodeClient,
  type OpencodeClient,
  type PermissionRequest,
  type QuestionAnswer,
  type QuestionRequest,
} from '@opencode-ai/sdk/v2/client';
import { encode as encodeBase64 } from 'base-64';
import Constants from 'expo-constants';

import type { PairedMacClient } from '@/lib/transport/paired-mac-client';

export type PendingPermissionRequest = PermissionRequest;
export type PendingQuestionRequest = QuestionRequest;
export type PendingQuestionAnswer = QuestionAnswer;

export type OpencodeConnectionSettings = {
  serverUrl: string;
  username: string;
  password: string;
  directory: string;
};

export const defaultConnectionSettings: OpencodeConnectionSettings = {
  serverUrl: String(process.env.EXPO_PUBLIC_E2E_SERVER_URL || Constants.expoConfig?.extra?.e2eServerUrl || 'http://127.0.0.1:4096'),
  username: '',
  password: '',
  directory: '',
};

type NormalizedServerUrl = {
  displayUrl: string;
  origin: string;
  pathPrefix: string;
  valid: boolean;
};

type ClientMetadata = {
  directory?: string;
  gateway: boolean;
};

export type ScopedOpencodeClient = OpencodeClient & {
  __opencode: ClientMetadata;
};

function joinUrlPath(prefix: string, pathname: string) {
  const normalizedPrefix = prefix === '/' ? '' : prefix.replace(/\/$/, '');
  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalizedPrefix}${normalizedPathname}`;
}

function normalizeServerUrl(value: string): NormalizedServerUrl {
  const trimmed = value.trim();
  if (!trimmed) {
    return normalizeServerUrl(defaultConnectionSettings.serverUrl);
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    const pathPrefix = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    const displayUrl = `${parsed.origin}${pathPrefix}`;

    return {
      displayUrl,
      origin: parsed.origin,
      pathPrefix,
      valid: Boolean(parsed.hostname),
    };
  } catch {
    return {
      displayUrl: trimmed,
      origin: new URL(defaultConnectionSettings.serverUrl).origin,
      pathPrefix: '',
      valid: false,
    };
  }
}

function createScopedFetch(baseUrl: string, pathPrefix: string, directory?: string) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const currentUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsed = new URL(currentUrl, baseUrl);

    if (parsed.origin === baseUrl && pathPrefix && !parsed.pathname.startsWith(`${pathPrefix}/`) && parsed.pathname !== pathPrefix) {
      parsed.pathname = joinUrlPath(pathPrefix, parsed.pathname);
    }
    if (parsed.origin === baseUrl && directory && !parsed.searchParams.has('directory')) {
      parsed.searchParams.set('directory', directory);
    }

    if (typeof input === 'string' || input instanceof URL) {
      return fetch(parsed.toString(), init);
    }

    return fetch(parsed.toString(), {
      body: input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.text(),
      credentials: input.credentials,
      headers: input.headers,
      method: input.method,
      signal: input.signal,
    });
  };
}

const GATEWAY_ROOT_QUERY_FIELDS = new Set([
  'cwd',
  'directory',
  'root',
  'workspace',
  'workspaceid',
  'worktreedir',
]);

export interface MobileGatewayClientScope {
  client: PairedMacClient;
  projectId: string;
}

function headersRecord(value?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value) return result;
  new Headers(value).forEach((headerValue, name) => {
    result[name] = headerValue;
  });
  return result;
}

function createMobileGatewayFetch(scope: MobileGatewayClientScope) {
  const baseUrl = new URL(scope.client.origin()).origin;
  const projectId = scope.projectId.trim();

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!projectId) {
      throw new Error('Select a registered Rhythm project before connecting.');
    }
    const request =
      typeof Request !== 'undefined' && input instanceof Request
        ? input
        : null;
    const currentUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsed = new URL(currentUrl, baseUrl);
    if (parsed.origin !== baseUrl) {
      throw new Error('The paired gateway refused a cross-origin request.');
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (GATEWAY_ROOT_QUERY_FIELDS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }

    const sdkPath = parsed.pathname;
    const gatewayPath =
      sdkPath === '/event' || sdkPath === '/global/event'
        ? '/mobile-gateway/events'
        : `/mobile-gateway/opencode${sdkPath}`;
    const headers: Record<string, string> = {
      ...headersRecord(request?.headers),
      ...headersRecord(init?.headers),
      'X-Rhythm-Project-ID': projectId,
    };
    delete headers.authorization;

    const method = init?.method ?? request?.method ?? 'GET';
    let body = init?.body;
    if (
      body === undefined &&
      request &&
      method !== 'GET' &&
      method !== 'HEAD'
    ) {
      body = await request.clone().text();
    }

    return scope.client.fetchResponse(
      `${gatewayPath}${parsed.search}`,
      {
        ...init,
        body,
        headers,
        method,
        signal: init?.signal ?? request?.signal,
      },
    );
  };
}

function getConnectionErrorMessage(error: unknown, serverUrl: string) {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized.valid) {
    return 'Enter a complete server URL, such as http://192.168.1.10:4096.';
  }

  if (!(error instanceof Error)) {
    return 'Something went wrong while talking to OpenCode.';
  }

  const normalizedUrl = normalized.displayUrl;
  const message = error.message || 'Something went wrong while talking to OpenCode.';

  if (/404|not found/i.test(message)) {
    return `OpenCode endpoint not found at ${normalizedUrl}. If this address serves a web UI, use the API base URL instead, usually ${normalizedUrl}/api.`;
  }

  if (/json/i.test(message) && /unexpected|parse|token/i.test(message)) {
    return `The server at ${normalizedUrl} did not return an OpenCode API response. If this address serves a web UI, use the API base URL instead, usually ${normalizedUrl}/api.`;
  }

  return message;
}

function createAuthHeader(settings: OpencodeConnectionSettings) {
  const password = settings.password.trim();
  if (!password) {
    return undefined;
  }

  const username = settings.username.trim() || 'opencode';
  return `Basic ${encodeBase64(`${username}:${password}`)}`;
}

function getRequestHeaders(settings: OpencodeConnectionSettings) {
  const authHeader = createAuthHeader(settings);
  return authHeader
    ? {
        Authorization: authHeader,
      }
    : undefined;
}

export function buildClient(
  settings: OpencodeConnectionSettings,
  gateway?: MobileGatewayClientScope,
): ScopedOpencodeClient {
  const normalizedServerUrl = normalizeServerUrl(settings.serverUrl);
  const headers = gateway ? undefined : getRequestHeaders(settings);
  const directory = gateway
    ? gateway.projectId.trim() || undefined
    : settings.directory.trim() || undefined;
  const baseUrl = gateway
    ? new URL(gateway.client.origin()).origin
    : normalizedServerUrl.origin;

  return Object.assign(
    createOpencodeClient({
      baseUrl,
      fetch: gateway
        ? createMobileGatewayFetch(gateway)
        : createScopedFetch(
            normalizedServerUrl.origin,
            normalizedServerUrl.pathPrefix,
            directory,
          ),
      headers,
      responseStyle: 'fields',
      throwOnError: true,
    }),
    { __opencode: { directory, gateway: Boolean(gateway) } },
  );
}

export async function requestOpenCodeRoute<T>(
  settings: OpencodeConnectionSettings,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const server = normalizeServerUrl(settings.serverUrl);
  if (!server.valid) {
    throw new Error('Cannot call OpenCode with an invalid server URL.');
  }
  const request = createScopedFetch(
    server.origin,
    server.pathPrefix,
    settings.directory.trim() || undefined,
  );
  const response = await request(`${server.origin}${path}`, {
    ...init,
    headers: {
      ...getRequestHeaders(settings),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(`OpenCode request failed (${response.status})${detail ? `: ${detail}` : '.'}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function buildPtyWebSocketUrl(
  settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'directory'>,
  ptyId: string,
  options?: { ticket?: string; cursor?: string },
) {
  const server = normalizeServerUrl(settings.serverUrl);
  if (!server.valid) {
    throw new Error('Cannot build a terminal URL from an invalid server URL.');
  }

  const url = new URL(server.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = joinUrlPath(server.pathPrefix, `/pty/${encodeURIComponent(ptyId)}/connect`);
  const directory = settings.directory.trim();
  if (directory) url.searchParams.set('directory', directory);
  if (options?.ticket) url.searchParams.set('ticket', options.ticket);
  if (options?.cursor) url.searchParams.set('cursor', options.cursor);
  return url.toString();
}

export function getNormalizedServerUrl(serverUrl: string) {
  return normalizeServerUrl(serverUrl).displayUrl;
}

export function isValidServerUrl(serverUrl: string) {
  return normalizeServerUrl(serverUrl).valid;
}

export function getConnectionError(serverUrl: string, error: unknown) {
  return getConnectionErrorMessage(error, serverUrl);
}

export async function listPendingInteractions(client: ScopedOpencodeClient) {
  const [permissionResponse, questionResponse] = await Promise.all([
    client.permission.list(),
    client.question.list(),
  ]);

  if (!permissionResponse.data || !questionResponse.data) {
    throw new Error('OpenCode did not return pending interactions.');
  }

  return { permissions: permissionResponse.data, questions: questionResponse.data };
}

export async function replyToPendingPermission(
  client: ScopedOpencodeClient,
  requestID: string,
  reply: 'once' | 'always' | 'reject',
) {
  await client.permission.reply({ requestID, reply });
}

export async function replyToPendingQuestion(client: ScopedOpencodeClient, requestID: string, answers: PendingQuestionAnswer[]) {
  await client.question.reply({ requestID, answers });
}

export async function rejectPendingQuestion(client: ScopedOpencodeClient, requestID: string) {
  await client.question.reject({ requestID });
}
