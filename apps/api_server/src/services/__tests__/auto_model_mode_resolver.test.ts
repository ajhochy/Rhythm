/**
 * Auto (router) model mode — resolver contract.
 *
 * - auto + echoed override (session's stored model or the profile model): ignored,
 *   NOT persisted, requestedSource 'auto'.
 * - auto + different override: explicit turn choice, requestedSource 'turn_override',
 *   never persisted.
 * - auto + no override: requestedSource 'auto', route = session ?? profile ?? agent default.
 * - fixed / undefined: legacy behaviour unchanged (incl. #1108 persistence).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockUpdateFields, mockGetById, mockListAuthedProviders } = vi.hoisted(() => ({
  mockUpdateFields: vi.fn(),
  mockGetById: vi.fn(),
  mockListAuthedProviders: vi.fn(),
}));

vi.mock('../opencode_engine', () => ({
  opencodeClient: { listAuthedProviders: mockListAuthedProviders, isProviderInAuthStore: () => true },
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

import {
  resolveModelForSessionTurn,
  resolveModelForSessionTurnWithProvenance,
} from '../agent_model_resolver';

const SONNET = { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' };
const GPT = { providerId: 'openai', modelId: 'gpt-5.6-sol' };
const PROFILE = { providerId: 'anthropic', modelId: 'claude-opus-4-7' };

const base = {
  agentId: 'secretary',
  sessionProviderId: SONNET.providerId,
  sessionModelId: SONNET.modelId,
  sessionId: 's1',
};

describe('Auto (router) model mode — resolveSessionTurnBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetById.mockReturnValue(null);
    mockListAuthedProviders.mockResolvedValue(['anthropic', 'openai']);
  });

  it("auto with no override returns source 'auto' and the stored session model", async () => {
    const r = await resolveModelForSessionTurnWithProvenance({ ...base, sessionModelMode: 'auto' });
    expect(r.requestedSource).toBe('auto');
    expect(r.route).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' });
  });

  it("auto with no stored model falls back to the profile model, still source 'auto'", async () => {
    mockGetById.mockReturnValue({ modelProvider: PROFILE.providerId, modelId: PROFILE.modelId });
    const r = await resolveModelForSessionTurnWithProvenance({
      ...base,
      sessionProviderId: null,
      sessionModelId: null,
      sessionModelMode: 'auto',
    });
    expect(r.requestedSource).toBe('auto');
    expect(r.route).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4-7' });
  });

  it("auto with nothing stored resolves the agent default under source 'auto'", async () => {
    const r = await resolveModelForSessionTurnWithProvenance({
      agentId: 'claude-code',
      sessionProviderId: null,
      sessionModelId: null,
      sessionModelMode: 'auto',
    });
    expect(r.requestedSource).toBe('auto');
    expect(r.route).toBeDefined();
  });

  it('auto: override equal to the stored session model is an echo — ignored and not persisted', async () => {
    const r = await resolveModelForSessionTurnWithProvenance({
      ...base,
      sessionModelMode: 'auto',
      perTurnOverride: SONNET,
    });
    expect(r.requestedSource).toBe('auto');
    expect(r.route).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' });
    expect(mockUpdateFields).not.toHaveBeenCalled();
  });

  it('auto: override equal to the profile model is an echo too', async () => {
    mockGetById.mockReturnValue({ modelProvider: PROFILE.providerId, modelId: PROFILE.modelId });
    const r = await resolveModelForSessionTurnWithProvenance({
      ...base,
      sessionModelMode: 'auto',
      perTurnOverride: PROFILE,
    });
    expect(r.requestedSource).toBe('auto');
    // baseline stays the session model; the echo did not change it
    expect(r.route).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' });
    expect(mockUpdateFields).not.toHaveBeenCalled();
  });

  it('auto: a different override is turn-only — turn_override, not persisted', async () => {
    const r = await resolveModelForSessionTurnWithProvenance({
      ...base,
      sessionModelMode: 'auto',
      perTurnOverride: GPT,
    });
    expect(r.requestedSource).toBe('turn_override');
    expect(r.route).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' });
    expect(mockUpdateFields).not.toHaveBeenCalled();
  });

  it('fixed: unchanged — differing override persists (#1108) and is a turn_override', async () => {
    const r = await resolveModelForSessionTurnWithProvenance({
      ...base,
      sessionModelMode: 'fixed',
      perTurnOverride: GPT,
    });
    expect(r.requestedSource).toBe('turn_override');
    expect(mockUpdateFields).toHaveBeenCalledWith('s1', { providerId: 'openai', modelId: 'gpt-5.6-sol' });
  });

  it("fixed: an echoed override stays 'turn_override' (legacy) and stored-only stays 'session'", async () => {
    const echoed = await resolveModelForSessionTurnWithProvenance({
      ...base,
      sessionModelMode: 'fixed',
      perTurnOverride: SONNET,
    });
    expect(echoed.requestedSource).toBe('turn_override');
    expect(mockUpdateFields).not.toHaveBeenCalled();
    const stored = await resolveModelForSessionTurnWithProvenance(base);
    expect(stored.requestedSource).toBe('session');
    expect(await resolveModelForSessionTurn({ ...base, sessionModelMode: 'fixed' })).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-6',
    });
  });
});
