import { describe, expect, it } from 'vitest';

import { classifyRouteTier } from '../agent_model_resolver';
import { applyScopeToDecision, shouldRouteThisPrompt } from './routing_scope';

const auto = (routerDecidedAt: string | null) => ({ modelMode: 'auto', routerDecidedAt });
const SONNET = { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' };
const OPUS = { providerID: 'anthropic', modelID: 'claude-opus-4-7' };
const HAIKU = { providerID: 'anthropic', modelID: 'claude-haiku-4-5' };
const decide = (o: Partial<Parameters<typeof applyScopeToDecision<typeof SONNET>>[0]>) =>
  applyScopeToDecision({
    scope: 'escalate_only',
    currentRoute: SONNET,
    routedTier: 'frontier',
    confidence: 0.9,
    escalateMin: 0.75,
    classifyRouteTier,
    ...o,
  });

describe('shouldRouteThisPrompt', () => {
  it('first_prompt routes only until a pick is persisted', () => {
    expect(shouldRouteThisPrompt({ scope: 'first_prompt', session: auto(null) })).toBe(true);
    expect(shouldRouteThisPrompt({ scope: 'first_prompt', session: auto('2026-01-01') })).toBe(false);
  });
  it('escalate_only and every_prompt always route', () => {
    for (const scope of ['escalate_only', 'every_prompt'] as const) {
      expect(shouldRouteThisPrompt({ scope, session: auto('2026-01-01') })).toBe(true);
    }
  });
  it('non-auto sessions are not scope managed', () => {
    expect(
      shouldRouteThisPrompt({ scope: 'first_prompt', session: { modelMode: 'fixed', routerDecidedAt: 'x' } }),
    ).toBe(true);
  });
});

describe('applyScopeToDecision', () => {
  it('first_prompt and every_prompt apply', () => {
    expect(decide({ scope: 'first_prompt', routedTier: 'cheap' }).apply).toBe(true);
    expect(decide({ scope: 'every_prompt', routedTier: 'cheap' }).apply).toBe(true);
  });
  it('escalate_only applies a strictly higher, confident tier', () => {
    expect(decide({}).apply).toBe(true);
    expect(decide({ currentRoute: HAIKU, routedTier: 'standard' }).apply).toBe(true);
    expect(decide({ confidence: 0.75 }).apply).toBe(true);
  });
  it('escalate_only needs confidence >= escalateMin', () => {
    expect(decide({ confidence: 0.7 })).toEqual({ apply: false, reason: 'below_escalate_confidence' });
  });
  it('escalate_only never downgrades or re-applies the same tier', () => {
    expect(decide({ currentRoute: OPUS, routedTier: 'cheap' }).apply).toBe(false);
    expect(decide({ currentRoute: OPUS, routedTier: 'standard' }).apply).toBe(false);
    expect(decide({ routedTier: 'standard' })).toEqual({ apply: false, reason: 'not_higher' });
    expect(decide({ currentRoute: OPUS, routedTier: 'frontier' }).apply).toBe(false);
  });
});
