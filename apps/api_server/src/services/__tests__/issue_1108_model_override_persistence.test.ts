/**
 * Contract tests for issue #1108 — a successful model-override selection
 * (manual, via the WS per-turn `modelOverride` field) must PERSIST across
 * subsequent prompts instead of silently reverting on the very next turn.
 *
 * Root cause (confirmed by tracing ws_gateway.ts + agent_model_resolver.ts +
 * turn_redispatch.ts): the AUTOMATIC cross-provider handoff
 * (turn_redispatch.ts's `persistDecision`) already wrote its choice onto
 * `agent_sessions.provider_id`/`model_id` — that half worked. A MANUAL
 * per-turn override picked by the user never got written back anywhere; it
 * applied to exactly one `resolveModelForSessionTurn` call and was then gone,
 * so the NEXT prompt (no override on that frame) fell through to the still-
 * stale session-pinned provider/model — reproducing the original
 * usage-limit error every time.
 *
 * Fix under test: resolveModelForSessionTurn now accepts an optional
 * `sessionId`; when a real per-turn override is used AND it differs from the
 * session's currently-known provider/model, it persists the override onto
 * that session row via AgentSessionsRepository.updateFields BEFORE returning.
 * Omitting `sessionId` (every pre-#1108 caller/test) preserves the exact old
 * behavior — no persistence side effect at all.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockUpdateFields, mockGetById, mockListAuthedProviders } = vi.hoisted(() => ({
  mockUpdateFields: vi.fn(),
  mockGetById: vi.fn(),
  mockListAuthedProviders: vi.fn(),
}));

vi.mock('../opencode_engine', () => ({
  opencodeClient: { listAuthedProviders: mockListAuthedProviders },
}));

vi.mock('../../repositories/agent_configs_repository', () => ({
  AgentConfigsRepository: class {
    getById = mockGetById;
  },
}));

vi.mock('../../repositories/agent_sessions_repository', () => ({
  AgentSessionsRepository: class {
    updateFields = mockUpdateFields;
  },
}));

import { resolveModelForSessionTurn } from '../agent_model_resolver';

describe('issue-1108 — manual per-turn model override persists across subsequent prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetById.mockReturnValue(null);
    mockListAuthedProviders.mockResolvedValue(['anthropic', 'openai']);
  });

  it('persists a real override onto the session row when sessionId is provided and it differs from the stored model', async () => {
    const result = await resolveModelForSessionTurn({
      agentId: 'secretary',
      sessionProviderId: 'anthropic',
      sessionModelId: 'claude-sonnet-4-6',
      perTurnOverride: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
      sessionId: 'session-1',
    });

    expect(result).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' });
    expect(mockUpdateFields).toHaveBeenCalledTimes(1);
    expect(mockUpdateFields).toHaveBeenCalledWith('session-1', {
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
    });
  });

  it('the NEXT call with NO override reads the just-persisted model, not the original stale one — the actual behavior the bug was about', async () => {
    // Turn 1: user manually overrides to a working OpenAI model.
    let store = { providerId: 'anthropic' as string | null, modelId: 'claude-sonnet-4-6' as string | null };
    mockUpdateFields.mockImplementation((_id: string, fields: { providerId?: string; modelId?: string }) => {
      if (fields.providerId !== undefined) store.providerId = fields.providerId;
      if (fields.modelId !== undefined) store.modelId = fields.modelId;
    });

    const turn1 = await resolveModelForSessionTurn({
      agentId: 'secretary',
      sessionProviderId: store.providerId,
      sessionModelId: store.modelId,
      perTurnOverride: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
      sessionId: 'session-2',
    });
    expect(turn1).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' });

    // Turn 2: NO override on this frame (mirrors a normal follow-up message) —
    // ws_gateway re-reads the session row fresh, which now reflects turn 1's write.
    const turn2 = await resolveModelForSessionTurn({
      agentId: 'secretary',
      sessionProviderId: store.providerId,
      sessionModelId: store.modelId,
      perTurnOverride: null,
      sessionId: 'session-2',
    });
    expect(turn2).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' });

    // Turn 3: same again — sticky, not a one-shot.
    const turn3 = await resolveModelForSessionTurn({
      agentId: 'secretary',
      sessionProviderId: store.providerId,
      sessionModelId: store.modelId,
      perTurnOverride: null,
      sessionId: 'session-2',
    });
    expect(turn3).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' });
  });

  it('does not persist when the override matches the already-stored model (no-op write avoidance)', async () => {
    const result = await resolveModelForSessionTurn({
      agentId: 'secretary',
      sessionProviderId: 'openai',
      sessionModelId: 'gpt-5.6-sol',
      perTurnOverride: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
      sessionId: 'session-3',
    });
    expect(result).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' });
    expect(mockUpdateFields).not.toHaveBeenCalled();
  });

  it('never persists when sessionId is omitted — exact pre-#1108 behavior preserved for callers that do not opt in', async () => {
    const result = await resolveModelForSessionTurn({
      agentId: 'secretary',
      sessionProviderId: 'anthropic',
      sessionModelId: 'claude-sonnet-4-6',
      perTurnOverride: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
    });
    expect(result).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' });
    expect(mockUpdateFields).not.toHaveBeenCalled();
  });

  it('a persistence failure never breaks the turn — override still applies to this call', async () => {
    mockUpdateFields.mockImplementation(() => {
      throw new Error('DB unavailable');
    });
    const result = await resolveModelForSessionTurn({
      agentId: 'secretary',
      sessionProviderId: 'anthropic',
      sessionModelId: 'claude-sonnet-4-6',
      perTurnOverride: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
      sessionId: 'session-4',
    });
    expect(result).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' });
  });
});
