/**
 * MCP remote-OAuth workaround — self-contained Authorization-Code + PKCE flow.
 *
 * Spec: docs/superpowers/specs/2026-06-17-mcp-remote-oauth-workaround.md
 *
 * opencode's SDK MCP auth path (`client.mcp.auth.start`) generates an
 * authorization URL + loopback callback server but NEVER registers the OAuth
 * `state` in its callback validator's pending set — every remote-OAuth
 * callback therefore fails with "Invalid or expired state". The documented
 * workaround (anomalyco/opencode#17822) is to perform the OAuth ourselves and
 * write the resulting tokens into opencode's `mcp-auth.json`, then reconnect
 * via the RAW `client.mcp.connect` (NOT opencode's auth.start-first path).
 *
 * This service:
 *   1. discover(serverUrl) — 401 → protected-resource-metadata → AS metadata.
 *   2. ensureClient(...)   — reuse a cached DCR client only when its redirectUri
 *                            marker matches; else POST registration_endpoint.
 *   3. start(name, url)    — discover + ensureClient + PKCE + state, bind a
 *                            shared loopback callback server, return authorize URL.
 *   4. callback handler    — match state → token exchange (code_verifier) →
 *                            write mcp-auth.json (exact schema) → reconnect.
 *   5. status(name)        — 'pending' | 'connected' | 'failed:<msg>'.
 *
 * Everything network/disk/reconnect is injectable so tests substitute a fake
 * OAuth provider + temp auth file + reconnect spy.
 */

import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'http';
import type { AddressInfo } from 'net';
import { randomBytes, createHash } from 'crypto';
import { logger } from '../utils/logger';
import { AppError } from '../errors/app_error';
import { McpAuthStore, defaultMcpAuthFilePath, type McpAuthClientInfo } from './mcp_auth_store';

/** Minimal fetch shape so tests can inject without DOM lib types. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: 'manual' | 'follow';
  },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** Resolved OAuth endpoints + scopes from discovery. */
export interface DiscoveredMeta {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  scopes: string[];
  /** RFC 8707 resource indicator — the configured MCP server URL. */
  resource: string;
}

type Status = 'pending' | 'connected' | string; // 'failed:<msg>'

interface Pending {
  state: string;
  codeVerifier: string;
  meta: DiscoveredMeta;
  clientInfo: McpAuthClientInfo;
  serverUrl: string;
  redirectUri: string;
}

const CALLBACK_PATH = '/mcp/oauth/callback';

export interface McpOAuthServiceDeps {
  /** Path to opencode's mcp-auth.json (default ~/.local/share/opencode/...). */
  authFilePath?: string;
  /** Raw `client.mcp.connect` reconnect (NOT auth.start-first). Returns connected. */
  reconnect: (name: string) => Promise<boolean>;
  /** Injected fetch (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /**
   * Loopback callback port. Default 53682 (override via MCP_OAUTH_CALLBACK_PORT).
   * Pass 0 in tests for an ephemeral port.
   */
  callbackPort?: number;
}

export class McpOAuthService {
  private readonly store: McpAuthStore;
  private readonly reconnect: (name: string) => Promise<boolean>;
  private readonly fetchImpl: FetchLike;
  private readonly configuredPort: number;

  private callbackServer: Server | null = null;
  private boundPort: number | null = null;
  private startingServer: Promise<void> | null = null;

  /** Pending OAuth flows keyed by server name. */
  private readonly pending = new Map<string, Pending>();
  /** Status keyed by server name. */
  private readonly statuses = new Map<string, Status>();

  constructor(deps: McpOAuthServiceDeps) {
    this.store = new McpAuthStore(deps.authFilePath);
    this.reconnect = deps.reconnect;
    this.fetchImpl = deps.fetchImpl ?? ((globalThis as any).fetch as FetchLike);
    this.configuredPort =
      deps.callbackPort ??
      (process.env.MCP_OAUTH_CALLBACK_PORT
        ? Number(process.env.MCP_OAUTH_CALLBACK_PORT)
        : 53682);
  }

