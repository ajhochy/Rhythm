/**
 * Multi-account OpenAI — route tests mirroring anthropic_accounts_routes.test.ts:
 *
 *   GET    /opencode/auth/openai/accounts
 *   POST   /opencode/auth/openai/accounts/login-start
 *   POST   /opencode/auth/openai/accounts/login-complete
 *   PATCH  /opencode/auth/openai/accounts/default
 *   PATCH  /opencode/auth/openai/accounts/:id   (rename)
 *   DELETE /opencode/auth/openai/accounts/:id
 *
 * Synthetic tokens only; HOME and the accounts file point into a temp dir so
 * the real ~/.local/share/opencode/auth.json is never read.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';

const ACCOUNTS_FILE = vi.hoisted(() => {
  const base = `${process.env.TMPDIR || '/tmp'}/rhythm-openai-accounts-routes-${process.pid}-${Math.random().toString(36).slice(2)}`;
  process.env.HOME = `${base}-home`;
  process.env.RHYTHM_OPENAI_ACCOUNTS_FILE = `${base}.json`;
  return `${base}.json`;
});

const engineStub = vi.hoisted(() => ({
  isReady: true,
  setOAuthCredentials: vi.fn().mockResolvedValue(true),
  removeAuth: vi.fn().mockResolvedValue(true),
  listAuthedProviders: vi.fn().mockResolvedValue([]),
  statusMessage: 'Opencode SDK ready',
}));

vi.mock('../services/opencode_engine', () => ({ opencodeClient: engineStub }));

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { OAuthAccountsStore } from '../services/anthropic_accounts_store';
import type { OpenAIAccount } from '../services/openai_accounts_service';

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

function seed(id: string) {
  new OAuthAccountsStore<OpenAIAccount>(ACCOUNTS_FILE).upsertAccount({
    id,
    label: id,
    access: `access-${id}`,
    refresh: `refresh-${id}`,
    expires: Date.now() + 24 * 3600_000,
    status: 'ok',
    chatgptAccountId: `ws-${id}`,
  });
}

const realFetch = globalThis.fetch;
let tokenResponder: (() => Response) | null = null;
const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('/opencode/auth/openai/accounts routes', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    if (existsSync(ACCOUNTS_FILE)) rmSync(ACCOUNTS_FILE);
    tokenResponder = null;
    vi.stubGlobal('fetch', (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://auth.openai.com/')) {
        return tokenResponder ? tokenResponder() : new Response('unexpected', { status: 500 });
      }
      return realFetch(input, init);
    }) as typeof fetch);
    setDb((() => { const db = new Database(':memory:'); runMigrations(db); return db; })());
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('empty list, then login-start returns a Codex PKCE authorize URL', async () => {
    expect(await (await fetch(`${baseUrl}/opencode/auth/openai/accounts`)).json()).toEqual({ accounts: [], defaultAccountId: null });
    const res = await fetch(`${baseUrl}/opencode/auth/openai/accounts/login-start`, { method: 'POST', ...json({ accountId: 'work' }) });
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('second account login keeps the first default and does not touch the engine; switching default never rewrites auth.json', async () => {
    seed('first');
    const start = await fetch(`${baseUrl}/opencode/auth/openai/accounts/login-start`, { method: 'POST', ...json({ accountId: 'second', label: 'Personal' }) });
    const state = new URL(((await start.json()) as { authorizeUrl: string }).authorizeUrl).searchParams.get('state');
    tokenResponder = () =>
      new Response(
        JSON.stringify({
          id_token: jwt({ email: 'p@example.test', chatgpt_account_id: 'ws-second' }),
          access_token: 'ACCESS_SECRET',
          refresh_token: 'REFRESH_SECRET',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    const done = await fetch(`${baseUrl}/opencode/auth/openai/accounts/login-complete`, {
      method: 'POST',
      ...json({ accountId: 'second', code: `http://localhost:1455/auth/callback?code=c&state=${state}` }),
    });
    expect(done.status).toBe(200);
    const body = await done.text();
    expect(body).not.toContain('SECRET');
    expect(JSON.parse(body).account).toMatchObject({ id: 'second', label: 'Personal', email: 'p@example.test' });

    const list = (await (await fetch(`${baseUrl}/opencode/auth/openai/accounts`)).json()) as { accounts: { id: string }[]; defaultAccountId: string };
    expect(list.accounts.map((a) => a.id)).toEqual(['first', 'second']);
    expect(list.defaultAccountId).toBe('first');
    expect(JSON.stringify(list)).not.toContain('SECRET');
    expect(engineStub.setOAuthCredentials).not.toHaveBeenCalled();

    // Engine already holds an openai oauth entry (the first account's seed).
    const authDir = `${process.env.HOME}/.local/share/opencode`;
    mkdirSync(authDir, { recursive: true });
    writeFileSync(`${authDir}/auth.json`, JSON.stringify({ openai: { type: 'oauth', access: 'x', refresh: 'refresh-first', expires: 1 } }));
    try {
      const sw = await fetch(`${baseUrl}/opencode/auth/openai/accounts/default`, { method: 'PATCH', ...json({ accountId: 'second' }) });
      expect(await sw.json()).toEqual({ ok: true, defaultAccountId: 'second', engineUpdated: true });
      // Per-request routing: no auth.json write → no watcher-driven engine restart.
      expect(engineStub.setOAuthCredentials).not.toHaveBeenCalled();
    } finally {
      rmSync(`${authDir}/auth.json`);
    }
  });

  it('first account login becomes default and is pushed to the engine', async () => {
    const start = await fetch(`${baseUrl}/opencode/auth/openai/accounts/login-start`, { method: 'POST', ...json({ accountId: 'solo' }) });
    const state = new URL(((await start.json()) as { authorizeUrl: string }).authorizeUrl).searchParams.get('state');
    tokenResponder = () => new Response(JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }), { status: 200 });
    await fetch(`${baseUrl}/opencode/auth/openai/accounts/login-complete`, { method: 'POST', ...json({ accountId: 'solo', code: `c#${state}` }) });
    expect(engineStub.setOAuthCredentials).toHaveBeenCalledWith('openai', expect.objectContaining({ access: 'A', refresh: 'R' }));
  });

  it('validation: bad slug 400, unknown default 404, no pending login 404/409', async () => {
    seed('seeded');
    expect((await fetch(`${baseUrl}/opencode/auth/openai/accounts/login-start`, { method: 'POST', ...json({ accountId: 'Bad!' }) })).status).toBe(400);
    expect((await fetch(`${baseUrl}/opencode/auth/openai/accounts/default`, { method: 'PATCH', ...json({ accountId: 'ghost' }) })).status).toBe(404);
    expect((await fetch(`${baseUrl}/opencode/auth/openai/accounts/login-complete`, { method: 'POST', ...json({ accountId: 'ghost', code: 'x' }) })).status).toBe(404);
    expect((await fetch(`${baseUrl}/opencode/auth/openai/accounts/login-complete`, { method: 'POST', ...json({ accountId: 'seeded', code: 'x' }) })).status).toBe(409);
  });

  it('rename and delete', async () => {
    seed('a');
    seed('b');
    expect((await fetch(`${baseUrl}/opencode/auth/openai/accounts/a`, { method: 'PATCH', ...json({ label: 'Work' }) })).status).toBe(200);
    expect((await fetch(`${baseUrl}/opencode/auth/openai/accounts/ghost`, { method: 'PATCH', ...json({ label: 'X' }) })).status).toBe(404);
    expect((await fetch(`${baseUrl}/opencode/auth/openai/accounts/a`, { method: 'DELETE' })).status).toBe(200);
    const list = (await (await fetch(`${baseUrl}/opencode/auth/openai/accounts`)).json()) as { accounts: { id: string }[]; defaultAccountId: string };
    expect(list.accounts.map((x) => x.id)).toEqual(['b']);
    expect(list.defaultAccountId).toBe('b');
    // Removed the default → the new default applies per request; no engine write.
    expect(engineStub.setOAuthCredentials).not.toHaveBeenCalled();
  });
});
