/**
 * Contract tests for issue #844 (tokens-04) — tiered model routing.
 *
 * Wires usage_budget_service into agent_model_resolver as a routing policy:
 * mechanical stages (triage/formatting/extraction/summarization) route to a
 * cheap tier by default, planning/judgment routes to a frontier tier, an
 * explicit override ALWAYS wins, and near-budget providers get downgraded to
 * a cheaper tier with that fact surfaced on the returned decision. Every
 * decision emits exactly one structured, payload-free log line so the #819
 * org audit can measure cost per outcome.
 *
 * These MUST fail on the unmodified codebase: resolveModelTier /
 * resolveTieredModel do not exist yet on agent_model_resolver.ts.
 *
 * Criteria covered: issue-844-c1, issue-844-c2, issue-844-c3, issue-844-c4.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const { listAuthedProviders, getUsageBudget } = vi.hoisted(() => ({
  listAuthedProviders: vi.fn(),
  getUsageBudget: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { listAuthedProviders },
}));

vi.mock('../services/usage_budget_service', () => ({
  getUsageBudget,
}));

import { logger } from '../utils/logger';
import {
  resolveModelTier,
  resolveTieredModel,
  classifyRouteTier,
  TASK_KIND_TIER_POLICY,
} from '../services/agent_model_resolver';

function healthyBudget() {
  return {
    fetchedAt: new Date().toISOString(),
    providers: [
      { provider: 'anthropic', label: 'Anthropic', kind: 'window' as const, items: [
        { label: '5h limit', remainingFraction: 0.9 },
      ] },
      { provider: 'openrouter', label: 'OpenRouter', kind: 'credits' as const, items: [
        { label: 'credits', remainingFraction: 0.9 },
      ] },
    ],
  };
}

function nearBudget(providerId: 'anthropic' | 'openrouter', remainingFraction = 0.05) {
  const snap = healthyBudget();
  const provider = snap.providers.find((p) => p.provider === providerId)!;
  provider.items = provider.items.map((i) => ({ ...i, remainingFraction }));
  return snap;
}

describe('issue-844: tiered model routing', () => {
  beforeEach(() => {
    listAuthedProviders.mockReset();
    getUsageBudget.mockReset();
    getUsageBudget.mockResolvedValue(healthyBudget());
    vi.restoreAllMocks();
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  });

  // issue-844-c1
  describe('issue-844-c1: per-task-kind tier policy with override precedence', () => {
    it('maps mechanical task kinds to the cheap tier', () => {
      for (const kind of ['triage', 'formatting', 'extraction', 'summarization']) {
        expect(TASK_KIND_TIER_POLICY[kind]).toBe('cheap');
        expect(resolveModelTier({ taskKind: kind }).tier).toBe('cheap');
      }
    });

    it('maps judgment task kinds to the frontier tier', () => {
      for (const kind of ['planning', 'judgment']) {
        expect(TASK_KIND_TIER_POLICY[kind]).toBe('frontier');
        expect(resolveModelTier({ taskKind: kind }).tier).toBe('frontier');
      }
    });

    it('an explicit tier hint overrides the task-kind default', () => {
      const decision = resolveModelTier({ taskKind: 'triage', explicitTierHint: 'frontier' });
      expect(decision.tier).toBe('frontier');
      expect(decision.overrideApplied).toBe(true);
    });

    it('classifyRouteTier buckets known model ids into cheap/standard/frontier', () => {
      expect(classifyRouteTier({ providerID: 'anthropic', modelID: 'claude-opus-4-7' })).toBe('frontier');
      expect(classifyRouteTier({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' })).toBe('standard');
      expect(classifyRouteTier({ providerID: 'anthropic', modelID: 'claude-haiku-4-5' })).toBe('cheap');
      expect(classifyRouteTier({ providerID: 'openai', modelID: 'gpt-5.4-mini' })).toBe('cheap');
    });
  });

  // issue-844-c2
  describe('issue-844-c2: budget-aware downgrade', () => {
    it('downgrades to a cheaper tier and surfaces it when the target provider is near budget', async () => {
      listAuthedProviders.mockResolvedValue(['anthropic']);
      getUsageBudget.mockResolvedValue(nearBudget('anthropic', 0.05));

      const decision = await resolveTieredModel({
        agentId: 'claude-code',
        taskKind: 'planning', // would normally resolve to frontier (opus)
      });

      expect(decision.downgradedForBudget).toBe(true);
      expect(decision.reason).toEqual(expect.stringContaining('budget'));
      // Must actually be cheaper than the frontier tier it would have picked.
      expect(decision.tier).not.toBe('frontier');
    });

    it('honors the requested tier when the provider budget is healthy', async () => {
      listAuthedProviders.mockResolvedValue(['anthropic']);
      getUsageBudget.mockResolvedValue(healthyBudget());

      const decision = await resolveTieredModel({
        agentId: 'claude-code',
        taskKind: 'planning',
      });

      expect(decision.downgradedForBudget).toBe(false);
      expect(decision.tier).toBe('frontier');
    });
  });

  // issue-844-c3
  describe('issue-844-c3: structured decision logging with no payloads', () => {
    it('emits exactly one logger.info call with a JSON-parseable, payload-free decision', async () => {
      listAuthedProviders.mockResolvedValue(['anthropic']);
      getUsageBudget.mockResolvedValue(healthyBudget());
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

      await resolveTieredModel({ agentId: 'claude-code', taskKind: 'triage' });

      const routingCalls = infoSpy.mock.calls.filter(([msg]) =>
        typeof msg === 'string' && msg.includes('[ModelRouting]'),
      );
      expect(routingCalls.length).toBe(1);

      const [message] = routingCalls[0];
      const jsonStart = (message as string).indexOf('{');
      expect(jsonStart).toBeGreaterThan(-1);
      const payload = JSON.parse((message as string).slice(jsonStart));

      expect(payload).toEqual(
        expect.objectContaining({
          provider: expect.any(String),
          modelID: expect.any(String),
          tier: expect.any(String),
          taskKind: 'triage',
          reason: expect.any(String),
          downgradedForBudget: expect.any(Boolean),
          overrideApplied: expect.any(Boolean),
        }),
      );

      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/"prompt"|"text"|"messages"/);
    });
  });

  // issue-844-c4
  describe('issue-844-c4: explicit override always wins', () => {
    it('an explicit modelOverride bypasses tier policy AND budget downgrade', async () => {
      listAuthedProviders.mockResolvedValue(['anthropic']);
      // Critically low budget — would otherwise force a downgrade.
      getUsageBudget.mockResolvedValue(nearBudget('anthropic', 0.01));

      const decision = await resolveTieredModel({
        agentId: 'claude-code',
        taskKind: 'triage', // policy would pick cheap
        modelOverride: { providerID: 'anthropic', modelID: 'claude-opus-4-7' },
      });

      expect(decision.route).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4-7' });
      expect(decision.overrideApplied).toBe(true);
      expect(decision.downgradedForBudget).toBe(false);
    });
  });
});
