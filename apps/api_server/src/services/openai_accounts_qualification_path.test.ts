import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OAuthAccountsStore } from './anthropic_accounts_store';

const authority = vi.hoisted(() => ({
  value: null as null | { fixtureRoot: string; syntheticActor?: { modelLoan?: object } },
}));
vi.mock('./qualification_fixture_authority', () => ({
  loadQualificationFixtureAuthority: () => authority.value,
}));

import { OpenAIAccountsService, type OpenAIAccount, type OpenAIEngine } from './openai_accounts_service';

describe('qualification OpenAI account source', () => {
  it('rejects an out-of-fixture store before any account read or SDK credential write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rhythm-openai-path-'));
    const store = new OAuthAccountsStore<OpenAIAccount>(join(root, 'unbound-accounts.json'));
    const read = vi.spyOn(store, 'read');
    const write = vi.fn().mockResolvedValue(true);
    const engine = { isReady: false, setOAuthCredentials: write, removeAuth: vi.fn() } as OpenAIEngine;
    authority.value = { fixtureRoot: root, syntheticActor: { modelLoan: {} } };
    try {
      const service = new OpenAIAccountsService(store, vi.fn() as unknown as typeof fetch, join(root, 'auth.json'));
      await expect(service.seedDefaultBeforeReady(engine)).rejects.toThrow('Qualification OpenAI account source unavailable');
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally {
      authority.value = null;
    }
  });

  it('does not inspect any account store for a qualification actor without a model loan', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rhythm-openai-path-'));
    const store = new OAuthAccountsStore<OpenAIAccount>(join(root, 'openai-accounts.json'));
    const read = vi.spyOn(store, 'read');
    const engine = { isReady: false, setOAuthCredentials: vi.fn(), removeAuth: vi.fn() } as OpenAIEngine;
    authority.value = { fixtureRoot: root, syntheticActor: {} };
    try {
      const service = new OpenAIAccountsService(store, vi.fn() as unknown as typeof fetch, join(root, 'auth.json'));
      expect(await service.seedDefaultBeforeReady(engine)).toBe('absent');
      expect(read).not.toHaveBeenCalled();
      expect(engine.setOAuthCredentials).not.toHaveBeenCalled();
    } finally {
      authority.value = null;
    }
  });
});
