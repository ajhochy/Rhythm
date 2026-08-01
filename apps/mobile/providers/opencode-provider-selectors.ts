import { getHistoryPreview, toTranscriptEntry, type SessionMessageRecord, type TranscriptEntry } from '@/lib/opencode/format';
import { getTranscriptActivityLabel, isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import type { OpenProjectSessionState } from '@/providers/open-project-session';
import type { ModelOption } from '@/providers/opencode-provider-utils';
import type { ConversationPhase, ProviderOption } from '@/providers/opencode-provider-types';

export function getCurrentPendingRequests<T>(
  currentSessionId: string | undefined,
  sendingSessionId: string | undefined,
  pendingRequestsBySession: Record<string, T[]>,
) {
  const candidateSessionIds = [...new Set([currentSessionId, sendingSessionId].filter(Boolean))] as string[];
  const matches = candidateSessionIds.flatMap((sessionId) => pendingRequestsBySession[sessionId] || []);

  return matches;
}

export function canCommitBootstrappedSession({
  activeBootstrapToken,
  bootstrapToken,
  currentSessionId,
}: {
  activeBootstrapToken?: object;
  bootstrapToken: object;
  currentSessionId?: string;
}): boolean {
  return (
    activeBootstrapToken === bootstrapToken &&
    currentSessionId === undefined
  );
}

export function preserveReadySessionDuringRefresh<
  TSession extends { id: string },
>({
  activeProjectId,
  currentSessionId,
  currentSessions,
  openState,
  refreshedSessions,
}: {
  activeProjectId?: string;
  currentSessionId?: string;
  currentSessions: TSession[];
  openState: OpenProjectSessionState;
  refreshedSessions: TSession[];
}): TSession[] {
  if (
    openState.kind !== 'ready' ||
    openState.projectId !== activeProjectId ||
    openState.sessionId !== currentSessionId ||
    refreshedSessions.some((session) => session.id === currentSessionId)
  ) {
    return refreshedSessions;
  }

  const ownerOpenedSession = currentSessions.find(
    (session) => session.id === currentSessionId,
  );
  return ownerOpenedSession
    ? [ownerOpenedSession, ...refreshedSessions]
    : refreshedSessions;
}

export function reconcileSessionSelectionAfterRefresh<
  TSession extends { id: string },
>({
  activeProjectId,
  currentSessionId,
  lastSessionByProject,
  openState,
  sessions,
}: {
  activeProjectId?: string;
  currentSessionId?: string;
  lastSessionByProject: Record<string, string>;
  openState: OpenProjectSessionState;
  sessions: TSession[];
}): string | undefined {
  if (!currentSessionId) return currentSessionId;

  if (
    (openState.kind === 'opening' || openState.kind === 'ready') &&
    openState.projectId === activeProjectId
  ) {
    if (openState.kind === 'opening') return currentSessionId;
    if (
      openState.sessionId === currentSessionId ||
      sessions.some((session) => session.id === openState.sessionId)
    ) {
      return openState.sessionId;
    }
  }

  if (sessions.some((session) => session.id === currentSessionId)) {
    return currentSessionId;
  }

  const rememberedSessionId = activeProjectId
    ? lastSessionByProject[activeProjectId]
    : undefined;
  return (
    sessions.find((session) => session.id === rememberedSessionId)?.id ??
    sessions[0]?.id
  );
}

export function getConfiguredProviders(availableProviders: ProviderOption[]) {
  return availableProviders.filter((provider) => provider.configured);
}

export function getTranscriptActivityLabelForEntries(transcript: TranscriptEntry[]) {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (isTranscriptDisplayMessage(entry)) {
      continue;
    }

    const label = getTranscriptActivityLabel(entry);
    if (label) {
      return label;
    }
  }

  return undefined;
}

export function getConversationStatusLabel(conversationPhase: ConversationPhase, conversationCurrentActivityLabel?: string) {
  switch (conversationPhase) {
    case 'listening':
      return 'Listening';
    case 'submitting':
      return 'Sending';
    case 'waiting':
      return conversationCurrentActivityLabel || 'Thinking';
    case 'speaking':
      return 'Speaking';
    default:
      return undefined;
  }
}

export function getSessionPreviewById(messagesBySession: Record<string, SessionMessageRecord[]>) {
  return Object.fromEntries(Object.entries(messagesBySession).map(([sessionId, messages]) => [sessionId, getHistoryPreview(messages)]));
}

export function getTranscript(messages: SessionMessageRecord[]) {
  return messages.map(toTranscriptEntry);
}

export type ModelPickerModel = ModelOption & {
  // 'Recent' | 'Recommended' — string because the issue-1233 contract test
  // evals this file as plain JS, which rules out as-const/annotations here.
  rankLabel?: string;
};

export type ModelPickerGroup = {
  providerId: string;
  providerLabel: string;
  accountLabel: string;
  models: ModelPickerModel[];
};

type ModelPickerSelectionInput = {
  availableModels: ModelOption[];
  availableProviders: ProviderOption[];
  enabledModelIds: string[];
  recentModelIds: string[];
  selectedModelId?: string;
};

export function selectModelPickerGroups(input: ModelPickerSelectionInput) {
  const enabledModelIds = new Set(input.enabledModelIds);
  const recentRanks = new Map(input.recentModelIds.map((id, index) => [id, index]));

  return input.availableProviders
    .filter((provider) => provider.configured && provider.connected)
    .map((provider) => {
      const models = input.availableModels
        .filter((model) =>
          model.providerID === provider.id &&
          (enabledModelIds.size === 0 || enabledModelIds.has(model.id)))
        .map((model) => ({
          ...model,
          rankLabel:
            model.id === input.selectedModelId || recentRanks.has(model.id)
              ? 'Recent'
              : model.recommended
                ? 'Recommended'
                : undefined,
        }))
        .sort((left, right) => {
          const leftRecent = left.id === input.selectedModelId
            ? -1
            : (recentRanks.get(left.id) ?? Number.MAX_SAFE_INTEGER);
          const rightRecent = right.id === input.selectedModelId
            ? -1
            : (recentRanks.get(right.id) ?? Number.MAX_SAFE_INTEGER);
          return leftRecent - rightRecent
            || Number(Boolean(right.recommended)) - Number(Boolean(left.recommended))
            || left.label.localeCompare(right.label);
        });

      return {
        providerId: provider.id,
        providerLabel: provider.label,
        accountLabel: provider.accountLabel || provider.label,
        models,
      };
    })
    .filter((group) => group.models.length > 0)
    .sort((left, right) => {
      const leftRank = left.models[0]?.rankLabel === 'Recent'
        ? 0
        : left.models[0]?.rankLabel === 'Recommended'
          ? 1
          : 2;
      const rightRank = right.models[0]?.rankLabel === 'Recent'
        ? 0
        : right.models[0]?.rankLabel === 'Recommended'
          ? 1
          : 2;
      return leftRank - rightRank
        || left.providerLabel.localeCompare(right.providerLabel)
        || left.accountLabel.localeCompare(right.accountLabel);
    });
}