  // ── public API ──────────────────────────────────────────────────────────

  /**
   * OAuth discovery: 401 on serverUrl → resource-metadata → AS metadata.
   * Returns the endpoints + scopes + resource indicator.
   */
  async discover(serverUrl: string): Promise<DiscoveredMeta> {
    // 1. GET serverUrl → expect 401 with WWW-Authenticate resource_metadata.
    let resourceMetadataUrl: string | undefined;
    try {
      const res = await this.fetchImpl(serverUrl, { method: 'GET' });
      if (res.status === 401) {
        const header = res.headers.get('www-authenticate');
        resourceMetadataUrl = header
          ? parseResourceMetadata(header)
          : undefined;
      }
    } catch {
      // network probe failure → fall back to the well-known derivation below.
    }
    if (!resourceMetadataUrl) {
      const origin = new URL(serverUrl).origin;
      resourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource`;
    }

    // 2. GET protected-resource-metadata → authorization_servers + scopes.
    const prm = await this.getJson(
      resourceMetadataUrl,
      `protected-resource-metadata (${resourceMetadataUrl})`,
    );
    const authServers = prm.authorization_servers;
    if (!Array.isArray(authServers) || authServers.length === 0) {
      throw new AppError(
        502,
        'MCP_OAUTH_DISCOVERY',
        `No authorization_servers in protected-resource metadata for ${serverUrl}`,
      );
    }
    const as = String(authServers[0]).replace(/\/$/, '');
    const prmScopes = Array.isArray(prm.scopes_supported)
      ? (prm.scopes_supported as unknown[]).map(String)
      : [];

    // 3. GET <as>/.well-known/oauth-authorization-server → endpoints.
    const asMetaUrl = `${as}/.well-known/oauth-authorization-server`;
    const asMeta = await this.getJson(asMetaUrl, `authorization-server metadata (${asMetaUrl})`);
    const authorizationEndpoint = String(asMeta.authorization_endpoint ?? '');
    const tokenEndpoint = String(asMeta.token_endpoint ?? '');
    const registrationEndpoint = String(asMeta.registration_endpoint ?? '');
    if (!authorizationEndpoint || !tokenEndpoint || !registrationEndpoint) {
      throw new AppError(
        502,
        'MCP_OAUTH_DISCOVERY',
        `Incomplete authorization-server metadata at ${asMetaUrl}`,
      );
    }
    const asScopes = Array.isArray(asMeta.scopes_supported)
      ? (asMeta.scopes_supported as unknown[]).map(String)
      : [];

    return {
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint,
      scopes: prmScopes.length > 0 ? prmScopes : asScopes,
      resource: serverUrl,
    };
  }

  /**
   * Reuse a cached `clientInfo` from mcp-auth.json ONLY when it was registered
   * by us with the same `redirectUri` marker; otherwise Dynamic Client
   * Registration against the registration endpoint.
   */
  async ensureClient(
    name: string,
    serverUrl: string,
    meta: DiscoveredMeta,
    redirectUri: string,
  ): Promise<McpAuthClientInfo> {
    const existing = this.store.get(name);
    if (
      existing?.clientInfo?.clientId &&
      existing.serverUrl === serverUrl &&
      existing.redirectUri === redirectUri
    ) {
      return existing.clientInfo;
    }

    const body = {
      client_name: 'Rhythm',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: meta.scopes.join(' '),
    };
    const res = await this.fetchImpl(meta.registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
      const text = await safeText(res);
      throw new AppError(
        502,
        'MCP_OAUTH_REGISTER',
        `Dynamic client registration failed for ${name} (${res.status}): ${text}`,
      );
    }
    const json = (await res.json()) as Record<string, unknown>;
    const clientId = json.client_id;
    if (typeof clientId !== 'string' || clientId === '') {
      throw new AppError(
        502,
        'MCP_OAUTH_REGISTER',
        `Registration response for ${name} had no client_id`,
      );
    }
    const clientInfo: McpAuthClientInfo = { clientId };
    if (typeof json.client_secret === 'string') clientInfo.clientSecret = json.client_secret;
    if (typeof json.client_id_issued_at === 'number')
      clientInfo.clientIdIssuedAt = json.client_id_issued_at;
    if (typeof json.client_secret_expires_at === 'number')
      clientInfo.clientSecretExpiresAt = json.client_secret_expires_at;

    // Persist the freshly-registered client + redirectUri marker immediately so
    // a subsequent start() (e.g. user retries before completing consent) reuses
    // it instead of registering a brand-new client. Preserve any existing tokens
    // for this server (they belong to the prior clientId but the merge keeps the
    // file intact; the next successful callback overwrites them).
    const prior = existing;
    this.store.set(name, {
      clientInfo,
      serverUrl,
      redirectUri,
      ...(prior?.tokens ? { tokens: prior.tokens } : {}),
    });
    return clientInfo;
  }

  /**
   * Begin the OAuth flow for `name`/`serverUrl`: discover, ensure a client,
   * generate PKCE + state, lazily start the shared loopback callback server,
   * and return the authorization URL. Stores the pending flow keyed by name.
   */
  async start(name: string, serverUrl: string): Promise<{ authorizationUrl: string }> {
    await this.ensureCallbackServer();
    const redirectUri = this.callbackUrl();

    const meta = await this.discover(serverUrl);
    const clientInfo = await this.ensureClient(name, serverUrl, meta, redirectUri);

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = randomBytes(16).toString('hex');

    this.pending.set(name, {
      state,
      codeVerifier,
      meta,
      clientInfo,
      serverUrl,
      redirectUri,
    });
    this.statuses.set(name, 'pending');

    const authorize = new URL(meta.authorizationEndpoint);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', clientInfo.clientId);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', codeChallenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    if (meta.scopes.length > 0) {
      authorize.searchParams.set('scope', meta.scopes.join(' '));
    }
    authorize.searchParams.set('resource', meta.resource);

    return { authorizationUrl: authorize.toString() };
  }

  /** Current status for `name` ('pending' | 'connected' | 'failed:<msg>' | 'unknown'). */
  status(name: string): string {
    return this.statuses.get(name) ?? 'unknown';
  }

  /** The loopback callback URL the provider redirects back to. */
  callbackUrl(): string {
    const port = this.boundPort ?? this.configuredPort;
    return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  }

  /** Close the shared callback server (for shutdown / tests). */
  async shutdown(): Promise<void> {
    const server = this.callbackServer;
    this.callbackServer = null;
    this.boundPort = null;
    this.startingServer = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ── callback server ───────────────────────────────────────────────────────

  private async ensureCallbackServer(): Promise<void> {
    if (this.callbackServer) return;
    if (this.startingServer) return this.startingServer;
    this.startingServer = new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handleCallback(req, res).catch((err) => {
          logger.error('[McpOAuthService] callback handler threw:', err);
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(errorHtml('Authorization Failed', 'An unexpected error occurred.'));
        });
      });
      server.once('error', reject);
      server.listen(this.configuredPort, '127.0.0.1', () => {
        this.callbackServer = server;
        this.boundPort = (server.address() as AddressInfo).port;
        logger.info(`[McpOAuthService] callback server bound on :${this.boundPort}`);
        resolve();
      });
    });
    try {
      await this.startingServer;
    } finally {
      this.startingServer = null;
    }
  }

  private async handleCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.boundPort}`);
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404);
      res.end();
      return;
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    // Match the pending flow by state.
    let matchedName: string | undefined;
    for (const [name, p] of this.pending.entries()) {
      if (p.state === state) {
        matchedName = name;
        break;
      }
    }
    if (!matchedName || !code || !state) {
      logger.warn(
        `[McpOAuthService] callback with invalid state (pendingStates=${[...this.pending.values()]
          .map((p) => p.state)
          .join(',')})`,
      );
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(
        errorHtml(
          'Authorization Failed',
          'Invalid or expired state parameter. Please start the connection again.',
        ),
      );
      return;
    }

