export function listProvidersPayload(state) {
  return {
    all: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'gpt-4.1-mini': {
            id: 'gpt-4.1-mini',
            name: 'GPT-4.1 mini',
            capabilities: {
              attachment: true,
              reasoning: true,
              temperature: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: true },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            limit: { context: 1047576, output: 32768 },
          },
        },
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        models: {
          'openrouter/auto': {
            id: 'openrouter/auto',
            name: 'Auto',
            capabilities: {
              attachment: false,
              reasoning: false,
              temperature: true,
              toolcall: true,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            limit: { context: 200000, output: 16384 },
          },
        },
      },
    ],
    default: { openai: 'gpt-4.1-mini', openrouter: 'openrouter/auto' },
    connected: [...state.configuredProviderIds].sort(),
  };
}

export function providerAuthPayload() {
  return {
    openai: [
      {
        type: 'oauth',
        label: 'Sign in',
        prompts: [],
      },
    ],
    openrouter: [{ type: 'api', label: 'API key' }],
  };
}

export function profileCatalogPayload() {
  return {
    profiles: [
      {
        profileId: 'profile-secretary',
        opencodeAgentId: 'secretary',
        name: 'Secretary',
        defaults: {
          providerId: 'openai',
          modelId: 'gpt-4.1-mini',
          reasoningEffort: null,
          approvalMode: 'default',
        },
        display: {
          icon: 'mail',
          color: null,
        },
      },
      {
        profileId: 'profile-build',
        opencodeAgentId: 'build',
        name: 'Build',
        defaults: {
          providerId: 'openai',
          modelId: 'gpt-4.1-mini',
          reasoningEffort: null,
          approvalMode: 'default',
        },
        display: {
          icon: 'terminal',
          color: null,
        },
      },
      {
        profileId: 'profile-general',
        opencodeAgentId: 'general',
        name: 'General',
        defaults: {
          providerId: 'openai',
          modelId: 'gpt-4.1-mini',
          reasoningEffort: null,
          approvalMode: 'default',
        },
        display: {
          icon: 'sparkles',
          color: null,
        },
      },
    ],
  };
}

export function resolveMobileSessionExecutionState(body, sessionId) {
  if (!body || typeof body !== 'object') {
    return { statusCode: 400 };
  }
  if (
    body.profileId !== null &&
    (typeof body.profileId !== 'string' || !body.profileId.trim())
  ) {
    return { statusCode: 400 };
  }
  const profile = profileCatalogPayload().profiles.find(
    (entry) => entry.profileId === body.profileId,
  );
  if (typeof body.profileId === 'string' && !profile) {
    return { statusCode: 404 };
  }
  const invalidAgent = profile
    ? (
        body.opencodeAgentId !== undefined &&
        body.opencodeAgentId !== profile.opencodeAgentId
      )
    : body.opencodeAgentId !== null &&
      body.opencodeAgentId !== undefined;
  const invalidProvider =
    body.providerId !== null && typeof body.providerId !== 'string';
  const invalidModel =
    body.modelId !== null && typeof body.modelId !== 'string';
  const invalidThinking =
    body.thinkingBudget !== null &&
    (
      !Number.isInteger(body.thinkingBudget) ||
      body.thinkingBudget < 0
    );
  const permissionModes = new Set([
    'default',
    'acceptEdits',
    'plan',
    'bypassPermissions',
  ]);
  if (
    invalidAgent ||
    invalidProvider ||
    invalidModel ||
    invalidThinking ||
    !permissionModes.has(body.permissionMode)
  ) {
    return { statusCode: 400 };
  }
  return {
    statusCode: 200,
    state: {
      localSessionId: `local-${sessionId}`,
      profileId: profile?.profileId ?? null,
      opencodeAgentId: profile?.opencodeAgentId ?? null,
      profileAvailability: profile ? 'available' : 'unassigned',
      providerId: body.providerId,
      modelId: body.modelId,
      thinkingBudget: body.thinkingBudget,
      permissionMode: body.permissionMode,
    },
  };
}

export function commandsPayload() {
  return [
    {
      name: 'review',
      description: 'Review the current workspace',
      source: 'command',
      template: 'Review $ARGUMENTS',
      hints: ['scope'],
    },
    {
      name: 'test',
      description: 'Run deterministic tests',
      source: 'command',
      template: 'Test $ARGUMENTS',
      hints: ['target'],
    },
  ];
}

export function diagnosticsPayload() {
  return {
    formatter: [{ name: 'prettier', extensions: ['.ts', '.tsx', '.md'], enabled: true }],
    lsp: [{ id: 'typescript', name: 'TypeScript', root: '/workspace/demo-project', status: 'connected' }],
    mcp: { filesystem: { status: 'connected' } },
  };
}

export function fileStatusesPayload(state) {
  return [
    { path: 'src/demo.ts', added: 2, removed: 1, status: 'modified' },
    ...(state.workspaceTaskCompleted
      ? [{ path: 'app/(tabs)/index.tsx', added: 6, removed: 1, status: 'modified' }]
      : []),
  ];
}

export function vcsPayload() {
  return { branch: 'main', default_branch: 'main' };
}
