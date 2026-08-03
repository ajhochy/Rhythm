import type { SessionMessageRecord } from '@/lib/opencode/format';

const DEFAULT_REFRESH_DELAYS_MS = [500, 1_000, 1_500, 2_500, 5_000];

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
