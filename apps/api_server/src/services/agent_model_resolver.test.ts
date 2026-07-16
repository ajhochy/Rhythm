/**
 * Unit tests for the #844 tiered-routing pure helpers in agent_model_resolver.
 *
 * These are narrower/faster than the AC-mapped issue_844_contract.test.ts
 * suite (see src/__tests__/issue_844_contract.test.ts for the full
 * criteria-to-test mapping) — this file exists so
 * `npx vitest run agent_model_resolver` (the issue's validation command)
 * matches a real test file and exercises the pure classification/tier-policy
 * logic in isolation from the async budget/auth plumbing.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyRouteTier,
  resolveModelTier,
  TASK_KIND_TIER_POLICY,
  ROUTE_FALLBACKS_BY_AGENT,
  type ModelTier,
} from './agent_model_resolver';

describe('classifyRouteTier', () => {
  it('classifies opus-family and "pro" models as frontier', () => {
    expect(classifyRouteTier({ providerID: 'anthropic', modelID: 'claude-opus-4-7' })).toBe('frontier');
    expect(classifyRouteTier({ providerID: 'google', modelID: 'gemini-2.5-pro' })).toBe('frontier');
    expect(classifyRouteTier({ providerID: 'openai', modelID: 'gpt-5.3-codex' })).toBe('frontier');
    expect(classifyRouteTier({ providerID: 'openai', modelID: 'gpt-5.6-sol' })).toBe('frontier');
  });

  it('classifies haiku/mini/flash/qwen models as cheap', () => {
    expect(classifyRouteTier({ providerID: 'anthropic', modelID: 'claude-haiku-4-5' })).toBe('cheap');
    expect(classifyRouteTier({ providerID: 'openai', modelID: 'gpt-5.4-mini' })).toBe('cheap');
    expect(classifyRouteTier({ providerID: 'google', modelID: 'gemini-2.5-flash' })).toBe('cheap');
    expect(classifyRouteTier({ providerID: 'ollama', modelID: 'qwen3.6-work' })).toBe('cheap');
  });

  it('classifies everything else (e.g. sonnet, gpt-5.4) as standard', () => {
    expect(classifyRouteTier({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' })).toBe('standard');
    expect(classifyRouteTier({ providerID: 'openai', modelID: 'gpt-5.4' })).toBe('standard');
  });

  it('every currently-configured route classifies into exactly one known tier', () => {
    const knownTiers: ModelTier[] = ['cheap', 'standard', 'frontier'];
    for (const routes of Object.values(ROUTE_FALLBACKS_BY_AGENT)) {
      for (const route of routes) {
        expect(knownTiers).toContain(classifyRouteTier(route));
      }
    }
  });
});

describe('resolveModelTier', () => {
  it('defaults to standard when neither a task kind nor a tier hint is given', () => {
    expect(resolveModelTier({}).tier).toBe('standard');
    expect(resolveModelTier({}).overrideApplied).toBe(false);
  });

  it('falls back to standard for an unrecognized task kind', () => {
    const decision = resolveModelTier({ taskKind: 'not-a-real-kind' });
    expect(decision.tier).toBe('standard');
    expect(decision.overrideApplied).toBe(false);
  });

  it('every TASK_KIND_TIER_POLICY entry round-trips through resolveModelTier', () => {
    for (const [kind, tier] of Object.entries(TASK_KIND_TIER_POLICY)) {
      expect(resolveModelTier({ taskKind: kind }).tier).toBe(tier);
    }
  });

  it('an explicit tier hint wins over a conflicting task-kind default', () => {
    const decision = resolveModelTier({ taskKind: 'planning', explicitTierHint: 'cheap' });
    expect(decision.tier).toBe('cheap');
    expect(decision.overrideApplied).toBe(true);
  });
});
