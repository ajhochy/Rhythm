import { expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('./qualification_fixture_authority', () => ({ loadQualificationFixtureAuthority: () => ({ fixtureRoot: '/private/tmp/qualification-test' }) }));

import { OAuthAccountsStore } from './anthropic_accounts_store';
import { OpenAIAccount, OpenAIAccountsService } from './openai_accounts_service';

it('private qualification never refreshes or adopts an engine token at startup or in its loop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qualification-no-refresh-'));
  const path = join(dir, 'openai-accounts.json'), enginePath = join(dir, 'auth.json');
  const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
  const store = new OAuthAccountsStore<OpenAIAccount>(path);
  const service = new OpenAIAccountsService(store, fetchImpl, enginePath);
  store.upsertAccount({ id: 'qualification-model', label: '[smoke] selected model', access: 'fixture-access', refresh: '',
    expires: Date.now() + 60_000, status: 'ok', chatgptAccountId: 'fixture-workspace' });
  writeFileSync(enginePath, JSON.stringify({ openai: { type: 'oauth', access: 'different-engine-access',
    refresh: 'different-engine-refresh', expires: Date.now() + 3_600_000, accountId: 'fixture-workspace' } }));
  service.syncFromEngine();
  service.startRefreshLoop();
  await service.refreshAll();
  await (service as unknown as { refreshAccount: (account: OpenAIAccount) => Promise<OpenAIAccount | null> }).refreshAccount(store.read().accounts[0]);
  service.stopRefreshLoop();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(JSON.parse(readFileSync(path, 'utf8')).accounts[0]).toMatchObject({ access: 'fixture-access', refresh: '', status: 'ok' });
});
