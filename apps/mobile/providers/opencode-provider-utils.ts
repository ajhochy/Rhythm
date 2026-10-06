import type { Agent, Config, Model } from '@/lib/opencode/types';

declare const rhythmProfileIdBrand: unique symbol;
declare const openCodeAgentIdBrand: unique symbol;

/** Rhythm-owned profile identifier. Never send as OpenCode's `agent`. */
export type RhythmProfileId = string & {
  readonly [rhythmProfileIdBrand]: 'RhythmProfileId';
};

/** OpenCode engine agent name. Never use as a Rhythm profile lookup key. */
export type OpenCodeAgentId = string & {
  readonly [openCodeAgentIdBrand]: 'OpenCodeAgentId';
};

export type ModelOption = {
  id: string;
  label: string;
  providerID: string;
  providerLabel: string;
  modelID: string;
  recommended?: boolean;
  supportsReasoning: boolean;
  supportsAttachments: boolean;
  inputModalities: ('text' | 'audio' | 'image' | 'video' | 'pdf')[];
  supportsToolCalls: boolean;
  status?: 'alpha' | 'beta' | 'deprecated' | 'active';
  contextLimit?: number;
  outputLimit?: number;
  pricing?: Model['cost'];
};

export type AgentOption = {
  /** @deprecated UI compatibility alias for profileId. */
  id: RhythmProfileId;
  profileId: RhythmProfileId;
  opencodeAgentId: OpenCodeAgentId;
  label: string;
  description?: string;
  defaults?: {
    providerId: string | null;
    modelId: string | null;
    reasoningEffort: string | null;
    approvalMode: PermissionMode;
  };
  display?: {
    icon: string;
    color: string | null;
  };
};

export type ReasoningLevel = 'low' | 'default' | 'high';
export type ResponseScope = 'brief' | 'balanced' | 'detailed';
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions';

export type SessionProfileAvailability =
  | 'available'
  | 'unassigned'
  | 'unavailable';

export type SessionExecutionState = {
  localSessionId?: string;
  profileId: RhythmProfileId | null;
  opencodeAgentId: OpenCodeAgentId | null;
  profileAvailability: SessionProfileAvailability;
  providerId: string | null;
  modelId: string | null;
  thinkingBudget: number | null;
  permissionMode: PermissionMode;
  /** 'auto' lets the server-side router pick the model; absent on older Macs. */
  modelMode?: ModelMode;
  /** Absent on older Macs: Fast is then unknown, never false and never written back. */
  fastMode?: boolean;
  /** Present only on explicit-selector (settings contract v1) responses. */
  settingsContractVersion?: 1;
  settingsIdentity?: SessionSettingsIdentity;
  sdkSessionId?: string | null;
};

export type SessionSettingsIdentity = 'sdk' | 'local-primary';

/**
 * Exact settings target. `local-primary` is exactly
 * `MobileCoordinatorBinding.sessionId`; `sdk` is the ordinary catalog SDK id.
 */
export type SessionSettingsTarget = { identity: SessionSettingsIdentity; id: string };

export type SessionSettingsEntry =
  | { status: 'ready'; state: SessionExecutionState }
  | { status: 'unsupported' };

export function sessionSettingsKey(projectId: string, target: SessionSettingsTarget): string {
  return [projectId, target.identity, target.id].join('\u0000');
}

/** Partial settings body of the v1 contract: only fields the user explicitly changed. */
export type SessionSettingsPatch = {
  modelMode?: ModelMode;
  providerId?: string;
  modelId?: string;
  thinkingBudget?: number | null;
  fastMode?: boolean;
};

const PROFILE_AVAILABILITIES = ['available', 'unassigned', 'unavailable'];
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

/**
 * Accepts a v1 settings response only with version 1 and an exact echo of the
 * requested identity; anything else means the editor stays disabled.
 */
