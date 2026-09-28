import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { OAuthAccountsStore } from './anthropic_accounts_store';
import {
  OpenAIAccount,
  OpenAIAccountsService,
  OpenAIOauthService,
  OpenAIEngine,
  identityFromTokens,
} from './openai_accounts_service';

// Synthetic, unsigned JWTs — never real credentials.
const jwt = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

function setup(fetchImpl: typeof fetch = vi.fn() as unknown as typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'openai-acct-'));
  const authPath = join(dir, 'auth.json');
  const store = new OAuthAccountsStore<OpenAIAccount>(join(dir, 'openai-accounts.json'));
  const service = new OpenAIAccountsService(store, fetchImpl, authPath);
  // Mock engine: auth.set writes the openai entry to the temp auth.json, like the real engine.
  const engine: OpenAIEngine & { setOAuthCredentials: ReturnType<typeof vi.fn>; removeAuth: ReturnType<typeof vi.fn> } = {
    isReady: true,
    setOAuthCredentials: vi.fn(async (_p: string, creds: Record<string, unknown>) => {
      writeFileSync(authPath, JSON.stringify({ openai: { type: 'oauth', ...creds } }));
      return true;
    }),
    removeAuth: vi.fn(async () => {
      writeFileSync(authPath, '{}');
      return true;
    }),
  };
  const writeEngine = (entry: Record<string, unknown>) =>
    writeFileSync(authPath, JSON.stringify({ openai: { type: 'oauth', ...entry } }));
  const readEngine = () => JSON.parse(readFileSync(authPath, 'utf8')).openai;
  return { store, service, engine, writeEngine, readEngine };
}

const acct = (id: string, extra: Partial<OpenAIAccount> = {}): OpenAIAccount => ({
  id,
  label: id,
  access: `access-${id}`,
  refresh: `refresh-${id}`,
  expires: Date.now() + 24 * 3600_000,
  status: 'ok',
  chatgptAccountId: `ws-${id}`,
  ...extra,
});

describe('identityFromTokens', () => {
  it('reads workspace id and email from id_token claims', () => {
    const out = identityFromTokens({
      id_token: jwt({ email: 'a@example.test', 'https://api.openai.com/auth': { chatgpt_account_id: 'ws-1' } }),
    });
    expect(out).toEqual({ chatgptAccountId: 'ws-1', email: 'a@example.test' });
  });
});

