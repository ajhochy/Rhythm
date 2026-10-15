// Direct .mjs import (same module registry.ts re-exports) keeps this file runnable under `node --test`.
import { AGENT_TOOL_DESCRIPTORS } from '../../../electron/src/rhythm-agent-tools.mjs';

export type AgentToolPinScope = string | number | undefined;
export type AgentToolPinRead = { scope: AgentToolPinScope; ids: string[]; error: boolean };
type PinStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const AGENT_TOOL_PINS_CHANGED_EVENT = 'rhythm:agent-tool-pins-changed';

const knownIds: Set<string> = new Set(AGENT_TOOL_DESCRIPTORS.map((tool) => tool.id));
const defaults = () => AGENT_TOOL_DESCRIPTORS.filter((tool) => tool.defaultPinned).map((tool) => tool.id);
const validIds = (value: unknown): value is string[] => Array.isArray(value)
  && value.every((id) => typeof id === 'string' && knownIds.has(id)) && new Set(value).size === value.length;

/** Same `<prefix>.<userId ?? 'fixture'>` scope convention as `localUserPreferencesKey`. */
export function agentToolPinsKey(scope: AgentToolPinScope) {
  return `rhythm.agent-tools.pins.${scope ?? 'fixture'}`;
}

/** The `window.localStorage` getter itself throws when storage is blocked. */
function browserStorage(): PinStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}

function announce(scope: AgentToolPinScope) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AGENT_TOOL_PINS_CHANGED_EVENT, { detail: { key: agentToolPinsKey(scope) } }));
}

/** Reads only this additive preference key. Existing settings are never rewritten. */
export function readAgentToolPins(scope: AgentToolPinScope, storage: Pick<Storage, 'getItem'> | undefined = browserStorage()): AgentToolPinRead {
  if (!storage) return { scope, ids: defaults(), error: true };
  try {
    const raw = storage.getItem(agentToolPinsKey(scope));
    if (raw === null) return { scope, ids: defaults(), error: false };
    const value: unknown = JSON.parse(raw);
    return validIds(value) ? { scope, ids: value, error: false } : { scope, ids: defaults(), error: false };
  } catch { return { scope, ids: defaults(), error: true }; }
}

export function writeAgentToolPins(scope: AgentToolPinScope, ids: readonly string[], storage: Pick<Storage, 'setItem'> | undefined = browserStorage()): { ok: boolean } {
  if (!storage || !validIds(ids)) return { ok: false };
  try {
    storage.setItem(agentToolPinsKey(scope), JSON.stringify([...ids]));
    announce(scope);
    return { ok: true };
  } catch { return { ok: false }; }
}

/**
 * Toggles against a fresh read of `scope`, never a cached list, so a change made
 * in another window or under another owner's scope cannot be written back here.
 */
export function toggleAgentToolPin(scope: AgentToolPinScope, id: string, storage: PinStorage | undefined = browserStorage()): AgentToolPinRead {
  const current = readAgentToolPins(scope, storage);
  if (!knownIds.has(id)) return current;
  const ids = current.ids.includes(id) ? current.ids.filter((value) => value !== id) : [...current.ids, id];
  return writeAgentToolPins(scope, ids, storage).ok ? { scope, ids, error: false } : { ...current, error: true };
}

/** Restores defaults for one scope only (profile reset or user action). */
export function resetAgentToolPins(scope: AgentToolPinScope, storage: Pick<Storage, 'removeItem'> | undefined = browserStorage()): { ok: boolean } {
  if (!storage) return { ok: false };
  try {
    storage.removeItem(agentToolPinsKey(scope));
    announce(scope);
    return { ok: true };
  } catch { return { ok: false }; }
}

/** Allows Shell-owned integration to update additive pins without sharing state. */
export function subscribeAgentToolPins(scope: AgentToolPinScope, callback: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const key = agentToolPinsKey(scope);
  const changed = (event: Event) => {
    // `key === null` is `localStorage.clear()` from another document.
    if (event instanceof StorageEvent) { if (event.key === key || event.key === null) callback(); return; }
    if ((event as CustomEvent<{ key?: string }>).detail?.key === key) callback();
  };
  window.addEventListener('storage', changed);
  window.addEventListener(AGENT_TOOL_PINS_CHANGED_EVENT, changed);
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener(AGENT_TOOL_PINS_CHANGED_EVENT, changed);
  };
}