    const flow = this.pending.get(matchedName)!;
    try {
      const tokens = await this.exchangeCode(flow, code);
      const expiresAt =
        Math.floor(Date.now() / 1000) +
        (typeof tokens.expires_in === 'number' ? tokens.expires_in : 0);

      // Preserve/refresh clientInfo + serverUrl; write the exact schema.
      this.store.set(matchedName, {
        clientInfo: flow.clientInfo,
        serverUrl: flow.serverUrl,
        redirectUri: flow.redirectUri,
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? '',
          expiresAt,
          scope: tokens.scope ?? flow.meta.scopes.join(' '),
        },
      });

      // Reconnect via the RAW mcp.connect (NOT auth.start-first).
      await this.reconnect(matchedName);

      this.statuses.set(matchedName, 'connected');
      this.pending.delete(matchedName);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        successHtml(
          'Authorization Succeeded',
          'You may now close this window and return to Rhythm.',
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[McpOAuthService] token exchange/reconnect failed for ${matchedName}:`, err);
      this.statuses.set(matchedName, `failed:${msg}`);
      this.pending.delete(matchedName);
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end(errorHtml('Authorization Failed', escapeHtml(msg)));
    }
  }

  private async exchangeCode(
    flow: Pending,
    code: string,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: flow.redirectUri,
      client_id: flow.clientInfo.clientId,
      code_verifier: flow.codeVerifier,
      resource: flow.meta.resource,
    });
    if (flow.clientInfo.clientSecret) {
      // token_endpoint_auth_method: client_secret_post
      params.set('client_secret', flow.clientInfo.clientSecret);
    }
    const res = await this.fetchImpl(flow.meta.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });
    if (res.status < 200 || res.status >= 300) {
      const text = await safeText(res);
      throw new AppError(
        502,
        'MCP_OAUTH_TOKEN',
        `Token exchange failed (${res.status}): ${text}`,
      );
    }
    const json = (await res.json()) as Record<string, unknown>;
    if (typeof json.access_token !== 'string') {
      throw new AppError(502, 'MCP_OAUTH_TOKEN', 'Token response had no access_token');
    }
    return {
      access_token: json.access_token,
      refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      expires_in: typeof json.expires_in === 'number' ? json.expires_in : undefined,
      scope: typeof json.scope === 'string' ? json.scope : undefined,
    };
  }

  private async getJson(url: string, what: string): Promise<Record<string, unknown>> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      throw new AppError(
        502,
        'MCP_OAUTH_DISCOVERY',
        `Failed to fetch ${what}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new AppError(502, 'MCP_OAUTH_DISCOVERY', `Failed to fetch ${what} (${res.status})`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Parse a `WWW-Authenticate` header for the `resource_metadata="..."` URL. */
function parseResourceMetadata(header: string): string | undefined {
  const match = header.match(/resource_metadata="([^"]+)"/i);
  return match ? match[1] : undefined;
}

/** RFC 7636 code verifier: 43–128 char base64url, crypto random (32 bytes → 43). */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** S256 code challenge: base64url(SHA256(verifier)). */
function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pageHtml(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title></head><body style="font-family:system-ui;text-align:center;padding:3rem">
  <h1>${escapeHtml(title)}</h1><p>${message}</p></body></html>`;
}

function successHtml(title: string, message: string): string {
  return pageHtml(title, message);
}

function errorHtml(title: string, message: string): string {
  return pageHtml(title, message);
}

export { defaultMcpAuthFilePath };
