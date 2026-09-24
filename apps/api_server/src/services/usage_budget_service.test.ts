/**
 * Unit tests for usage_budget_service — the #844 (tokens-04) tiered-routing
 * feature reads this service's snapshot shape via getUsageBudget() to decide
 * whether a provider is "near budget" (see agent_model_resolver.ts
 * isProviderNearBudget). No prior test file existed for this service.
 *
 * Anthropic credentials are read from BOTH auth.json AND the macOS Keychain
 * (via CredentialsBridgeService, which shells out with execSync) — mocking
 * only `fs` is not sufficient to guarantee no real network call on a dev
 * machine with real Claude Code credentials installed. CredentialsBridgeService
 * and the `fs` auth.json read are both mocked absent here so every provider
 * deterministically resolves to 'unavailable' and getUsageBudget() never
 * reaches a real fetch(), regardless of the host machine's credential state.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { inspect } from 'util';

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

vi.mock('./credentials_bridge_service', () => ({
  CredentialsBridgeService: class {
    readClaudeCreds() {
      return null;
    }
  },
}));

import { getUsageBudget } from './usage_budget_service';

describe('getUsageBudget', () => {
  it('returns a snapshot with one entry per known provider, all unavailable with no credentials', async () => {
    const snapshot = await getUsageBudget({ force: true });

    expect(snapshot.fetchedAt).toEqual(expect.any(String));
    expect(snapshot.providers).toHaveLength(4);

    const byProvider = Object.fromEntries(snapshot.providers.map((p) => [p.provider, p]));
    expect(Object.keys(byProvider).sort()).toEqual(['anthropic', 'gemini', 'openai', 'openrouter'].sort());

    for (const provider of snapshot.providers) {
      expect(provider.kind).toBe('unavailable');
      expect(provider.reason).toEqual(expect.any(String));
      expect(Array.isArray(provider.items)).toBe(true);
    }
  });

  it('each provider item shape matches what resolveTieredModel reads (label + remainingFraction)', async () => {
    const snapshot = await getUsageBudget({ force: true });
    // No provider has data when unauthenticated, but the shape contract
    // (items: [] here) is what agent_model_resolver.isProviderNearBudget
    // iterates with `.some(item => item.remainingFraction <= threshold)`.
    for (const provider of snapshot.providers) {
      expect(provider.items).toEqual([]);
    }
  });
});

// #1568: real service/auth parsing and cache; only disk and remote network are faked.
describe('issue-1568: Codex usage budget', () => {
  const jwt = (claims: unknown) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
  const window = (used_percent: unknown, limit_window_seconds: unknown, reset_at: unknown) =>
    ({ used_percent, limit_window_seconds, reset_at });
  const body = { rate_limit: {
    primary_window: window(25, 18000, 2_000_000_000),
    secondary_window: window(60, 604800, 2_000_600_000),
  }, credits: { balance: 'SECRET-CREDIT' }, plan_type: 'plus' };
  const token = jwt({ exp: Math.floor(Date.now() / 1000) + 3600, chatgpt_account_id: 'account-123' });
  const auth = (openai: unknown) => JSON.stringify({ openai });
  const valid = { type: 'oauth', access: token, expires: Date.now() + 3600000 };
  const fetchMock = vi.fn();

  // Preserve raw numeric values JSON.stringify would silently turn into null.
  const rawResponse = (payload: unknown) => {
    const response = new Response('{}', { headers: { 'content-type': 'application/json' } });
    vi.spyOn(response, 'json').mockResolvedValue(payload);
    return response;
  };

  async function snapshot(contents: string, response: unknown = body, beforeImport?: () => Promise<void>) {
    vi.resetModules();
    vi.doMock('./anthropic_accounts_service', () => ({ anthropicAccountsService: {
      listRedacted: () => ({ accounts: [] }),
    } }));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(contents);
    fetchMock.mockReset();
    if (response instanceof Error) fetchMock.mockRejectedValue(response);
    else if (response instanceof Response) fetchMock.mockResolvedValue(response);
    else fetchMock.mockImplementation(async () => new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await beforeImport?.();
    const { getUsageBudget } = await import('./usage_budget_service');
    const result = await getUsageBudget({ force: true });
    return result.providers.find((p) => p.provider === 'openai')!;
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock('./anthropic_accounts_service');
    vi.resetModules();
  });

  it('A1 exact no-body GET and two ordered windows, without leaking credits or identity', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const entry = await snapshot(auth(valid));
    expect(timeout).toHaveBeenCalledWith(12_000);
    timeout.mockRestore();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(init.method).toBe('GET');
    expect(init).not.toHaveProperty('body');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual({ Authorization: `Bearer ${token}`, 'ChatGPT-Account-Id': 'account-123', 'User-Agent': 'codex-cli', Accept: 'application/json' });
    expect(entry.kind).toBe('window');
    expect(entry.items).toEqual([
      { label: '5h limit', remainingFraction: 0.75, resetAt: new Date(2_000_000_000_000).toISOString() },
      { label: 'weekly', remainingFraction: 0.4, resetAt: new Date(2_000_600_000_000).toISOString() },
    ]);
    expect(JSON.stringify(entry)).not.toMatch(/SECRET-CREDIT|account-123|plus/);
  });

  it('A2 accepts only a valid primary window and ignores absent secondary', async () => {
    const entry = await snapshot(auth(valid), { rate_limit: { primary_window: body.rate_limit.primary_window } });
    expect(entry.items).toHaveLength(1);
    expect(entry.items[0].label).toBe('5h limit');
  });

  it('A3 independently keeps a valid secondary when primary is malformed', async () => {
    const entry = await snapshot(auth(valid), { rate_limit: { ...body.rate_limit, primary_window: window(101, 18000, 2_000_000_000) } });
    expect(entry.items).toEqual([{ label: 'weekly', remainingFraction: 0.4, resetAt: new Date(2_000_600_000_000).toISOString() }]);
  });

  it('A4 rejects missing credentials and invalid auth top-level without network', async () => {
    for (const contents of ['[]', 'null', '{', auth(undefined), auth({ ...valid, type: 'api' }), auth({ ...valid, access: '' }), auth({ ...valid, expires: 'tomorrow' }), auth({ ...valid, expires: Date.now() - 1 })]) {
      const entry = await snapshot(contents);
      expect(entry.kind).toBe('unavailable');
      expect(entry.items).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('A5 rejects malformed or expired JWT and unsafe account IDs before network', async () => {
    for (const access of ['nonsense', jwt({ exp: 'later', chatgpt_account_id: 'account-123' }), jwt({ exp: 1, chatgpt_account_id: 'account-123' }), jwt({ exp: Math.floor(Date.now()/1000)+3600 }), jwt({ exp: Math.floor(Date.now()/1000)+3600, chatgpt_account_id: 'id\r\nSecret: x' })]) {
      const entry = await snapshot(auth({ ...valid, access }));
      expect(entry.kind).toBe('unavailable');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('A15 rejects malformed bearer segments before network even when the payload decodes', async () => {
    const [, payload] = token.split('.');
    for (const access of [`.${payload}.sig`, `e30.${payload}.`, `e30.${payload}`, `e30.${payload}.sig.extra`,
      `e30.${payload}.sig\n`, `e30.${payload}.sig `, `e30.${payload}.sig\0`, `é.${payload}.sig`,
      `e30.${payload}.sig=`, `e30.${payload}.sig/suffix`]) {
      const entry = await snapshot(auth({ ...valid, access }));
      expect(entry.reason).toBe('OpenAI token unavailable');
      expect(entry.items).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('A16 rejects nonstring access as credentials unavailable before network', async () => {
    for (const access of [null, 123, {}, ['e30', 'payload', 'sig']]) {
      const entry = await snapshot(auth({ ...valid, access }));
      expect(entry.reason).toBe('OpenAI credentials unavailable');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('A6 prefers stored account id then safe JWT claims in fallback order', async () => {
    const access = jwt({ exp: Math.floor(Date.now()/1000)+3600, chatgpt_account_id: 'direct', 'https://api.openai.com/auth': { chatgpt_account_id: 'nested' }, organizations: [{ id: 'org' }] });
    for (const [credential, expected] of [
      [{ ...valid, access, accountId: 'stored' }, 'stored'],
      [{ ...valid, access }, 'direct'],
      [{ ...valid, access: jwt({ exp: Math.floor(Date.now()/1000)+3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'nested' }, organizations: [{ id: 'org' }] }) }, 'nested'],
      [{ ...valid, access: jwt({ exp: Math.floor(Date.now()/1000)+3600, organizations: [{ id: 'org' }] }) }, 'org'],
    ] as const) {
      await snapshot(auth(credential));
      expect(fetchMock.mock.calls[0][1].headers['ChatGPT-Account-Id']).toBe(expected);
    }
  });

  it('A7 rejects non-2xx, HTML and invalid JSON without disclosing response text', async () => {
    for (const [response, reason] of [
      [new Response('SECRET-BODY', { status: 401, statusText: 'SECRET-STATUS' }), 'OpenAI usage unavailable'],
      [new Response('<html>SECRET-BODY</html>', { headers: { 'content-type': 'text/html' } }), 'OpenAI usage response unavailable'],
      [new Response('SECRET-BODY', { headers: { 'content-type': 'application/json' } }), 'OpenAI usage unavailable'],
    ] as const) {
      const failed = await snapshot(auth(valid), response);
      expect(failed.kind).toBe('unavailable');
      expect(failed.items).toEqual([]);
      expect(JSON.stringify(failed)).not.toMatch(/SECRET-BODY|SECRET-STATUS|account-123/);
      expect(failed.reason).toBe(reason);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('A8 rejects missing rate_limit and malformed windows, including arrays and impossible resets', async () => {
    for (const payload of [{}, { rate_limit: [] }, { rate_limit: { primary_window: [] } }, { rate_limit: { primary_window: window('25', 18000, 2_000_000_000) } }, ...[-1, 101].map((used) => ({ rate_limit: { primary_window: window(used, 18000, 2_000_000_000) } })), { rate_limit: { primary_window: window(25, 1.5, 2_000_000_000) } }, { rate_limit: { primary_window: window(25, 18000, -1) } }]) {
      const entry = await snapshot(auth(valid), payload);
      expect(entry.kind).toBe('unavailable');
      expect(entry.items).toEqual([]);
      expect(entry.reason).toBe('OpenAI usage response unavailable');
    }
  });

  it('A9 supports integer reset_after_seconds and null reset, with duration labels', async () => {
    const entry = await snapshot(auth(valid), { rate_limit: { primary_window: { used_percent: 0, limit_window_seconds: 3600, reset_after_seconds: 60 }, secondary_window: { used_percent: 100, limit_window_seconds: 90, reset_at: null } } });
    expect(entry.items.map((item) => [item.label, item.remainingFraction])).toEqual([['1m 30s', 0], ['1h', 1]]);
    expect(entry.items[0].resetAt).toBeNull();
    expect(Date.parse(entry.items[1].resetAt!)).toBeGreaterThan(Date.now());
  });

  it('A10 network exceptions produce fixed reasons, never exception text', async () => {
    const entry = await snapshot(auth(valid), new Error('SECRET-EXCEPTION'));
    expect(entry.kind).toBe('unavailable');
    expect(JSON.stringify(entry)).not.toMatch(/SECRET-EXCEPTION|account-123/);
    expect(entry.reason).toBe('OpenAI usage unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('A11 keeps a 60s cache, coalesces concurrent requests and force bypasses cache', async () => {
    await snapshot(auth(valid));
    const { getUsageBudget } = await import('./usage_budget_service');
    fetchMock.mockClear();
    const cached = await getUsageBudget();
    expect(cached.providers[3].kind).toBe('window');
    expect(fetchMock).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([getUsageBudget({ force: true }), getUsageBudget({ force: true })]);
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('A12 rejects absent or invalid reset fields without inventing a numeric item', async () => {
    for (const bad of [-1, 2_000_000_000_000, '2000000000', 0]) {
      const entry = await snapshot(auth(valid), { rate_limit: { primary_window: window(25, 18000, bad) } });
      expect(entry).toMatchObject({ kind: 'unavailable', items: [], reason: 'OpenAI usage response unavailable' });
    }
    const entry = await snapshot(auth(valid), { rate_limit: { primary_window: window(25, 18000, null) } });
    expect(entry.items).toEqual([{ label: '5h limit', remainingFraction: 0.75, resetAt: null }]);
  });

  it('A13 no secrets escape through fresh logger/console on success or each failure branch', async () => {
    const secret = 'SECRET-1568-LOG-MARKER';
    const access = jwt({ exp: Math.floor(Date.now() / 1000) + 3600, chatgpt_account_id: `claim-${secret}` });
    const credential = auth({ ...valid, access, refresh: `refresh-${secret}`, accountId: `account-${secret}` });
    const scenarios = [
      [rawResponse({ rate_limit: { primary_window: body.rate_limit.primary_window }, credits: { balance: `body-${secret}` } }), 'window', undefined],
      [new Error(`error-${secret}`), 'unavailable', 'OpenAI usage unavailable'],
      [new Response(`body-${secret}`, { status: 403, statusText: `status-${secret}` }), 'unavailable', 'OpenAI usage unavailable'],
      [new Response(`<html>body-${secret}</html>`, { headers: { 'content-type': 'text/html' } }), 'unavailable', 'OpenAI usage response unavailable'],
      [new Response(`body-${secret}`, { headers: { 'content-type': 'application/json' } }), 'unavailable', 'OpenAI usage unavailable'],
      [rawResponse({ rate_limit: { primary_window: window(101, 18000, 2_000_000_000) }, credits: `body-${secret}` }), 'unavailable', 'OpenAI usage response unavailable'],
    ] as const;
    for (const [response, kind, reason] of scenarios) {
      const spies: Array<ReturnType<typeof vi.spyOn>> = [];
      const entry = await snapshot(credential, response, async () => {
        const fresh = (await import('../utils/logger')).logger;
        for (const level of ['info', 'warn', 'error'] as const) spies.push(vi.spyOn(fresh, level).mockImplementation(() => undefined));
        for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => undefined));
        fresh.warn('LOGGER-CONTROL');
        console.debug('CONSOLE-CONTROL');
        expect(inspect(spies.map((spy) => spy.mock.calls), { depth: 10 })).toContain('LOGGER-CONTROL');
        expect(inspect(spies.map((spy) => spy.mock.calls), { depth: 10 })).toContain('CONSOLE-CONTROL');
        for (const spy of spies) spy.mockClear();
      });
      try {
        expect(entry.kind).toBe(kind);
        expect(entry.reason).toBe(reason);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const calls = inspect(spies.map((spy) => spy.mock.calls), { depth: 10 });
        // inspect, not JSON.stringify: Error messages and non-enumerable fields remain visible.
        expect(calls).not.toContain(secret);
        expect(calls).not.toContain(access);
        expect(inspect(entry, { depth: 10 })).not.toContain(secret);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    }
  });

  it('A17 reset_after bounds and reset_at precedence produce exact ISO and preserve valid sibling', async () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    for (const seconds of [1, 31_536_000]) {
      const entry = await snapshot(auth(valid), { rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_after_seconds: seconds } } });
      expect(entry.items).toEqual([{ label: '5h limit', remainingFraction: 0.75, resetAt: new Date(now + seconds * 1000).toISOString() }]);
    }
    for (const seconds of [0, -1, 1.5, 31_536_001, NaN, Infinity, -Infinity]) {
      const payload = { rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_after_seconds: seconds }, secondary_window: body.rate_limit.secondary_window } };
      const entry = await snapshot(auth(valid), rawResponse(payload));
      expect(entry.items).toEqual([{ label: 'weekly', remainingFraction: 0.4, resetAt: new Date(2_000_600_000_000).toISOString() }]);
    }
    const entry = await snapshot(auth(valid), { rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 2_000_000_000, reset_after_seconds: -1 } } });
    expect(entry.items[0].resetAt).toBe(new Date(2_000_000_000_000).toISOString());
    for (const reset of [946_684_800, 4_102_444_800]) {
      const edge = await snapshot(auth(valid), { rate_limit: { primary_window: window(25, 18000, reset) } });
      expect(edge.items[0].resetAt).toBe(new Date(reset * 1000).toISOString());
    }
  });

  it('A19 raw numeric window fields reject NaN/infinities and adjacent or fractional reset bounds while preserving a valid sibling', async () => {
    const sibling = body.rate_limit.secondary_window;
    const weekly = { label: 'weekly', remainingFraction: 0.4, resetAt: new Date(2_000_600_000_000).toISOString() };
    const invalid = [
      ...[NaN, Infinity, -Infinity].map((used) => window(used, 18000, 2_000_000_000)),
      ...[NaN, Infinity, -Infinity, 946_684_799, 946_684_800.5, 4_102_444_801].map((reset) => window(25, 18000, reset)),
      ...[NaN, Infinity, -Infinity, 0, -1, 0.5, 31_536_000.5, 31_536_001].map((reset) => ({ used_percent: 25, limit_window_seconds: 18000, reset_after_seconds: reset })),
    ];
    for (const primary_window of invalid) {
      const payload = { rate_limit: { primary_window, secondary_window: sibling } };
      const entry = await snapshot(auth(valid), rawResponse(payload));
      expect(entry).toMatchObject({ kind: 'window', items: [weekly] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const alone = await snapshot(auth(valid), rawResponse({ rate_limit: { primary_window } }));
      expect(alone).toMatchObject({ kind: 'unavailable', items: [], reason: 'OpenAI usage response unavailable' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    for (const reset_at of [946_684_800, 4_102_444_800]) {
      const entry = await snapshot(auth(valid), rawResponse({ rate_limit: { primary_window: window(25, 18000, reset_at) } }));
      expect(entry.items).toEqual([{ label: '5h limit', remainingFraction: 0.75, resetAt: new Date(reset_at * 1000).toISOString() }]);
    }
    const partial = await snapshot(auth(valid), rawResponse({ rate_limit: { primary_window: window(NaN, 18000, 2_000_000_000), secondary_window: sibling } }));
    expect(partial.items).toEqual([weekly]);
  });

  it('A18 cache hit at 59999ms, rebuild at 60001ms, failure replaces success, and expired forced never fetches or serves stale', async () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await snapshot(auth(valid));
    const { getUsageBudget } = await import('./usage_budget_service');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + 59_999);
    expect((await getUsageBudget()).providers[3].kind).toBe('window');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + 60_001);
    expect((await getUsageBudget()).providers[3].kind).toBe('window');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.mocked(readFileSync).mockReturnValue(auth({ ...valid, access: 'malformed' }));
    expect((await getUsageBudget({ force: true })).providers[3]).toMatchObject({ kind: 'unavailable', items: [], reason: 'OpenAI token unavailable' });
    expect((await getUsageBudget()).providers[3].reason).toBe('OpenAI token unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.mocked(readFileSync).mockReturnValue(auth({ ...valid, expires: now - 1 }));
    expect((await getUsageBudget({ force: true })).providers[3]).toMatchObject({ kind: 'unavailable', items: [], reason: 'OpenAI credentials unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('A14 sorts by actual duration and ignores credits, extras and plan claims', async () => {
    const entry = await snapshot(auth(valid), { rate_limit: {
      primary_window: window(10, 604800, 2_000_600_000),
      secondary_window: window(20, 18000, 2_000_000_000),
    }, credits: { balance: 'SECRET-CREDIT' }, additional_rate_limits: [{ used_percent: 100 }], plan_type: 'SECRET-PLAN' });
    expect(entry.items.map((item) => [item.label, item.remainingFraction])).toEqual([['5h limit', 0.8], ['weekly', 0.9]]);
    expect(JSON.stringify(entry)).not.toMatch(/SECRET-CREDIT|SECRET-PLAN|additional_rate_limits/);
  });
});

// #907 — one gauge entry PER connected Anthropic account, not just the
// active/default one. anthropicAccountsService is mocked directly (rather
// than seeding a real accounts-store file) so the test stays independent of
// the host machine's real credential state, same rationale as the
// CredentialsBridgeService mock above.
describe('getUsageBudget — #907 multiple Anthropic accounts', () => {
  it('returns one unavailable provider entry per stored account, each labeled distinctly', async () => {
    vi.resetModules();
    vi.doMock('./anthropic_accounts_service', () => ({
      anthropicAccountsService: {
        listRedacted: () => ({
          accounts: [
            { id: 'acct-personal', label: 'Personal', status: 'needs_relogin' },
            { id: 'acct-team', label: 'Team', status: 'needs_relogin' },
          ],
          defaultAccountId: 'acct-personal',
        }),
        getAccount: () => undefined, // no access token → "needs re-login"
      },
    }));

    const { getUsageBudget: getUsageBudgetWithMock } = await import('./usage_budget_service');
    const snapshot = await getUsageBudgetWithMock({ force: true });

    const anthropicEntries = snapshot.providers.filter((p) => p.provider === 'anthropic');
    expect(anthropicEntries).toHaveLength(2);
    expect(anthropicEntries.map((p) => p.accountId).sort()).toEqual([
      'acct-personal',
      'acct-team',
    ]);
    expect(anthropicEntries.map((p) => p.label).sort()).toEqual([
      'Anthropic — Personal',
      'Anthropic — Team',
    ]);
    for (const entry of anthropicEntries) {
      expect(entry.kind).toBe('unavailable');
      expect(entry.reason).toBe('Account needs re-login');
    }

    vi.doUnmock('./anthropic_accounts_service');
    vi.resetModules();
  });
});