export function parseSessionSettingsState(
  value: unknown,
  target: SessionSettingsTarget,
): SessionExecutionState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const state = value as Record<string, unknown>;
  const nullableString = (field: unknown) => field === null || typeof field === 'string';
  // v1 identity is exact: a present nonempty canonical local id for both selectors, and an SDK id that is
  // present as string-or-null (null = inert primary). The selector's own id must additionally echo.
  const echoed = target.identity === 'local-primary'
    ? state.localSessionId === target.id
    : state.sdkSessionId === target.id;
  if (
    state.settingsContractVersion !== 1 ||
    state.settingsIdentity !== target.identity ||
    typeof state.localSessionId !== 'string' || state.localSessionId.length === 0 ||
    !('sdkSessionId' in state) || !(state.sdkSessionId === null || typeof state.sdkSessionId === 'string') ||
    !echoed ||
    typeof state.fastMode !== 'boolean' ||
    !(state.thinkingBudget === null || (Number.isInteger(state.thinkingBudget) && (state.thinkingBudget as number) >= 0)) ||
    (state.modelMode !== 'auto' && state.modelMode !== 'fixed') ||
    !nullableString(state.providerId) || !nullableString(state.modelId) ||
    !nullableString(state.profileId) || !nullableString(state.opencodeAgentId) ||
    !PROFILE_AVAILABILITIES.includes(state.profileAvailability as string) ||
    !PERMISSION_MODES.includes(state.permissionMode as string)
  ) return undefined;
  return state as unknown as SessionExecutionState;
}

/**
 * Diff of an explicit user edit against the displayed preferences. Unchanged
 * fields are omitted, so a model or Fast edit never touches the exact stored
 * reasoning budget and opening/switching can never produce a body.
 */
export function diffSessionSettings(
  current: ChatPreferences,
  next: ChatPreferences,
  options: { fastSupported: boolean },
): SessionSettingsPatch {
  const patch: SessionSettingsPatch = {};
  const modelChanged = next.modelMode !== current.modelMode ||
    (next.modelMode !== 'auto' && (next.modelId !== current.modelId || next.providerId !== current.providerId));
  if (modelChanged) {
    if (next.modelMode === 'auto') {
      patch.modelMode = 'auto';
    } else {
      const parts = getSelectedModelParts(next.modelId);
      if (!parts) throw new Error('Choose an available model.');
      patch.modelMode = 'fixed';
      patch.providerId = parts.providerID;
      patch.modelId = parts.modelID;
    }
  }
  if (next.reasoning !== current.reasoning) {
    patch.thinkingBudget = thinkingBudgetForReasoning(next.reasoning);
  }
  if (options.fastSupported && next.fastMode !== undefined && next.fastMode !== current.fastMode) {
    patch.fastMode = next.fastMode;
  }
  return patch;
}

/** Fields owned by profile/approval edits, which the settings-only contract never carries. */
export function changesProfileOrApproval(current: ChatPreferences, next: ChatPreferences): boolean {
  return next.profileId !== current.profileId ||
    next.mode !== current.mode ||
    next.permissionMode !== current.permissionMode ||
    next.autoApprove !== current.autoApprove;
}

type SessionWithExecutionMetadata = {
  rhythm?: SessionExecutionState;
  agent?: unknown;
  model?: unknown;
};

export function getSessionExecutionState(
  session: SessionWithExecutionMetadata | undefined,
): SessionExecutionState | undefined {
  if (!session) return undefined;
  if (session.rhythm) return session.rhythm;

  // Direct OpenCode connections and pre-MSP gateway responses do not carry
  // authoritative Rhythm metadata. Only hydrate their legacy engine identity
  // when one actually exists; an empty engine session must keep the safe
  // capability-derived defaults.
  const model =
    session.model && typeof session.model === 'object'
      ? (session.model as Record<string, unknown>)
      : undefined;
  const agent =
    typeof session.agent === 'string' && session.agent.trim()
      ? (session.agent as OpenCodeAgentId)
      : null;
  const providerId =
    typeof model?.providerID === 'string' ? model.providerID : null;
  const modelId = typeof model?.id === 'string' ? model.id : null;
  if (!agent && !providerId && !modelId) return undefined;

  return {
    profileId: null,
    opencodeAgentId: agent,
    profileAvailability: agent ? 'unavailable' : 'unassigned',
    providerId,
    modelId,
    thinkingBudget: null,
    permissionMode: 'default',
  };
}

export type ModelMode = 'auto' | 'fixed';
export const AUTO_MODEL_LABEL = 'Auto (router)';

