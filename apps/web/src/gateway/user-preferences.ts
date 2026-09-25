import type { GatewayMode } from '.';
import type { SessionSort } from './sessions';

export const SEND_MESSAGE_KEY_OPTIONS = [
  { value: 'Enter', label: 'Enter' },
  { value: 'Meta+Enter', label: 'Cmd/Ctrl+Enter' },
] as const;

export const NEW_SESSION_KEY_OPTIONS = [
  { value: 'Meta+N', label: 'Cmd/Ctrl+N' },
  { value: 'Meta+Shift+N', label: 'Cmd/Ctrl+Shift+N' },
] as const;
export const CANCEL_TURN_KEY_OPTIONS = [
  { value: 'Escape', label: 'Esc' },
  { value: 'Meta+Period', label: 'Cmd/Ctrl+.' },
] as const;
export const SWITCH_SESSION_KEY_OPTIONS = [
  { value: 'Meta+BracketLeft/Right', label: 'Cmd/Ctrl+[ / ]' },
  { value: 'Alt+ArrowUp/Down', label: 'Alt+Up / Down' },
] as const;

export type SendMessageKey = typeof SEND_MESSAGE_KEY_OPTIONS[number]['value'];
export type NewSessionKey = typeof NEW_SESSION_KEY_OPTIONS[number]['value'];
export type CancelTurnKey = typeof CANCEL_TURN_KEY_OPTIONS[number]['value'];
export type SwitchSessionKey = typeof SWITCH_SESSION_KEY_OPTIONS[number]['value'];
export type LocalUserPreferences = {
  theme: 'dark' | 'light';
  sendKey: SendMessageKey;
  sessionSort: SessionSort;
  archivedOnly: boolean;
  compact: boolean;
  requireDestructiveModal: boolean;
  newSessionKey: NewSessionKey;
  cancelTurnKey: CancelTurnKey;
  switchSessionKey: SwitchSessionKey;
};

export const DEFAULT_LOCAL_USER_PREFERENCES: LocalUserPreferences = {
  theme: 'dark', sendKey: 'Enter', sessionSort: 'newest', archivedOnly: false, compact: false, requireDestructiveModal: false,
  newSessionKey: 'Meta+N', cancelTurnKey: 'Escape', switchSessionKey: 'Meta+BracketLeft/Right',
};
export const USER_PREFERENCES_CHANGED_EVENT = 'rhythm:user-preferences-changed';

export function localUserPreferencesKey(userId: string | number | undefined) {
  return `rhythm.settings.${userId ?? 'fixture'}`;
}

export function readLocalUserPreferences(
  userId: string | number | undefined,
  storage?: Pick<Storage, 'getItem'>,
): LocalUserPreferences {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(localUserPreferencesKey(userId)) ?? '{}') as Partial<LocalUserPreferences>;
    return {
      theme: value.theme === 'light' ? 'light' : 'dark',
      sendKey: value.sendKey === 'Meta+Enter' ? 'Meta+Enter' : 'Enter',
      sessionSort: ['newest', 'oldest', 'name', 'activity', 'status'].includes(value.sessionSort ?? '') ? value.sessionSort! : 'newest',
      archivedOnly: value.archivedOnly === true,
      compact: value.compact === true,
      requireDestructiveModal: value.requireDestructiveModal === true,
      newSessionKey: value.newSessionKey === 'Meta+Shift+N' ? 'Meta+Shift+N' : 'Meta+N',
      cancelTurnKey: value.cancelTurnKey === 'Meta+Period' ? 'Meta+Period' : 'Escape',
      switchSessionKey: value.switchSessionKey === 'Alt+ArrowUp/Down' ? 'Alt+ArrowUp/Down' : 'Meta+BracketLeft/Right',
    };
  } catch {
    return DEFAULT_LOCAL_USER_PREFERENCES;
  }
}

export function writeLocalUserPreferences(
  userId: string | number | undefined,
  patch: Partial<LocalUserPreferences>,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
) {
  const next = { ...readLocalUserPreferences(userId, storage), ...patch };
  storage.setItem(localUserPreferencesKey(userId), JSON.stringify(next));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(USER_PREFERENCES_CHANGED_EVENT));
  return next;
}

export function resetLocalUserPreferences(
  userId: string | number | undefined,
  storage: Pick<Storage, 'removeItem'> = localStorage,
) {
  storage.removeItem(localUserPreferencesKey(userId));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(USER_PREFERENCES_CHANGED_EVENT));
}

export function matchesSendMessageKey(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  sendKey: SendMessageKey,
) {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey) return false;
  if (sendKey === 'Meta+Enter') return event.metaKey || event.ctrlKey;
  return !event.metaKey && !event.ctrlKey;
}

export function sendMessageKeyLabel(sendKey: SendMessageKey) {
  return SEND_MESSAGE_KEY_OPTIONS.find((option) => option.value === sendKey)?.label ?? 'Enter';
}

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;
const primaryModifier = (event: ShortcutEvent) => (event.metaKey || event.ctrlKey) && !event.altKey;

export function matchesNewSessionKey(event: ShortcutEvent, shortcut: NewSessionKey) {
  if (event.key.toLocaleLowerCase() !== 'n' || !primaryModifier(event)) return false;
  return shortcut === 'Meta+Shift+N' ? event.shiftKey : !event.shiftKey;
}

export function matchesCancelTurnKey(event: ShortcutEvent, shortcut: CancelTurnKey) {
  if (shortcut === 'Escape') return event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  return event.key === '.' && primaryModifier(event) && !event.shiftKey;
}

export function matchSwitchSessionKey(event: ShortcutEvent, shortcut: SwitchSessionKey): 'previous' | 'next' | null {
  if (shortcut === 'Meta+BracketLeft/Right') {
    if (!primaryModifier(event) || event.shiftKey) return null;
    if (event.key === '[') return 'previous';
    if (event.key === ']') return 'next';
    return null;
  }
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null;
  if (event.key === 'ArrowUp') return 'previous';
  if (event.key === 'ArrowDown') return 'next';
  return null;
}

const destructivePermissionTools = new Set(['bash', 'write', 'edit', 'patch']);

export function shouldEscalatePermission(enabled: boolean, tool: string) {
  return enabled && destructivePermissionTools.has(tool.trim().toLocaleLowerCase());
}

export interface UserPreferencesGateway {
  readonly mode: GatewayMode;
  updateArtifactTabIds(ids: string[]): Promise<{ artifactTabIds: string[] }>;
}

// artifactTabIds is the ONLY server-persisted tab preference. The validated theme, composer,
// and Agents-rail preferences above intentionally remain account-scoped to this device.
// Mounted at /users in apps/api_server/src/app.ts; PATCH /me/preferences declared at
// apps/api_server/src/routes/users_routes.ts:10 and validated (<=50 unique UUID strings) at
// apps/api_server/src/controllers/users_controller.ts:91-98.
export function createLiveUserPreferencesGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): UserPreferencesGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit user-preferences token is required');
  return {
    mode: 'live',
    updateArtifactTabIds: async (ids) => {
      const result = await fetcher(`${apiBase}/users/me/preferences`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifactTabIds: ids }),
      });
      if (!result.ok) throw new Error(`Failed to persist artifact tabs (${result.status})`);
      return result.json();
    },
  };
}
