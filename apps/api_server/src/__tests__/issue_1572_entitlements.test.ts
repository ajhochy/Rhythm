import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

const { snapshot, config, usageBudget } = vi.hoisted(() => ({
  snapshot: vi.fn(),
  config: vi.fn(() => JSON.stringify({ provider: {} })),
  usageBudget: vi.fn(),
}));

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    readFileSync: (path: string, ...args: unknown[]) =>
      path.endsWith('/.config/opencode/opencode.json')
        ? config()
        : (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...args),
  };
});

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    providerSnapshot: snapshot,
    listAuthedProviders: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../services/usage_budget_service', () => ({
  getUsageBudget: usageBudget,
}));

import { listAgentModelCatalog } from '../routes/agents_models_routes';

const capable = { input: { text: true }, output: { text: true }, toolcall: true };
const model = (id: string) => ({ id, capabilities: capable });
const provider = (id: string, ids: string[]) => ({
  id,
  connected: true,
  digest: `${id}-digest`,
  models: ids.map(model),
});

function makeDb(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
}

describe('issue #1572 account-aware entitlements and computed curation', () => {
  beforeEach(() => {
    makeDb();
    vi.clearAllMocks();
    config.mockReturnValue(JSON.stringify({ provider: {} }));
    usageBudget.mockResolvedValue({ providers: [], fetchedAt: '2026-09-25T00:00:00.000Z' });
  });

  it('1572:1572-S2:1 selects only the newest canonical Anthropic version per active family', async () => {
    snapshot.mockResolvedValue({ providers: [provider('anthropic', [
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-opus-4-8-1m',
      'claude-sonnet-4-5',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-6-fast',
      'claude-opus-4-7-think',
    ])] });

    const ids = (await listAgentModelCatalog())
      .filter((row) => row.provider === 'anthropic')
      .map((row) => row.modelId);
    expect(ids).toEqual([
      'claude-opus-4-8',
      'claude-opus-4-8-1m',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ]);
  });

  it('1572:1572-S2:2 parses new Anthropic families and one-part major versions without a hard-coded family enum', async () => {
    snapshot.mockResolvedValue({ providers: [provider('anthropic', [
      'claude-fable-5',
      'claude-fable-5-1',
      'claude-sonnet-4-6',
      'claude-sonnet-5',
      'claude-opus-5',
      'claude-opus-5-5',
      'claude-sonnet-4-20250514',
    ])] });

    const ids = (await listAgentModelCatalog())
      .filter((row) => row.provider === 'anthropic')
      .map((row) => row.modelId);
    expect(ids).toEqual([
      'claude-fable-5-1',
      'claude-sonnet-5',
      'claude-opus-5-5',
    ]);
  });

  it('review:review-findings.md:130 ranks semantic Anthropic versions above dated snapshots', async () => {
    snapshot.mockResolvedValue({ providers: [provider('anthropic', [
      'claude-sonnet-4-20250514',
      'claude-sonnet-4-6',
    ])] });

    expect((await listAgentModelCatalog())
      .filter((row) => row.provider === 'anthropic')
      .map((row) => row.modelId))
      .toEqual(['claude-sonnet-4-6']);
  });

  it('review:review-findings.md:130 curates dotted Copilot IDs and excludes unrelated noise', async () => {
    snapshot.mockResolvedValue({ providers: [provider('github-copilot', [
      'claude-opus-4.7',
      'claude-opus-5.5',
      'claude-sonnet-5',
      'claude-haiku-4.5',
      'gpt-5.6-sol',
      'gpt-5-mini',
      'gpt-4.1',
      'grok-code-fast-1',
      'gemini-2.5-pro',
    ])] });

    expect((await listAgentModelCatalog())
      .filter((row) => row.provider === 'github-copilot')
      .map((row) => row.modelId))
      .toEqual([
        'claude-opus-5.5',
        'claude-sonnet-5',
        'claude-haiku-4.5',
        'gpt-5.6-sol',
        'gpt-5-mini',
        'gemini-2.5-pro',
      ]);
  });

  it('review:review-findings.md:130 keeps local and custom gpt-oss models on opencode and preserves variant labels', async () => {
    snapshot.mockResolvedValue({ providers: [
      provider('ollama', ['qwen3.6-work', 'gpt-oss:20b']),
      { ...provider('glm-mesh', ['gpt-oss:120b']), connected: false, endpoint: 'http://glm.ts.net:8000' },
      provider('anthropic', ['claude-opus-4-8', 'claude-opus-4-8-1m']),
      provider('openrouter', ['anthropic/claude-sonnet-4.6']),
    ] });
    config.mockReturnValue(JSON.stringify({ provider: {
      ollama: { models: { 'qwen3.6-work': {}, 'gpt-oss:20b': {} } },
      'glm-mesh': {
        options: { baseURL: 'http://glm.ts.net:8000/v1' },
        models: { 'gpt-oss:120b': {} },
      },
    } }));

    const rows = await listAgentModelCatalog();
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: 'opencode', provider: 'ollama', modelId: 'gpt-oss:20b' }),
      expect.objectContaining({ agent: 'opencode', provider: 'glm-mesh', modelId: 'gpt-oss:120b', available: 'unknown' }),
      expect.objectContaining({ agent: 'opencode', provider: 'ollama', modelId: 'qwen3.6-work', variantLabel: 'Local' }),
      expect.objectContaining({ agent: 'claude-code', provider: 'anthropic', modelId: 'claude-opus-4-8-1m', variantLabel: '1M context' }),
      expect.objectContaining({ agent: 'opencode', provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.6' }),
    ]));
  });

  it('1572:1572-S2:3 applies validated OpenAI model_usage entitlements and leaves missing keys unknown', async () => {
    snapshot.mockResolvedValue({ providers: [provider('openai', [
      'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra',
    ])] });
    usageBudget.mockResolvedValue({ providers: [{
      provider: 'openai', label: 'OpenAI', kind: 'window', items: [],
      entitledModels: { 'gpt-5.6-sol': true, 'gpt-5.6-luna': false },
    }], fetchedAt: '2026-09-25T00:00:00.000Z' });

    const rows = (await listAgentModelCatalog()).filter((row) => row.provider === 'openai');
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'gpt-5.6-sol', available: true, availabilityReason: 'available' }),
      expect.objectContaining({ modelId: 'gpt-5.6-luna', available: false, availabilityReason: 'account_not_entitled' }),
      expect.objectContaining({ modelId: 'gpt-5.6-terra', available: 'unknown', availabilityReason: 'account_entitlement_unverified' }),
    ]));
  });

  it.each([
    undefined,
    { malformed: true },
    { 'gpt-5.6-sol': { available: true } },
  ])('1572:1572-S2:4 treats missing or malformed OpenAI model_usage as wholly unknown: %o', async (entitledModels) => {
    snapshot.mockResolvedValue({ providers: [provider('openai', [
      'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra',
    ])] });
    usageBudget.mockResolvedValue({ providers: [{
      provider: 'openai', label: 'OpenAI', kind: 'window', items: [], entitledModels,
    }], fetchedAt: '2026-09-25T00:00:00.000Z' });

    const rows = (await listAgentModelCatalog()).filter((row) => row.provider === 'openai');
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.available === 'unknown')).toBe(true);
  });

  it('1572:1572-S2:5 intersects Gemini quota labels with eligible chat models and rejects other current-chat rows', async () => {
    snapshot.mockResolvedValue({ providers: [provider('google', [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-3-flash-preview',
      'gemini-3-image-preview',
      'gemini-tts-preview',
      'text-embedding-004',
    ])] });
    usageBudget.mockResolvedValue({ providers: [{
      provider: 'gemini', label: 'Gemini', kind: 'quota', items: [
        { label: 'gemini-2.5-pro', remainingFraction: 0.8 },
        { label: 'gemini-3-flash-preview', remainingFraction: 0.7 },
      ],
    }], fetchedAt: '2026-09-25T00:00:00.000Z' });

    const rows = (await listAgentModelCatalog()).filter((row) => row.provider === 'google');
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'gemini-2.5-pro', available: true }),
      expect.objectContaining({ modelId: 'gemini-3-flash-preview', available: true }),
      expect.objectContaining({ modelId: 'gemini-2.5-flash', available: false, availabilityReason: 'account_not_entitled' }),
    ]));
    expect(rows.some((row) => /(?:image|tts|embedding)/i.test(row.modelId))).toBe(false);
  });

  it('1572:1572-S2:6 falls back to approved Gemini chat models with unknown availability when quota is unavailable', async () => {
    snapshot.mockResolvedValue({ providers: [provider('google', [
      'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-image-preview',
    ])] });
    usageBudget.mockResolvedValue({ providers: [{
      provider: 'gemini', label: 'Gemini', kind: 'unavailable', items: [], reason: 'synthetic unavailable',
    }], fetchedAt: '2026-09-25T00:00:00.000Z' });

    const rows = (await listAgentModelCatalog()).filter((row) => row.provider === 'google');
    expect(rows.map((row) => row.modelId)).toEqual([
      'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-flash-preview',
    ]);
    expect(rows.every((row) => row.available === 'unknown')).toBe(true);
  });

  it('1572:1572-S2:7 reads only cached usage data and emits no token, account id, or secret-bearing reason', async () => {
    snapshot.mockResolvedValue({ providers: [provider('openai', ['gpt-5.6-sol'])] });
    usageBudget.mockResolvedValue({ providers: [{
      provider: 'openai', label: 'OpenAI', kind: 'window', items: [],
      accountId: 'account-secret-sentinel', entitledModels: { 'gpt-5.6-sol': true },
    }], fetchedAt: '2026-09-25T00:00:00.000Z' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('catalog must not fetch'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const rows = await listAgentModelCatalog();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(usageBudget).toHaveBeenCalledWith({ cachedOnly: true });
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain('account-secret-sentinel');
      expect(serialized).not.toMatch(/token|api[_-]?key|account[_-]?id/i);
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});