export type ChatPreferences = {
  profileId?: RhythmProfileId;
  mode: OpenCodeAgentId;
  providerId?: string;
  modelId?: string;
  /** Auto (router) is the default; `modelId` is then only the fallback baseline. */
  modelMode?: ModelMode;
  /** Session Fast tier; `undefined` means unknown (older Mac), never false. */
  fastMode?: boolean;
  enabledModelIds: string[];
  providerModelSelections: Record<string, string>;
  reasoning: ReasoningLevel;
  permissionMode: PermissionMode;
  autoApprove: boolean;
  autoPlayAssistantReplies: boolean;
  preferOnDeviceRecognition: boolean;
  resumeListeningAfterReply: boolean;
  speechLocale?: string;
  speechRate: number;
  speechVoiceId?: string;
  workingSoundEnabled: boolean;
  workingSoundDefaultMigrated?: 1;
  workingSoundVariant: 'soft' | 'glass';
  workingSoundVolume: number;
  responseScope: ResponseScope;
  includeNextActions: boolean;
};

export const defaultChatPreferences: ChatPreferences = {
  mode: 'build' as OpenCodeAgentId,
  modelMode: 'auto',
  enabledModelIds: [],
  providerModelSelections: {},
  reasoning: 'default',
  permissionMode: 'default',
  autoApprove: false,
  autoPlayAssistantReplies: false,
  preferOnDeviceRecognition: true,
  resumeListeningAfterReply: true,
  speechRate: 1,
  workingSoundEnabled: false,
  workingSoundDefaultMigrated: 1,
  workingSoundVariant: 'soft',
  workingSoundVolume: 0.18,
  responseScope: 'brief',
  includeNextActions: true,
};

export function migrateWorkingSoundPreferences(stored: Partial<ChatPreferences>): Partial<ChatPreferences> {
  // Preserve every stored boolean: it may be an intentional user choice.
  // Only snapshots with no choice inherit the new default-off behavior.
  return {
    ...stored,
    workingSoundEnabled: stored.workingSoundEnabled === true,
    workingSoundDefaultMigrated: 1,
  };
}

export type PromptExecutionPlan = {
  agent?: string;
  model?: { providerID: string; modelID: string };
  system?: string;
  persistAllowed: boolean;
};

export function buildPromptExecutionPlan(
  sessionExecutionState: SessionExecutionState | undefined,
  preferences: ChatPreferences,
): PromptExecutionPlan {
  // A state without profile/provider/model means nothing was ever bound to
  // the session — treat it exactly like unknown state: never persist
  // fallback preferences onto it and never override the engine session's own
  // configuration. (opencodeAgentId is excluded: the gateway backfills it
  // from the NOT NULL agent_kind column on every row.)
  const bound = Boolean(
    sessionExecutionState &&
    (sessionExecutionState.profileId ||
      sessionExecutionState.providerId ||
      sessionExecutionState.modelId),
  );
  if (!sessionExecutionState || !bound) {
    return { persistAllowed: false };
  }

  return {
    agent: preferences.mode || undefined,
    // Auto: omit `model` so the proxy fills in the routed pick.
    model: preferences.modelMode === 'auto'
      ? undefined
      : getSelectedModelParts(preferences.modelId),
    system: buildSystemPrompt(preferences),
    persistAllowed: true,
  };
}

type GatewayProjectIdentity = {
  id: string;
  name?: unknown;
  icon?: unknown;
};

export function sameGatewayProjectList(
  current: GatewayProjectIdentity[],
  next: GatewayProjectIdentity[],
): boolean {
  return current.length === next.length && current.every((project, index) => {
    const candidate = next[index];
    return candidate !== undefined &&
      project.id === candidate.id &&
      project.name === candidate.name &&
      JSON.stringify(project.icon) === JSON.stringify(candidate.icon);
  });
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong while talking to OpenCode.';
}

export function getProjectLabel(path: string) {
  const normalized = path.trim().replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) || normalized || 'Project';
}

export function toAgentOption(agent: Agent): AgentOption {
  const profileId = agent.name as RhythmProfileId;
  return {
    id: profileId,
    profileId,
    opencodeAgentId: agent.name as OpenCodeAgentId,
    label: agent.name.charAt(0).toUpperCase() + agent.name.slice(1),
    description: agent.description,
  };
}

