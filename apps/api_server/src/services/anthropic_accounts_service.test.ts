import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AnthropicAccountsStore } from './anthropic_accounts_store';
import { AnthropicAccountsService } from './anthropic_accounts_service';

function makeService(fetchImpl: typeof fetch) {
  const store = new AnthropicAccountsStore(join(mkdtempSync(join(tmpdir(), 'acctsvc-')), 'accounts.json'));
  return { store, service: new AnthropicAccountsService(store, fetchImpl) };
}

describe('AnthropicAccountsService', () => {
  it('listRedacted never exposes tokens', () => {
    const { store, service } = makeService(vi.fn() as unknown as typeof fetch);
    store.upsertAccount({ id: 't', label: 'T', access: 'SECRET', refresh: 'SECRET2', expires: 1, status: 'ok' });
    const out = service.listRedacted();
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(out.accounts[0]).toMatchObject({ id: 't', label: 'T', status: 'ok' });
  });

  it('refreshAll refreshes accounts within the expiry buffer and persists rotation', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'newA', refresh_token: 'newR', expires_in: 3600 }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const { store, service } = makeService(fetchImpl);
    store.upsertAccount({ id: 't', label: 'T', access: 'old', refresh: 'oldR', expires: Date.now() + 1000, status: 'ok' });
    await service.refreshAll();
    const acct = store.read().accounts[0];
    expect(acct.access).toBe('newA');
    expect(acct.refresh).toBe('newR');
    expect(acct.status).toBe('ok');
  });

  it('refreshAll skips fresh accounts', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { store, service } = makeService(fetchImpl);
    store.upsertAccount({ id: 't', label: 'T', access: 'a', refresh: 'r', expires: Date.now() + 24 * 3600_000, status: 'ok' });
    await service.refreshAll();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refreshAll marks needs_relogin on refresh failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 400 })) as unknown as typeof fetch;
    const { store, service } = makeService(fetchImpl);
    store.upsertAccount({ id: 't', label: 'T', access: 'a', refresh: 'r', expires: Date.now() - 1, status: 'ok' });
    await service.refreshAll();
    expect(store.read().accounts[0].status).toBe('needs_relogin');
  });

  it('migrateFromClaudeCode imports creds only when store is empty', () => {
    const { store, service } = makeService(vi.fn() as unknown as typeof fetch);
    const imported = service.migrateFromClaudeCode({ access: 'a', refresh: 'r', expires: 99, subscriptionType: 'max' });
    expect(imported).toBe(true);
    expect(store.read().accounts[0]).toMatchObject({ id: 'default', label: 'Default (from Claude Code)' });
    expect(service.migrateFromClaudeCode({ access: 'x', refresh: 'y', expires: 1 })).toBe(false);
  });
});
