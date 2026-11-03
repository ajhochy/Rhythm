export type AgentNotificationEvent =
  | { v: 1; type: 'ask' | 'resolve'; family: 'permission' | 'question'; sessionId: string; requestId: string }
  | { v: 1; type: 'arm'; sessionId: string }
  | { v: 1; type: 'completion'; sessionId: string }
  | { v: 1; type: 'viewing'; sessionId: string | null; displayed: boolean }
  | { v: 1; type: 'ready' }
  // rhythm_notify / server notification.push: main raises a native banner when Rhythm is in the background.
  | { v: 1; type: 'push'; id: number; title: string; body: string };

export function emitAgentNotification(event: AgentNotificationEvent, live: boolean) {
  if (!live || !window.rhythmShell?.gateway) return;
  window.dispatchEvent(new CustomEvent('rhythm:agent-notifications', { detail: event }));
}
