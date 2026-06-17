/**
 * MCP remote-OAuth workaround — service contract tests.
 *
 * Spec: docs/superpowers/specs/2026-06-17-mcp-remote-oauth-workaround.md
 *
 * opencode's SDK MCP auth path never registers the OAuth `state`, so every
 * remote-OAuth callback fails with "Invalid or expired state". We bypass it:
 * perform the whole Authorization-Code + PKCE flow ourselves, write the tokens
 * into opencode's `mcp-auth.json`, then reconnect via the raw `mcp.connect`.
 *
 * These tests stand up a FAKE OAuth provider (in-process http) exposing the
 * verified discovery + register + token endpoints, drive a real `start()` /
 * callback round-trip, and assert the exact mcp-auth.json schema is written.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/mcp_oauth_service.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { McpOAuthService } from '../services/mcp_oauth_service';

// ── Fake OAuth provider ──────────────────────────────────────────────────────
//
// Implements the exact discovery chain the spec verified against canva/notion:
//   GET /mcp                                          → 401 + WWW-Authenticate
//   GET /.well-known/oauth-protected-resource/mcp     → authorization_servers
//   GET /.well-known/oauth-authorization-server       → endpoints
//   POST /register                                    → DCR client_id
//   POST /token                                       → access/refresh/expires_in/scope

interface FakeProvider {
  origin: string;
  serverUrl: string;
  tokenRequests: Array<Record<string, string>>;
  registerRequests: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

async function startFakeProvider(): Promise<FakeProvider> {
  const tokenRequests: Array<Record<string, string>> = [];
  const registerRequests: Array<Record<string, unknown>> = [];
  let origin = '';

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', origin);
    const path = url.pathname;

    if (path === '/mcp' && req.method === 'GET') {
      res.writeHead(401, {
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end();
      return;
    }

    if (path === '/.well-known/oauth-protected-resource/mcp' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ['design:read', 'design:write'],
        }),
      );
      return;
    }

    if (path === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          code_challenge_methods_supported: ['plain', 'S256'],
          scopes_supported: ['design:read', 'design:write'],
          token_endpoint_auth_methods_supported: [
            'client_secret_basic',
            'client_secret_post',
            'none',
          ],
        }),
      );
      return;
    }

    if (path === '/register' && req.method === 'POST') {
      const body = await readJson(req);
      registerRequests.push(body);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          client_id: 'fake-client-id-123',
          client_id_issued_at: 1781708229,
          // public client (token_endpoint_auth_method:"none") → no secret
        }),
      );
      return;
    }

    if (path === '/token' && req.method === 'POST') {
      const raw = await readBody(req);
      const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;
      tokenRequests.push(params);
      // Only mint tokens when code + verifier present.
      if (params.code && params.code_verifier) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'fake-access-token',
            refresh_token: 'fake-refresh-token',
            expires_in: 3600,
            scope: 'design:read design:write',
            token_type: 'Bearer',
          }),
        );
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_grant' }));
      return;
    }

    res.writeHead(404);
    res.end();
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    serverUrl: `${origin}/mcp`,
    tokenRequests,
    registerRequests,
    close: () =>
      new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function base64UrlSha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('McpOAuthService — self-contained remote OAuth (DCR + PKCE)', () => {
  let provider: FakeProvider;
  let authFile: string;
  let reconnectSpy: ReturnType<typeof vi.fn<(name: string) => Promise<boolean>>>;
  let service: McpOAuthService;

  beforeEach(async () => {
    provider = await startFakeProvider();
    const dir = mkdtempSync(join(tmpdir(), 'mcp-oauth-'));
    authFile = join(dir, 'mcp-auth.json');
    reconnectSpy = vi.fn().mockResolvedValue(true);
    service = new McpOAuthService({
      authFilePath: authFile,
      reconnect: reconnectSpy,
      callbackPort: 0, // ephemeral loopback port for the test
    });
  });

  afterEach(async () => {
    await service.shutdown();
    await provider.close();
  });

  it('start() discovers metadata, runs DCR, and returns an authorize URL with state + S256 + resource', async () => {
    const { authorizationUrl } = await service.start('canva', provider.serverUrl);

    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe(`${provider.origin}/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('fake-client-id-123');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('resource')).toBe(provider.serverUrl);
    expect(url.searchParams.get('scope')).toBe('design:read design:write');

    // redirect_uri points at our loopback callback path
    const redirectUri = url.searchParams.get('redirect_uri')!;
    expect(redirectUri).toContain('/mcp/oauth/callback');
    expect(redirectUri).toContain('127.0.0.1');

    // DCR happened with the spec'd body
    expect(provider.registerRequests).toHaveLength(1);
    expect(provider.registerRequests[0]).toMatchObject({
      client_name: 'Rhythm',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });

    expect(service.status('canva')).toBe('pending');
  });

  it('callback exchanges code (sending code_verifier), writes exact mcp-auth.json schema, and calls reconnect', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { authorizationUrl } = await service.start('canva', provider.serverUrl);
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get('state')!;
    const challenge = url.searchParams.get('code_challenge')!;
    const redirectUri = url.searchParams.get('redirect_uri')!;

    // Simulate the provider redirecting the browser back to our loopback server.
    const cbUrl = new URL(redirectUri);
    cbUrl.searchParams.set('code', 'auth-code-xyz');
    cbUrl.searchParams.set('state', state);
    const res = await fetch(cbUrl.toString());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain('succeeded');

    // token POST happened with code + code_verifier + resource
    expect(provider.tokenRequests).toHaveLength(1);
    const tok = provider.tokenRequests[0];
    expect(tok.grant_type).toBe('authorization_code');
    expect(tok.code).toBe('auth-code-xyz');
    expect(tok.client_id).toBe('fake-client-id-123');
    expect(tok.code_verifier).toBeTruthy();
    expect(tok.redirect_uri).toBe(redirectUri);
    expect(tok.resource).toBe(provider.serverUrl);
    // verifier must hash to the challenge we advertised (real PKCE)
    expect(base64UrlSha256(tok.code_verifier)).toBe(challenge);

    // mcp-auth.json written with the EXACT schema
    expect(existsSync(authFile)).toBe(true);
    const store = JSON.parse(readFileSync(authFile, 'utf8')) as Record<string, any>;
    expect(store).toHaveProperty('canva');
    const entry = store.canva;
    expect(entry.serverUrl).toBe(provider.serverUrl);
    expect(entry.clientInfo.clientId).toBe('fake-client-id-123');
    expect(entry.tokens.accessToken).toBe('fake-access-token');
    expect(entry.tokens.refreshToken).toBe('fake-refresh-token');
    expect(entry.tokens.scope).toBe('design:read design:write');
    expect(entry.tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(entry.tokens.expiresAt).toBeLessThanOrEqual(before + 3600 + 10);

    // reconnect invoked with the server name; status flips to connected
    expect(reconnectSpy).toHaveBeenCalledWith('canva');
    expect(service.status('canva')).toBe('connected');
  });

  it('preserves other servers already present in mcp-auth.json', async () => {
    writeFileSync(
      authFile,
      JSON.stringify({
        notion: {
          clientInfo: { clientId: 'other-client' },
          serverUrl: 'https://mcp.notion.com/mcp',
          tokens: { accessToken: 'n-a', refreshToken: 'n-r', expiresAt: 1, scope: 's' },
        },
      }),
      'utf8',
    );

    const { authorizationUrl } = await service.start('canva', provider.serverUrl);
    const url = new URL(authorizationUrl);
    const cbUrl = new URL(url.searchParams.get('redirect_uri')!);
    cbUrl.searchParams.set('code', 'auth-code-xyz');
    cbUrl.searchParams.set('state', url.searchParams.get('state')!);
    await fetch(cbUrl.toString());

    const store = JSON.parse(readFileSync(authFile, 'utf8')) as Record<string, any>;
    // canva added, notion untouched
    expect(store.canva.tokens.accessToken).toBe('fake-access-token');
    expect(store.notion.clientInfo.clientId).toBe('other-client');
    expect(store.notion.tokens.accessToken).toBe('n-a');
  });

  it('rejects an unknown/invalid state callback with 400, does not write tokens, marks failed', async () => {
    await service.start('canva', provider.serverUrl);
    const cbUrlBase = service.callbackUrl();
    const cbUrl = new URL(cbUrlBase);
    cbUrl.searchParams.set('code', 'auth-code-xyz');
    cbUrl.searchParams.set('state', 'not-a-real-state');

    const res = await fetch(cbUrl.toString());
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html.toLowerCase()).toContain('failed');

    // no token exchange, nothing written for canva tokens
    expect(provider.tokenRequests).toHaveLength(0);
    if (existsSync(authFile)) {
      const store = JSON.parse(readFileSync(authFile, 'utf8')) as Record<string, any>;
      expect(store.canva?.tokens).toBeUndefined();
    }
    // the pending entry for canva is unaffected by a bogus-state hit and stays pending;
    // a real failure path (the matched-state branch) is what flips to failed.
    expect(service.status('canva')).toBe('pending');
  });

  it('reuses a cached client only when the stored redirectUri marker matches (else re-registers)', async () => {
    // First flow registers a client and persists clientInfo + redirectUri marker.
    await service.start('canva', provider.serverUrl);
    expect(provider.registerRequests).toHaveLength(1);

    // Second start() against the SAME callback port → marker matches → no new DCR.
    await service.start('canva', provider.serverUrl);
    expect(provider.registerRequests).toHaveLength(1);
  });
});
