export type CoordinatorVoiceToggleResult = 'normal' | 'stopped' | 'blocked';

/**
 * Continuous conversation sends through the ordinary SDK loop, so it cannot
 * start while the composer is bound to coordinator control. An already-active
 * ordinary loop is stopped before that binding is opened.
 */
export async function routeCoordinatorConversationToggle(input: {
  coordinatorActive: boolean;
  conversationActive: boolean;
  toggleConversationMode: () => Promise<void>;
}): Promise<CoordinatorVoiceToggleResult> {
  if (!input.coordinatorActive) {
    await input.toggleConversationMode();
    return 'normal';
  }
  if (input.conversationActive) {
    await input.toggleConversationMode();
    return 'stopped';
  }
  return 'blocked';
}

export async function stopConversationBeforeCoordinatorOpen(input: {
  conversationActive: boolean;
  toggleConversationMode: () => Promise<void>;
}): Promise<void> {
  if (input.conversationActive) await input.toggleConversationMode();
}
