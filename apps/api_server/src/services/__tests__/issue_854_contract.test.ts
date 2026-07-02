/**
 * Contract tests for issue #854 — resolveModelForSessionTurn ignores
 * agent_configs, stalling custom agents.
 *
 * Bug: resolveModelForSessionTurn's precedence today is
 *   per-turn override -> session pin -> resolveModelForAgent(agentId)
 * where resolveModelForAgent only knows the STATIC ROUTE_FALLBACKS_BY_AGENT
 * table (claude-code/codex/gemini-cli/opencode). A configured custom agent
 * (e.g. 'secretary', authed anthropic/claude-sonnet-4-6 in agent_configs)
 * with no session pin resolves to `undefined`, and ws_gateway then aborts the
 * turn with "no route in catalog" — the session hangs forever.
 *
 * Fix under test: insert a new step 3 that reads agent_configs.model_provider
 * / model_id for the agentId, verified against the live auth/catalog, BEFORE
 * falling through to the static fallback (now step 4).
 *
 * See docs/ai/contracts/issue-854.json for the full criteria-to-test mapping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGetById, mockListAuthedProviders } = vi.hoisted(() => ({
  mockGetById: vi.fn(),
  mockListAuthedProviders: vi.fn(),
}));

vi.mock('../opencode_engine', () => ({
  opencodeClient: {
    listAuthedProviders: mockListAuthedProviders,
  },
}));

vi.mock('../../repositories/agent_configs_repository', () => ({
  AgentConfigsRepository: class {
    getById = mockGetById;
  },
}));

import {
  resolveModelForSessionTurn,
  setAgentConfigsRepositoryForTest,
} from '../agent_model_resolver';

describe('issue-854 — resolveModelForSessionTurn reads agent_configs before the static fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetById.mockReturnValue(null);
    mockListAuthedProviders.mockResolvedValue(['anthropic']);
    // Reset the mockable repo getter to its default (module-level) each test
    // unless a test overrides it explicitly.
    setAgentConfigsRepositoryForTest(undefined);
  });

  it('issue-854-c1: secretary with agent_configs model, no session pin, no override -> resolves to agent_configs model', async () => {
    // Regression this catches: if the new agent_configs lookup step is
    // removed/skipped, this assertion fails because the resolver falls
    // through to resolveModelForAgent('secretary') -> undefined (secretary
    // is not a key in the static ROUTE_FALLBACKS_BY_AGENT table).
    mockGetById.mockReturnValue({
      id: 'secretary',
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    });
    mockListAuthedProviders.mockResolvedValue(['anthropic']);

    const result = await resolveModelForSessionTurn({
      agentId: 'secretary',
      sessionProviderId: null,
      sessionModelId: null,
      perTurnOverride: null,
    });

    expect(result).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' });
  });

  it('issue-854-c2: agent_configs model not authed -> falls through to resolveModelForAgent static fallback', async () => {
    // Regression this catches: if the resolver blindly trusts the
    // agent_configs model without verifying auth/catalog state, it would
    // return a dead route (e.g. an unauthenticated provider) instead of
    // falling through to a route the user can actually use.
    mockGetById.mockReturnValue({
      id: 'claude-code',
      modelProvider: 'openai', // configured, but NOT authed below
      modelId: 'gpt-5.4',
    });
    mockListAuthedProviders.mockResolvedValue(['anthropic']); // openai NOT authed

    const result = await resolveModelForSessionTurn({
      agentId: 'claude-code',
      sessionProviderId: null,
      sessionModelId: null,
      perTurnOverride: null,
    });

    // Falls through to resolveModelForAgent('claude-code'), which picks the
    // first authed route in ROUTE_FALLBACKS_BY_AGENT['claude-code'] — the
    // 'anthropic' entries, since 'anthropic' is in the authed set.
    expect(result?.providerID).toBe('anthropic');
  });

  it('issue-854-c3a: per-turn override still wins over the agent_configs model', async () => {
    mockGetById.mockReturnValue({
      id: 'secretary',
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    });

    const result = await resolveModelForSessionTurn({
      agentId: 'secretary',
      sessionProviderId: null,
      sessionModelId: null,
      perTurnOverride: { providerId: 'openai', modelId: 'gpt-5.4' },
    });

    expect(result).toEqual({ providerID: 'openai', modelID: 'gpt-5.4' });
    // Override must win WITHOUT ever consulting agent_configs.
    expect(mockGetById).not.toHaveBeenCalled();
  });

  it('issue-854-c3b: session pin still wins over the agent_configs model', async () => {
    mockGetById.mockReturnValue({
      id: 'secretary',
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    });

    const result = await resolveModelForSessionTurn({
      agentId: 'secretary',
      sessionProviderId: 'openai',
      sessionModelId: 'gpt-5.4',
      perTurnOverride: null,
    });

    expect(result).toEqual({ providerID: 'openai', modelID: 'gpt-5.4' });
    expect(mockGetById).not.toHaveBeenCalled();
  });

  it('issue-854-c4a: base kind with no agent_configs model resolves exactly as before (static fallback)', async () => {
    // No agent_configs row / no model_provider+model_id set -> must fall
    // through to resolveModelForAgent unchanged.
    mockGetById.mockReturnValue({ id: 'claude-code', modelProvider: null, modelId: null });
    mockListAuthedProviders.mockResolvedValue(['anthropic']);

    const result = await resolveModelForSessionTurn({
      agentId: 'claude-code',
      sessionProviderId: null,
      sessionModelId: null,
      perTurnOverride: null,
    });

    expect(result?.providerID).toBe('anthropic');
    expect(result?.modelID).toBe('claude-opus-4-7');
  });

  it('issue-854-c4b: workflow-orchestrator (no agent_configs model) resolves exactly as before (undefined — not in static table)', async () => {
    mockGetById.mockReturnValue({ id: 'workflow-orchestrator', modelProvider: null, modelId: null });

    const result = await resolveModelForSessionTurn({
      agentId: 'workflow-orchestrator',
      sessionProviderId: null,
      sessionModelId: null,
      perTurnOverride: null,
    });

    // workflow-orchestrator is not a key in ROUTE_FALLBACKS_BY_AGENT, and its
    // agent_configs row (per this test) carries no model preference, so the
    // resolver must still surface `undefined` exactly as it did before #854
    // (ws_gateway's undefined-model guard is the caller's safety net).
    expect(result).toBeUndefined();
  });

  it('issue-854-c6: agent_configs lookup throwing does not propagate — falls through to static fallback', async () => {
    // Regression this catches: a DB hiccup on the new lookup step must never
    // hang a turn. If the resolver forgets to catch, this test throws
    // instead of resolving.
    mockGetById.mockImplementation(() => {
      throw new Error('db unavailable');
    });
    mockListAuthedProviders.mockResolvedValue(['anthropic']);

    const result = await resolveModelForSessionTurn({
      agentId: 'claude-code',
      sessionProviderId: null,
      sessionModelId: null,
      perTurnOverride: null,
    });

    expect(result?.providerID).toBe('anthropic');
    expect(result?.modelID).toBe('claude-opus-4-7');
  });

  it('issue-854-c6b: an unknown agentId with no agent_configs row falls through cleanly', async () => {
    mockGetById.mockReturnValue(null);

    const result = await resolveModelForSessionTurn({
      agentId: 'totally-unknown-agent',
      sessionProviderId: null,
      sessionModelId: null,
      perTurnOverride: null,
    });

    expect(result).toBeUndefined();
  });
});