export function getInitialMode(
  agents: AgentOption[],
  config?: Config,
  storedMode?: string,
): OpenCodeAgentId {
  if (
    storedMode &&
    agents.some((agent) => agent.opencodeAgentId === storedMode)
  ) {
    return storedMode as OpenCodeAgentId;
  }

  const configuredAgent = config?.agent
    ? Object.entries(config.agent).find(([, value]) => value && value.disable !== true)?.[0]
    : undefined;
  if (
    configuredAgent &&
    agents.some((agent) => agent.opencodeAgentId === configuredAgent)
  ) {
    return configuredAgent as OpenCodeAgentId;
  }

  const preferred =
    agents.find((agent) => agent.opencodeAgentId === 'build') ||
    agents.find((agent) => agent.opencodeAgentId === 'general');
  return preferred?.opencodeAgentId ||
    agents[0]?.opencodeAgentId ||
    defaultChatPreferences.mode;
}

function reasoningForThinkingBudget(
  thinkingBudget: number | null,
): ReasoningLevel {
  if (thinkingBudget === null || thinkingBudget === 0) return 'default';
  return thinkingBudget <= 2048 ? 'low' : 'high';
}

export function thinkingBudgetForReasoning(
  reasoning: ReasoningLevel,
): number | null {
  if (reasoning === 'low') return 1024;
  if (reasoning === 'high') return 8192;
  return null;
}

function reasoningForProfileDefault(
  value: string | null | undefined,
  fallback: ReasoningLevel,
): ReasoningLevel {
  if (value === 'low' || value === 'default' || value === 'high') {
    return value;
  }
  return fallback;
}

function qualifiedModelId(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): string | undefined {
  if (!modelId) return undefined;
  if (modelId.includes('/') || !providerId) return modelId;
  return `${providerId}/${modelId}`;
}

export function applyProfileDefaults(
  profile: AgentOption,
  current: ChatPreferences,
): ChatPreferences {
  const providerId = profile.defaults?.providerId ?? current.providerId;
  const modelId =
    qualifiedModelId(providerId, profile.defaults?.modelId) ??
    current.modelId;
  const permissionMode =
    profile.defaults?.approvalMode ?? current.permissionMode;
  return {
    ...current,
    profileId: profile.profileId,
    mode: profile.opencodeAgentId,
    providerId: providerId ?? undefined,
    modelId,
    reasoning: reasoningForProfileDefault(
      profile.defaults?.reasoningEffort,
      current.reasoning,
    ),
    permissionMode,
    autoApprove: permissionMode === 'bypassPermissions',
    providerModelSelections:
      providerId && modelId
        ? {
            ...current.providerModelSelections,
            [providerId]: modelId,
          }
        : current.providerModelSelections,
  };
}

export function getNewSessionPreferences(
  profiles: AgentOption[],
  current: ChatPreferences,
): ChatPreferences | undefined {
  const secretary = profiles.find((profile) =>
    [
      profile.label,
      profile.profileId,
      profile.opencodeAgentId,
    ].some((value) => value.trim().toLocaleLowerCase() === 'secretary'));
  const selected = secretary ?? profiles[0];
  return selected
    ? { ...applyProfileDefaults(selected, current), modelMode: 'auto' }
    : undefined;
}

export const NO_SELECTABLE_PROFILE_MESSAGE =
  'No selectable profile available — enable one in Profiles';

function includesSearchValue(
  values: (string | null | undefined)[],
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || values.some(
    (value) => value?.toLocaleLowerCase().includes(normalized),
  );
}

export function profileMatchesSearch(
  profile: AgentOption,
  query: string,
): boolean {
  return includesSearchValue([
    profile.label,
    profile.profileId,
    profile.opencodeAgentId,
    profile.defaults?.providerId,
    profile.defaults?.modelId,
    profile.defaults?.reasoningEffort,
    profile.defaults?.approvalMode,
  ], query);
}

export function modelMatchesSearch(
  model: Pick<
    ModelOption,
    'id' | 'label' | 'providerID' | 'providerLabel' | 'modelID'
  >,
  query: string,
  metadata?: {
    accountLabel?: string;
    providerLabel?: string;
  },
): boolean {
  return includesSearchValue([
    model.label,
    model.id,
    model.modelID,
    model.providerID,
    model.providerLabel,
    metadata?.providerLabel,
    metadata?.accountLabel,
  ], query);
}

export function replaceSessionExecutionState<
  T extends { id: string; rhythm?: SessionExecutionState },
