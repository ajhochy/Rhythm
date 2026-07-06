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

import { describe, it, expect, vi } from 'vitest';

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