describe('OpenAIAccountsService', () => {
  it('migrates the existing engine login as account #1, once', () => {
    const { service, writeEngine } = setup();
    writeEngine({ access: jwt({ email: 'me@example.test' }), refresh: 'r0', expires: 5, accountId: 'ws-0' });
    expect(service.migrateFromEngine()).toBe(true);
    expect(service.getAccount('default')).toMatchObject({ label: 'me@example.test', refresh: 'r0', chatgptAccountId: 'ws-0' });
    expect(service.migrateFromEngine()).toBe(false);
  });

  it('adding a second account keeps the first as default and leaves the engine alone', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id_token: jwt({ email: 'two@example.test', chatgpt_account_id: 'ws-two' }),
            access_token: 'A2',
            refresh_token: 'R2',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const { store, service, engine } = setup(fetchImpl);
    store.upsertAccount(acct('first'));
    const oauth = new OpenAIOauthService(service, fetchImpl);
    const { authorizeUrl } = oauth.startLogin('second', '');
    const state = new URL(authorizeUrl).searchParams.get('state');
    const result = await oauth.completeLogin('second', `http://localhost:1455/auth/callback?code=c1&state=${state}`);
    expect(result).toEqual({ ok: true });
    const f = store.read();
    expect(f.accounts.map((a) => a.id)).toEqual(['first', 'second']);
    expect(f.defaultAccountId).toBe('first');
    expect(service.getAccount('second')).toMatchObject({ label: 'two@example.test', chatgptAccountId: 'ws-two' });
    expect(engine.setOAuthCredentials).not.toHaveBeenCalled();
  });

  it('rejects a pasted callback whose state does not match', async () => {
    const { service } = setup();
    const oauth = new OpenAIOauthService(service, vi.fn() as unknown as typeof fetch);
    oauth.startLogin('x', 'X');
    expect(await oauth.completeLogin('x', 'http://localhost:1455/auth/callback?code=c&state=evil')).toEqual({
      ok: false,
      reason: 'state_mismatch',
    });
  });

  it('switching default pushes that account (with ChatGPT workspace id) into the engine', async () => {
    const { store, service, engine, readEngine } = setup();
    store.upsertAccount(acct('a'));
    store.upsertAccount(acct('b'));
    await service.pushDefaultToEngine(engine);
    expect(readEngine()).toMatchObject({ refresh: 'refresh-a', accountId: 'ws-a' });
    expect(await service.activate(engine, 'b')).toBe(true);
    expect(engine.setOAuthCredentials).toHaveBeenLastCalledWith('openai', {
      access: 'access-b',
      refresh: 'refresh-b',
      expires: expect.any(Number),
      accountId: 'ws-b',
    });
    expect(store.read().defaultAccountId).toBe('b');
  });

  it('push is a no-op when the engine already holds the default (no watcher bounce)', async () => {
    const { store, service, engine, writeEngine } = setup();
    store.upsertAccount(acct('a'));
    writeEngine({ access: 'access-a', refresh: 'refresh-a', expires: 1, accountId: 'ws-a' });
    expect(await service.pushDefaultToEngine(engine)).toBe(true);
    expect(engine.setOAuthCredentials).not.toHaveBeenCalled();
  });

  it('switching away first adopts the engine-rotated tokens of the outgoing default', async () => {
    const { store, service, engine, writeEngine } = setup();
    store.upsertAccount(acct('a', { expires: 1000 }));
    store.upsertAccount(acct('b'));
    writeEngine({ access: 'rotA', refresh: 'rotR', expires: 2000, accountId: 'ws-a' });
    await service.activate(engine, 'b');
    expect(service.getAccount('a')).toMatchObject({ access: 'rotA', refresh: 'rotR', expires: 2000 });
  });

  it('refreshAll refreshes non-default accounts only (the engine refreshes the default)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ access_token: 'newA', refresh_token: 'newR', expires_in: 3600 }), { status: 200 }),
    ) as unknown as typeof fetch;
    const { store, service } = setup(fetchImpl);
    store.upsertAccount(acct('def', { expires: Date.now() + 1000 }));
    store.upsertAccount(acct('other', { expires: Date.now() + 1000 }));
    await service.refreshAll();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(service.getAccount('other')).toMatchObject({ access: 'newA', refresh: 'newR', status: 'ok' });
    expect(service.getAccount('def')!.access).toBe('access-def');
  });

  it('refresh failure marks needs_relogin; such a default is not pushed', async () => {
    const fetchImpl = vi.fn(async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    const { store, service, engine } = setup(fetchImpl);
    store.upsertAccount(acct('a'));
    store.upsertAccount(acct('b', { expires: Date.now() - 1 }));
    await service.refreshAll();
    expect(service.getAccount('b')!.status).toBe('needs_relogin');
    expect(await service.activate(engine, 'b')).toBe(false);
    expect(engine.setOAuthCredentials).not.toHaveBeenCalled();
  });

  it('removing the default re-points the engine; removing the last logs it out', async () => {
    const { store, service, engine, readEngine } = setup();
    store.upsertAccount(acct('a'));
    store.upsertAccount(acct('b'));
    await service.pushDefaultToEngine(engine);
    await service.removeAndReconcile(engine, 'a');
    expect(readEngine()).toMatchObject({ refresh: 'refresh-b' });
    await service.removeAndReconcile(engine, 'b');
    expect(engine.removeAuth).toHaveBeenCalledWith('openai');
    expect(service.hasAccounts()).toBe(false);
  });

  it('listRedacted never exposes tokens', () => {
    const { store, service } = setup();
    store.upsertAccount(acct('t', { access: 'SECRET', refresh: 'SECRET2' }));
    expect(JSON.stringify(service.listRedacted())).not.toContain('SECRET');
  });
});

describe('OpenAIOauthService.parsePasted', () => {
  it.each([
    ['http://localhost:1455/auth/callback?code=abc&state=xyz', { code: 'abc', state: 'xyz' }],
    ['code=abc&state=xyz', { code: 'abc', state: 'xyz' }],
    ['abc#xyz', { code: 'abc', state: 'xyz' }],
    ['abc', { code: 'abc', state: undefined }],
  ])('%s', (input, expected) => {
    expect(OpenAIOauthService.parsePasted(input)).toEqual(expected);
  });
});
