export type CoordinatorComposerRouteResult = {
  handled: boolean;
  accepted: boolean;
  reason?: string;
};

/**
 * A server-primary root may intentionally overlay the current catalog chat
 * while its own catalog row has not arrived. Keep its draft local to the
 * server-root view rather than borrowing that ordinary chat's SDK draft.
 */
export function coordinatorDraftScope(input: {
  currentSessionId?: string;
  serverPrimaryUiSessionId?: string;
}): string {
  return input.serverPrimaryUiSessionId ?? input.currentSessionId ?? '__new-session__';
}

/** A late acknowledgement may affect only the exact submitting chat/draft. */
export function shouldApplyCoordinatorAcknowledgement(input: {
  accepted: boolean;
  currentDraft: string;
  /** Monotonic local edit token for the submitting chat draft. */
  currentDraftRevision?: number;
  /** View-local draft identity also covers a server-primary chat without an SDK row. */
  latestDraftScope?: string;
  latestDraftGeneration?: number;
  latestSessionId?: string;
  latestSessionGeneration: number;
  submittedDraft: string;
  submittedDraftRevision?: number;
  submittedDraftScope?: string;
  submittedDraftGeneration?: number;
  submittedSessionGeneration: number;
  submittedSessionId?: string;
}): boolean {
  const submittedDraftScope = input.submittedDraftScope ?? input.submittedSessionId;
  const latestDraftScope = input.latestDraftScope ?? input.latestSessionId;
  const submittedDraftGeneration = input.submittedDraftGeneration ?? input.submittedSessionGeneration;
  const latestDraftGeneration = input.latestDraftGeneration ?? input.latestSessionGeneration;
  const sameSession = input.submittedSessionId
    ? input.latestSessionId === input.submittedSessionId
    : input.latestSessionId === undefined;
  return input.accepted && Boolean(submittedDraftScope) &&
    latestDraftScope === submittedDraftScope &&
    latestDraftGeneration === submittedDraftGeneration &&
    sameSession &&
    input.latestSessionGeneration === input.submittedSessionGeneration &&
    input.currentDraft === input.submittedDraft &&
    (input.currentDraftRevision === undefined || input.submittedDraftRevision === undefined ||
      input.currentDraftRevision === input.submittedDraftRevision);
}

/**
 * Coordinator mode owns plaintext submission. A handled failure deliberately
 * returns without falling through to OpenCode prompt/command/shell dispatch.
 */
export async function routeCoordinatorComposerInput(input: {
  active: boolean;
  attachmentCount: number;
  message: string;
  send: (message: string) => Promise<{ accepted: boolean }>;
}): Promise<CoordinatorComposerRouteResult> {
  if (!input.active) return { handled: false, accepted: false };
  if (input.attachmentCount > 0) {
    return {
      handled: true,
      accepted: false,
      reason: 'Coordinator messages are plaintext. Remove attachments before sending.',
    };
  }
  if (!input.message.trim()) return { handled: true, accepted: false };
  const result = await input.send(input.message);
  return { handled: true, accepted: result.accepted };
}
