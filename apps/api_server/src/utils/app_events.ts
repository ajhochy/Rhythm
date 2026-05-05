import { EventEmitter } from 'events';

export const appEvents = new EventEmitter();
appEvents.setMaxListeners(50);

export type AppEvent =
  | { event: 'claude.trigger'; taskId: string; taskTitle: string; triggeredByUserId: number | null }
  | { event: 'agent.session_output'; sessionId: string; data: string }
  | { event: 'agent.session_status'; sessionId: string; working: boolean; source: string }
  | { event: 'agent.session_closed'; sessionId: string; resumable: boolean }
  | { event: 'agent.session_token_captured'; sessionId: string; token: string };

export function emitAppEvent(payload: AppEvent): void {
  appEvents.emit(payload.event, payload);
}