>(
  sessions: T[],
  sessionId: string,
  state: SessionExecutionState,
): T[] {
  return sessions.map((session) =>
    session.id === sessionId
      ? { ...session, rhythm: state }
      : session);
}

export function permissionModeForAutoApprove(
  autoApprove: boolean,
): PermissionMode {
  return autoApprove ? 'bypassPermissions' : 'default';
}

export function hydratePreferencesFromSession(
  session: SessionExecutionState,
  current: ChatPreferences,
): ChatPreferences {
  const modelId = session.modelId
    ? session.modelId.includes('/') || !session.providerId
      ? session.modelId
      : `${session.providerId}/${session.modelId}`
    : undefined;
  return {
    ...current,
    profileId: session.profileId ?? undefined,
    mode: session.opencodeAgentId ?? ('' as OpenCodeAgentId),
    providerId: session.providerId ?? undefined,
    modelId,
    // Sessions with an explicit stored model keep it unless the server says auto.
    modelMode: session.modelMode ?? (modelId ? 'fixed' : current.modelMode),
    // Never inherit another chat's Fast: absent stays unknown.
    fastMode: session.fastMode,
    reasoning: reasoningForThinkingBudget(session.thinkingBudget),
    permissionMode: session.permissionMode,
    autoApprove: session.permissionMode === 'bypassPermissions',
  };
}

export function resolveSessionProfileDisplay(
  session: Pick<
    SessionExecutionState,
    'profileId' | 'opencodeAgentId' | 'profileAvailability'
  >,
  profiles: Pick<AgentOption, 'profileId' | 'opencodeAgentId' | 'label'>[],
): {
  profileId: RhythmProfileId | null;
  name: string;
  availability: SessionProfileAvailability;
} {
  if (session.profileAvailability === 'available' && session.profileId) {
    const profile = profiles.find(
      (candidate) => candidate.profileId === session.profileId,
    );
    if (profile) {
      return {
        profileId: profile.profileId,
        name: profile.label,
        availability: 'available',
      };
    }
  }
  return {
    profileId: null,
    name: 'Unassigned',
    availability: session.profileAvailability,
  };
}

export function getInitialModelId(models: ModelOption[], config?: Config, storedModelId?: string) {
  if (storedModelId && models.some((model) => model.id === storedModelId)) {
    return storedModelId;
  }

  if (config?.model && models.some((model) => model.id === config.model)) {
    return config.model;
  }

  return models[0]?.id;
}

export function getInitialProviderId(models: ModelOption[], config?: Config, storedProviderId?: string, modelId?: string) {
  if (storedProviderId && models.some((model) => model.providerID === storedProviderId)) {
    return storedProviderId;
  }

  const modelMatch = models.find((model) => model.id === modelId);
  if (modelMatch) {
    return modelMatch.providerID;
  }

  if (config?.model) {
    const configMatch = models.find((model) => model.id === config.model);
    if (configMatch) {
      return configMatch.providerID;
    }
  }

  return models[0]?.providerID;
}

export function getModelIdForProvider(models: ModelOption[], providerId?: string, selectedModelId?: string, preferredModelId?: string) {
  const providerModels = providerId ? models.filter((model) => model.providerID === providerId) : models;
  if (providerModels.length === 0) {
    return selectedModelId;
  }

  if (selectedModelId && providerModels.some((model) => model.id === selectedModelId)) {
    return selectedModelId;
  }

  if (preferredModelId && providerModels.some((model) => model.id === preferredModelId)) {
    return preferredModelId;
  }

  return providerModels[0]?.id;
}

export function getEnabledModelIds(models: ModelOption[], storedModelIds?: string[]) {
  const availableModelIds = new Set(models.map((model) => model.id));
  const nextEnabledModelIds = (storedModelIds || []).filter((modelId) => availableModelIds.has(modelId));

  return nextEnabledModelIds.length > 0 ? nextEnabledModelIds : models.map((model) => model.id);
}

export function getConfiguredProviderIds(config: Config | undefined, connected: string[], models: ModelOption[]) {
  const disabled = new Set(config?.disabled_providers || []);
  const configured = new Set<string>([
    ...(config?.enabled_providers || []),
    ...connected,
    ...Object.keys((config?.provider as Record<string, unknown>) || {}),
  ]);

  if (config?.model) {
    const modelMatch = models.find((model) => model.id === config.model);
    if (modelMatch) {
      configured.add(modelMatch.providerID);
    }
  }

  disabled.forEach((providerId) => configured.delete(providerId));

  return configured;
}

