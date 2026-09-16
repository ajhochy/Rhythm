import type { SessionMessageRecord } from '@/lib/opencode/format';

const DEFAULT_REFRESH_DELAYS_MS = [500, 1_000, 1_500, 2_500, 5_000];

type PromptAttachment = { uri: string; mime?: string; filename?: string };

export function messageMatchesPrompt(
  message: SessionMessageRecord,
  prompt: string,
  attachments: PromptAttachment[],
): boolean {
  if (message.info.role !== 'user') return false;
  const expectedText = prompt.trim();
  const textMatches = !expectedText || message.parts.some(
    (part) => part.type === 'text' && part.text.trim() === expectedText,
  );
  const files = message.parts.filter((part) => part.type === 'file');
  return textMatches && files.length === attachments.length && attachments.every(
    (attachment) => !attachment.filename || files.some(
      (part) => part.type === 'file' && part.filename === attachment.filename,
    ),
  );
}

export async function reconcilePromptAcceptance({
  baselineMessageIds,
  deadlineMs = 5_000,
  isActive = () => true,
  matchesPrompt,
  now = Date.now,
  refreshMessages,
  refreshStatus,
  sleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
}: {
  baselineMessageIds: ReadonlySet<string>;
  deadlineMs?: number;
  isActive?: () => boolean;
  matchesPrompt: (message: SessionMessageRecord) => boolean;
  now?: () => number;
  refreshMessages: () => Promise<SessionMessageRecord[]>;
  refreshStatus: () => Promise<string | undefined>;
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<'accepted' | 'notAccepted' | 'uncertain'> {
  const startedAt = now();
  let lastStatus: string | undefined;
  let messagesRead = false;
  while (isActive() && now() - startedAt <= deadlineMs) {
    try {
      const messages = await refreshMessages();
      messagesRead = true;
      if (messages.some((message) =>
        !baselineMessageIds.has(message.info.id) && matchesPrompt(message))) {
        return 'accepted';
      }
    } catch {
      // Keep reconciling through transient read failures; this loop never posts.
    }
    try {
      lastStatus = await refreshStatus();
    } catch {
      lastStatus = undefined;
    }
    await sleep(250);
  }
  return messagesRead && lastStatus === 'idle' ? 'notAccepted' : 'uncertain';
}

export async function pollForNewAssistantTurn({
  baselineAssistantMessageIds,
  delaysMs = DEFAULT_REFRESH_DELAYS_MS,
  isActive = () => true,
  refreshMessages,
  sleep = (delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }),
}: {
  baselineAssistantMessageIds: ReadonlySet<string>;
  delaysMs?: readonly number[];
  isActive?: () => boolean;
  refreshMessages: () => Promise<SessionMessageRecord[]>;
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<boolean> {
  for (const delayMs of delaysMs) {
    await sleep(delayMs);
    if (!isActive()) return false;

    const messages = await refreshMessages();
    const completed = messages.some((message) =>
      message.info.role === 'assistant' &&
      message.info.summary !== true &&
      !baselineAssistantMessageIds.has(message.info.id) &&
      message.parts.some((part) =>
        part.type === 'text' && part.text.trim().length > 0),
    );
    if (completed) return true;
  }
  return false;
}
