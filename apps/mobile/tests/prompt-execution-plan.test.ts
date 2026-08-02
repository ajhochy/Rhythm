import {
  buildPromptExecutionPlan,
  sameGatewayProjectList,
  type ChatPreferences,
  type OpenCodeAgentId,
  type RhythmProfileId,
  type SessionExecutionState,
} from '@/providers/opencode-provider-utils';

const preferences: ChatPreferences = {
  profileId: 'profile-secretary' as RhythmProfileId,
  mode: 'secretary' as OpenCodeAgentId,
  providerId: 'anthropic',
  modelId: 'anthropic/claude-sonnet-4',
  enabledModelIds: ['anthropic/claude-sonnet-4'],
  providerModelSelections: {},
  reasoning: 'high',
  permissionMode: 'acceptEdits',
  autoApprove: true,
  autoPlayAssistantReplies: false,
  preferOnDeviceRecognition: true,
  resumeListeningAfterReply: true,
  speechRate: 1,
  workingSoundEnabled: true,
  workingSoundVariant: 'soft',
  workingSoundVolume: 0.18,
  responseScope: 'brief',
  includeNextActions: true,
};

describe('prompt execution planning', () => {
  test('unknown session state lets the engine persisted configuration win', () => {
    expect(buildPromptExecutionPlan(undefined, preferences)).toEqual({
      persistAllowed: false,
    });
  });

  test('known session state preserves the current preference-derived overrides', () => {
    const state: SessionExecutionState = {
      profileId: 'profile-secretary' as RhythmProfileId,
      opencodeAgentId: 'secretary' as OpenCodeAgentId,
      profileAvailability: 'available',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4',
      thinkingBudget: 8192,
      permissionMode: 'acceptEdits',
    };

    expect(buildPromptExecutionPlan(state, preferences)).toMatchObject({
      agent: 'secretary',
      model: {
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4',
      },
      persistAllowed: true,
    });
    expect(buildPromptExecutionPlan(state, preferences).system).toContain(
      'Reasoning effort: high',
    );
  });
});

describe('gateway project identity', () => {
  test('ignores fabricated timestamps when ordered gateway identity is unchanged', () => {
    expect(
      sameGatewayProjectList(
        [
          {
            id: 'project-a',
            name: 'Alpha',
            icon: { color: '#123456', url: 'alpha' },
          },
        ],
        [
          {
            id: 'project-a',
            name: 'Alpha',
            icon: { color: '#123456', url: 'alpha' },
          },
        ],
      ),
    ).toBe(true);
  });

  test('detects order and content changes', () => {
    const current = [
      { id: 'project-a', name: 'Alpha', icon: undefined },
      { id: 'project-b', name: 'Beta', icon: undefined },
    ];

    expect(sameGatewayProjectList(current, [...current].reverse())).toBe(false);
    expect(
      sameGatewayProjectList(current, [
        current[0],
        { ...current[1], name: 'Renamed' },
      ]),
    ).toBe(false);
  });
});
