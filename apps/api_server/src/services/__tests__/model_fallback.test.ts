/**
 * #930 — Unit 1/2 tests: classifier + configurable authed fallback chain.
 * Run: cd apps/api_server && npx vitest run src/services/__tests__/model_fallback.test.ts
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  classifyProviderError,
  FALLBACK_CHAIN,
  parseFallbackChainEnv,
  getConfiguredFallbackChain,
  resolveAuthedFallbackChain,
  nextFallbackTier,
} from '../model_fallback';

describe('classifyProviderError', () => {
  it('classifies 429 and 529 as rate_limit', () => {
    expect(classifyProviderError(429)).toBe('rate_limit');
    expect(classifyProviderError(529)).toBe('rate_limit');
  });

  it('classifies 401/403 as auth', () => {
    expect(classifyProviderError(401)).toBe('auth');
    expect(classifyProviderError(403)).toBe('auth');
  });

  it('classifies everything else as other', () => {
    expect(classifyProviderError(500)).toBe('other');
    expect(classifyProviderError(200)).toBe('other');
    expect(classifyProviderError(400)).toBe('other');
  });
});

describe('FALLBACK_CHAIN', () => {
  it('lists the 6 tiers in the required order', () => {
    expect(FALLBACK_CHAIN.map((t) => t.id)).toEqual([
      'team-claude',
      'personal-claude',
      'codex',
      'gemini',
      'glm-5.2',
      'openrouter-free',
    ]);
  });

  it('maps each tier to a provider id', () => {
    expect(FALLBACK_CHAIN.map((t) => t.providerID)).toEqual([
      'anthropic',
      'anthropic',
      'openai',
      'google',
      'glm',
      'openrouter-free',
    ]);
  });
});

describe('parseFallbackChainEnv', () => {
  it('parses a valid comma-separated tier id list, preserving given order', () => {
    const result = parseFallbackChainEnv('codex,team-claude');
    expect(result?.map((t) => t.id)).toEqual(['codex', 'team-claude']);
  });

  it('drops unknown tier ids', () => {
    const result = parseFallbackChainEnv('team-claude,not-a-real-tier,codex');
    expect(result?.map((t) => t.id)).toEqual(['team-claude', 'codex']);
  });

  it('returns undefined for empty/whitespace input (fail-safe to default)', () => {
    expect(parseFallbackChainEnv(undefined)).toBeUndefined();
    expect(parseFallbackChainEnv('')).toBeUndefined();
    expect(parseFallbackChainEnv('   ')).toBeUndefined();
  });

  it('returns undefined when every token is unknown/malformed', () => {
    expect(parseFallbackChainEnv('bogus,also-bogus')).toBeUndefined();
  });
});

describe('getConfiguredFallbackChain / env override', () => {
  const ORIGINAL = process.env.AGENT_FALLBACK_CHAIN;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AGENT_FALLBACK_CHAIN;
    else process.env.AGENT_FALLBACK_CHAIN = ORIGINAL;
  });

  it('uses the default chain when env is unset', () => {
    delete process.env.AGENT_FALLBACK_CHAIN;
    expect(getConfiguredFallbackChain()).toEqual(FALLBACK_CHAIN);
  });

  it('uses the env override when valid', () => {
    process.env.AGENT_FALLBACK_CHAIN = 'codex,gemini';
    expect(getConfiguredFallbackChain().map((t) => t.id)).toEqual(['codex', 'gemini']);
  });

  it('falls back to default on malformed env', () => {
    process.env.AGENT_FALLBACK_CHAIN = 'nonsense,garbage';
    expect(getConfiguredFallbackChain()).toEqual(FALLBACK_CHAIN);
  });
});

describe('resolveAuthedFallbackChain', () => {
  it('filters out tiers whose provider is not authed, preserving order', () => {
    const authed = resolveAuthedFallbackChain(['anthropic', 'openai']);
    expect(authed.map((t) => t.id)).toEqual(['team-claude', 'personal-claude', 'codex']);
  });

  it('glm-5.2/openrouter-free stay inert against the real authed-provider set (no credential loader exists to ever authorize "glm"/"openrouter-free")', () => {
    // listAuthedProviders() in production can only ever report providers with
    // a real credential loader — anthropic/openai/google/github-copilot/
    // openrouter/ollama/omlx. It can never report 'glm' or 'openrouter-free'
    // literally, so those two tiers are permanently filtered out here.
    const realisticAuthedSet = ['anthropic', 'openai', 'google', 'github-copilot', 'openrouter', 'ollama'];
    const authed = resolveAuthedFallbackChain(realisticAuthedSet);
    expect(authed.map((t) => t.id)).not.toContain('glm-5.2');
    expect(authed.map((t) => t.id)).not.toContain('openrouter-free');
  });

  it('empty authed set yields an empty chain', () => {
    expect(resolveAuthedFallbackChain([])).toEqual([]);
  });
});

describe('nextFallbackTier', () => {
  it('returns the first authed tier when no current tier is given', () => {
    expect(nextFallbackTier(undefined, ['anthropic', 'openai'])?.id).toBe('team-claude');
  });

  it('returns the next authed tier after the current one (team -> personal)', () => {
    expect(nextFallbackTier('team-claude', ['anthropic'])?.id).toBe('personal-claude');
  });

  it('crosses providers when the current provider is exhausted (personal -> codex)', () => {
    expect(nextFallbackTier('personal-claude', ['anthropic', 'openai'])?.id).toBe('codex');
  });

  it('returns undefined when the chain is exhausted', () => {
    expect(nextFallbackTier('gemini', ['anthropic', 'openai', 'google'])).toBeUndefined();
  });

  it('never advances to an unauthed disallowed provider', () => {
    // only anthropic authed — after personal-claude there is no authed next tier
    expect(nextFallbackTier('personal-claude', ['anthropic'])).toBeUndefined();
  });
});
