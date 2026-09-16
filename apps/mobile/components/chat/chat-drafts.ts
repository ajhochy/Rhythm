export type ChatAttachment = { uri: string; mime?: string; filename?: string };

export type ChatDraft = {
  attachments: ChatAttachment[];
  draft: string;
};

export type ChatSendAttempt = ChatDraft & { sessionId: string };

const emptyDraft = (): ChatDraft => ({ attachments: [], draft: '' });

export function createSessionDraftStore() {
  const drafts = new Map<string, ChatDraft>();
  const get = (sessionId: string): ChatDraft => {
    const value = drafts.get(sessionId) ?? emptyDraft();
    return { attachments: [...value.attachments], draft: value.draft };
  };
  const set = (sessionId: string, value: ChatDraft) => {
    drafts.set(sessionId, {
      attachments: [...value.attachments],
      draft: value.draft,
    });
  };

  return {
    get,
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
