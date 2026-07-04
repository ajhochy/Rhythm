/**
 * Dual-anthropic-accounts Task B — route tests for the multi-account login
 * endpoints on the opencode auth router (mounted at /opencode/auth):
 *
 *   GET    /opencode/auth/accounts
 *   POST   /opencode/auth/accounts/login-start
 *   POST   /opencode/auth/accounts/login-complete
 *   PATCH  /opencode/auth/accounts/default
 *   DELETE /opencode/auth/accounts/:id
 *
 * Pattern mirrors opencode_auth_routes.test.ts (real HTTP server + global
 * fetch; opencode_engine vi.mock'd — no real engine boot). The Anthropic
 * token endpoint is intercepted via a global-fetch wrapper that passes
 * localhost traffic through untouched.
 *
 * Invariants under test:
 *  - tokens NEVER appear in any HTTP response body
 *  - accountId slug validation [a-z0-9-]{1,32}
 *  - login-complete for the default account pushes creds into the engine
 *    via opencodeClient.setOAuthCredentials('anthropic', ...)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, rmSync } from 'fs';

// RHYTHM_ACCOUNTS_FILE must be set BEFORE any module under test is imported:
// the anthropicAccountsService singleton captures the path at construction
// time (module import). vi.hoisted runs ahead of the static imports below.
const ACCOUNTS_FILE = vi.hoisted(() => {
  const p = `${process.env.TMPDIR || '/tmp'}/rhythm-anthropic-accounts-routes-${process.pid}-${Math.random()
    .toString(36)
    .slice(2)}.json`;
  process.env.RHYTHM_ACCOUNTS_FILE = p;
  return p;
});

const engineStub = vi.hoisted(() => ({
  isReady: true,
  setOAuthCredentials: vi.fn().mockResolvedValue(true),
  listAuthedProviders: vi.fn().mockResolvedValue([]),
  statusMessage: 'Opencode SDK ready',
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: engineStub,
}));

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { AnthropicAccountsStore } from '../services/anthropic_accounts_store';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedAccount(id: string, overrides: Partial<{ access: string; refresh: string }> = {}) {
  new AnthropicAccountsStore(ACCOUNTS_FILE).upsertAccount({
    id,
    label: id,
    access: overrides.access ?? `access-${id}`,
    refresh: overrides.refresh ?? `refresh-${id}`,
    expires: Date.now() + 3600_000,
    status: 'ok',
  });
}

// Global-fetch wrapper: claude.ai calls hit the token responder; everything
// else (the test's own requests to the local server) passes through.
const realFetch = globalThis.fetch;
let tokenResponder: (() => Response) | null = null;

describe('/opencode/auth/accounts routes', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    if (existsSync(ACCOUNTS_FILE)) rmSync(ACCOUNTS_FILE);
    tokenResponder = null;
    vi.stubGlobal('fetch', (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith('https://claude.ai/')) {
        return tokenResponder
          ? tokenResponder()
          : new Response('unexpected claude.ai call', { status: 500 });
      }
      return realFetch(input, init);
    }) as typeof fetch);
    setDb(makeDb());
    const { baseUrl: b, close: c } = await startTestServer(createApp());
    baseUrl = b;
    close = c;
  });

  afterEach(async () => {
    await close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('GET /accounts returns empty shape on empty store', async () => {
    const res = await fetch(`${baseUrl}/opencode/auth/accounts`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [], defaultAccountId: null });
  });

  it('POST /accounts/login-start returns a PKCE authorize URL', async () => {
    const res = await fetch(`${baseUrl}/opencode/auth/accounts/login-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'team', label: 'Team' }),
    });
    expect(res.status).toBe(200);
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    expect(authorizeUrl).toContain('claude.ai/oauth/authorize');
    const url = new URL(authorizeUrl);
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('POST /accounts/login-start rejects invalid slugs', async () => {
    const res = await fetch(`${baseUrl}/opencode/auth/accounts/login-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'Bad_Slug!', label: 'Nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /accounts/login-complete exchanges the code, lists the account, leaks no tokens, pushes default creds to the engine', async () => {
    const startRes = await fetch(`${baseUrl}/opencode/auth/accounts/login-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'team', label: 'Team' }),
    });
    const { authorizeUrl } = (await startRes.json()) as { authorizeUrl: string };
    const state = new URL(authorizeUrl).searchParams.get('state')!;

    tokenResponder = () =>
      new Response(
        JSON.stringify({
          access_token: 'ACCESS_SECRET_TOKEN',
          refresh_token: 'REFRESH_SECRET_TOKEN',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const res = await fetch(`${baseUrl}/opencode/auth/accounts/login-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'team', code: `authcode-abc#${state}` }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { account: { id: string; status: string } };
    expect(body.account).toMatchObject({ id: 'team', status: 'ok' });
    // Tokens must never leave the server.
    expect(JSON.stringify(body)).not.toContain('ACCESS_SECRET_TOKEN');
    expect(JSON.stringify(body)).not.toContain('REFRESH_SECRET_TOKEN');

    const listRes = await fetch(`${baseUrl}/opencode/auth/accounts`);
    const list = (await listRes.json()) as {
      accounts: { id: string }[];
      defaultAccountId: string | null;
    };
    expect(list.accounts.map((a) => a.id)).toEqual(['team']);
    expect(list.defaultAccountId).toBe('team');
    expect(JSON.stringify(list)).not.toContain('ACCESS_SECRET_TOKEN');
    expect(JSON.stringify(list)).not.toContain('REFRESH_SECRET_TOKEN');

    // First account is the default → creds pushed into the engine.
    expect(engineStub.setOAuthCredentials).toHaveBeenCalledWith('anthropic', {
      access: 'ACCESS_SECRET_TOKEN',
      refresh: 'REFRESH_SECRET_TOKEN',
      expires: expect.any(Number),
    });
  });

  it('POST /accounts/login-complete with unknown accountId → 404', async () => {
    const res = await fetch(`${baseUrl}/opencode/auth/accounts/login-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'ghost', code: 'abc#xyz' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /accounts/login-complete for an existing account with no pending login → 409', async () => {
    seedAccount('seeded');
    const res = await fetch(`${baseUrl}/opencode/auth/accounts/login-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'seeded', code: 'abc#xyz' }),
    });
    expect(res.status).toBe(409);
  });

  it('PATCH /accounts/default switches the default; unknown id → 404', async () => {
    seedAccount('a');
    seedAccount('b');

    const bad = await fetch(`${baseUrl}/opencode/auth/accounts/default`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'ghost' }),
    });
    expect(bad.status).toBe(404);

    const res = await fetch(`${baseUrl}/opencode/auth/accounts/default`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'b' }),
    });
    expect(res.status).toBe(200);

    const list = (await (await fetch(`${baseUrl}/opencode/auth/accounts`)).json()) as {
      defaultAccountId: string | null;
    };
    expect(list.defaultAccountId).toBe('b');
  });

  it('DELETE /accounts/:id removes the account', async () => {
    seedAccount('team');
    const res = await fetch(`${baseUrl}/opencode/auth/accounts/team`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);

    const list = (await (await fetch(`${baseUrl}/opencode/auth/accounts`)).json()) as {
      accounts: unknown[];
      defaultAccountId: string | null;
    };
    expect(list.accounts).toEqual([]);
    expect(list.defaultAccountId).toBeNull();
  });
});
