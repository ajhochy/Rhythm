export type ChatAttachment = { uri: string; mime?: string; filename?: string };

export type ChatDraft = {
  attachments: ChatAttachment[];
  draft: string;
};

export type ChatSendAttempt = ChatDraft & { sessionId: string };

const emptyDraft = (): ChatDraft => ({ attachments: [], draft: '' });

export function createSessionDraftStore() {
  const drafts = new Map<string, ChatDraft>();
  // A value comparison cannot distinguish A -> B -> A from an untouched A.
  // Keep this in-memory edit token alongside the actual per-chat draft, not
  // in persisted history or coordinator state.
  const revisions = new Map<string, number>();
  const get = (sessionId: string): ChatDraft => {
    const value = drafts.get(sessionId) ?? emptyDraft();
    return { attachments: [...value.attachments], draft: value.draft };
  };
  const set = (sessionId: string, value: ChatDraft) => {
    drafts.set(sessionId, {
      attachments: [...value.attachments],
      draft: value.draft,
    });
    revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1);
  };

  return {
    get,
    getRevision(sessionId: string) {
      return revisions.get(sessionId) ?? 0;
    },
    updateDraft(sessionId: string, draft: string) {
      set(sessionId, { ...get(sessionId), draft });
    },
    updateAttachments(sessionId: string, attachments: ChatAttachment[]) {
      set(sessionId, { ...get(sessionId), attachments });
    },
    move(fromSessionId: string, toSessionId: string) {
      if (fromSessionId === toSessionId) return;
      const from = get(fromSessionId);
      const to = get(toSessionId);
      set(toSessionId, {
        attachments: [...to.attachments, ...from.attachments.filter(
          (attachment) => !to.attachments.some((item) => item.uri === attachment.uri),
        )],
        draft: [to.draft, from.draft].filter(Boolean).join('\n'),
      });
      drafts.delete(fromSessionId);
      revisions.set(fromSessionId, (revisions.get(fromSessionId) ?? 0) + 1);
    },
    beginSend(sessionId: string): ChatSendAttempt {
      const attempt = { sessionId, ...get(sessionId) };
      set(sessionId, emptyDraft());
      return attempt;
    },
    restoreFailedSend(attempt: ChatSendAttempt) {
      const current = get(attempt.sessionId);
      set(attempt.sessionId, {
        attachments: [
          ...attempt.attachments,
          ...current.attachments.filter(
            (attachment) => !attempt.attachments.some((item) => item.uri === attachment.uri),
          ),
        ],
        draft: current.draft
          ? [attempt.draft, current.draft].filter(Boolean).join('\n')
          : attempt.draft,
      });
    },
  };
}