export function isAutoApproveEnabled(config?: Config) {
  if (config?.permission === 'allow') {
    return true;
  }
  if (!config?.permission || typeof config.permission !== 'object') {
    return false;
  }

  const { bash, doom_loop, edit, external_directory, webfetch } = config.permission;
  return edit === 'allow' && bash === 'allow' && webfetch === 'allow' && doom_loop === 'allow' && external_directory === 'allow';
}

function buildReasoningSystemPrompt(level: ReasoningLevel) {
  if (level === 'default') {
    return undefined;
  }

  if (level === 'low') {
    return 'Reasoning effort: low. Keep the solution direct, concise, and avoid unnecessary exploration unless needed.';
  }

  return 'Reasoning effort: high. Spend extra time planning, evaluating tradeoffs, and verifying the best path before acting.';
}

function buildResponseStyleSystemPrompt(scope: ResponseScope, includeNextActions: boolean) {
  const scopeInstruction =
    scope === 'brief'
      ? 'Keep responses tightly scoped. Use short paragraphs or brief bullets and avoid extra background unless the user asks for it.'
      : scope === 'detailed'
        ? 'Give fuller explanations when helpful, but still stay conversational and focused on the user request.'
        : 'Keep responses concise and user-friendly, with only the context needed to understand the answer.';

  const nextActionsInstruction = includeNextActions
    ? 'When there are useful next actions, end with a simple explanation of the recommended next step or a short numbered list.'
    : 'Do not add next actions unless the user explicitly asks for them.';

  return `${scopeInstruction} ${nextActionsInstruction}`;
}

export function buildSystemPrompt(preferences: ChatPreferences) {
  return [
    buildReasoningSystemPrompt(preferences.reasoning),
    buildResponseStyleSystemPrompt(preferences.responseScope, preferences.includeNextActions),
  ]
    .filter(Boolean)
    .join('\n\n') || undefined;
}

export function getSelectedModelParts(modelId?: string) {
  if (!modelId) {
    return undefined;
  }

  const providerID = modelId.split('/')[0];
  const selectedModelID = modelId.split('/').slice(1).join('/');
  if (!providerID || !selectedModelID) {
    return undefined;
  }

  return {
    providerID,
    modelID: selectedModelID,
  };
}

export function mergePermissionConfig(config: Config | undefined, enabled: boolean): Config {
  const currentPermission = config?.permission && typeof config.permission === 'object'
    ? config.permission
    : {};

  return {
    ...(config || {}),
    permission: {
      ...currentPermission,
      edit: enabled ? 'allow' : 'ask',
      bash: enabled ? 'allow' : 'ask',
      webfetch: enabled ? 'allow' : 'ask',
      doom_loop: enabled ? 'allow' : 'ask',
      external_directory: enabled ? 'allow' : 'ask',
    },
  };
}

export function groupPendingRequestsBySession<T extends { id: string; sessionID: string }>(requests: T[]) {
  return requests.reduce<Record<string, T[]>>((acc, request) => {
    const existing = acc[request.sessionID] || [];
    if (existing.some((item) => item.id === request.id)) {
      return acc;
    }

    acc[request.sessionID] = [...existing, request];
    return acc;
  }, {});
}

type PickMessage = { info?: { role?: string; modelID?: string; providerID?: string } };

/** The model the router chose, from the newest assistant message that names one. */
export function getRouterPick(messages: readonly PickMessage[] | undefined) {
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    const info = messages![index]?.info;
    if (info?.role === 'assistant' && info.modelID) {
      return { providerID: info.providerID, modelID: info.modelID };
    }
  }
  return undefined;
}

/** Muted composer/header text: "Auto → <modelID>". Undefined when a concrete model is selected. */
export function routerPickLabel(
  preferences: Pick<ChatPreferences, 'modelMode'>,
  messages: readonly PickMessage[] | undefined,
): string | undefined {
  if (preferences.modelMode !== 'auto') return undefined;
  const pick = getRouterPick(messages);
  return pick ? `Auto \u2192 ${pick.modelID}` : undefined;
}
