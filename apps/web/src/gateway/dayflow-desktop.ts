export type DayflowDesktopStatus =
  | { status: 'ready'; version: string; build: string; identifier: string }
  | { status: 'unavailable'; code: string }
  | { status: 'unsupported'; code: string };

export interface DayflowDesktopBridge {
  getDayflowDesktopStatus(): Promise<DayflowDesktopStatus>;
  openDayflowDesktop(): Promise<DayflowDesktopStatus>;
}

const unavailable: DayflowDesktopStatus = { status: 'unavailable', code: 'BRIDGE_UNAVAILABLE' };

function valid(value: unknown): value is DayflowDesktopStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.status === 'ready') return Object.keys(record).length === 4 && typeof record.version === 'string' && typeof record.build === 'string' && typeof record.identifier === 'string';
  return (record.status === 'unavailable' || record.status === 'unsupported') && Object.keys(record).length === 2 && typeof record.code === 'string';
}

export function getDayflowDesktopBridge(): DayflowDesktopBridge | undefined {
  const candidate = (window as Window & { rhythmShell?: { dayflowDesktop?: Partial<DayflowDesktopBridge> } }).rhythmShell?.dayflowDesktop;
  if (typeof candidate?.getDayflowDesktopStatus !== 'function' || typeof candidate.openDayflowDesktop !== 'function') return undefined;
  return {
    async getDayflowDesktopStatus() { const result = await candidate.getDayflowDesktopStatus!(); return valid(result) ? result : unavailable; },
    async openDayflowDesktop() { const result = await candidate.openDayflowDesktop!(); return valid(result) ? result : unavailable; },
  };
}

export { unavailable as dayflowDesktopBridgeUnavailable };

// ---- Embedded native view (rhythmShell.dayflowView) -------------------------------------------
// Frozen six-method wire. The private host lease lives only in the preload; nothing here can see or
// supply it. This facade is a separate path from the external-opener bridge above and never falls back to it.

export type DayflowViewStatus = { state: 'ready' } | { state: 'unavailable'; code: 'unavailable' };
export type DayflowViewAttachResult = { ok: true } | { ok: false; reason: 'unavailable' | 'denied' | 'detached' };
export type DayflowViewBounds = { x: number; y: number; width: number; height: number };

export interface DayflowView {
  getStatus(): Promise<DayflowViewStatus>;
  attach(): Promise<DayflowViewAttachResult>;
  setBounds(bounds: DayflowViewBounds): Promise<boolean>;
  setBlocked(blocked: boolean): Promise<boolean>;
  detach(): Promise<boolean>;
  returnFocus(): Promise<boolean>;
}

const viewMethods = ['getStatus', 'attach', 'setBounds', 'setBlocked', 'detach', 'returnFocus'] as const;
const viewUnavailable: DayflowViewStatus = { state: 'unavailable', code: 'unavailable' };
// Generous finite bound on CSS coordinates; main still clamps to its own window content.
const MAX_VIEW_COORDINATE = 1_000_000;

function plain(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function validViewStatus(value: unknown): value is DayflowViewStatus {
  if (plain(value, ['state'])) return value.state === 'ready';
  return plain(value, ['state', 'code']) && value.state === 'unavailable' && value.code === 'unavailable';
}

function validViewAttach(value: unknown): value is DayflowViewAttachResult {
  if (plain(value, ['ok'])) return value.ok === true;
  return plain(value, ['ok', 'reason']) && value.ok === false &&
    (value.reason === 'unavailable' || value.reason === 'denied' || value.reason === 'detached');
}

/** Exact four-key finite rectangle with positive size; anything else never reaches the bridge. */
export function validDayflowViewBounds(value: unknown): value is DayflowViewBounds {
  if (!plain(value, ['x', 'y', 'width', 'height'])) return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    Math.abs(x as number) <= MAX_VIEW_COORDINATE && Math.abs(y as number) <= MAX_VIEW_COORDINATE &&
    (width as number) > 0 && (height as number) > 0 &&
    (width as number) <= MAX_VIEW_COORDINATE && (height as number) <= MAX_VIEW_COORDINATE;
}

/**
 * Returns undefined unless all six methods exist. Each call returns an independent facade with its own
 * monotonic epoch: attach/detach advance it, so a superseded attach resolves as `detached` and a superseded
 * layout call resolves false. A stale attach result is never followed by a detach (main may reuse that lease).
 * Every failure is folded into the fixed unavailable/false forms; no error text or detail is exposed.
 */
export function getDayflowView(): DayflowView | undefined {
  const bridge = (window as Window & { rhythmShell?: { dayflowView?: Partial<Record<(typeof viewMethods)[number], unknown>> } }).rhythmShell?.dayflowView;
  if (!bridge || !viewMethods.every((name) => typeof bridge[name] === 'function')) return undefined;
  const call = (name: (typeof viewMethods)[number], ...args: unknown[]) => (bridge[name] as (...a: unknown[]) => Promise<unknown>)(...args);
  let epoch = 0;
  const flag = async (name: 'setBounds' | 'setBlocked' | 'detach' | 'returnFocus', ...args: unknown[]): Promise<boolean> => {
    const mine = epoch;
    try {
      const result = await call(name, ...args);
      // detach is the epoch owner; its own result is always reported.
      return result === true && (name === 'detach' || mine === epoch);
    } catch { return false; }
  };
  return {
    async getStatus() {
      try { const result = await call('getStatus'); return validViewStatus(result) ? result : viewUnavailable; }
      catch { return viewUnavailable; }
    },
    async attach() {
      const mine = ++epoch;
      try {
        const result = await call('attach');
        if (mine !== epoch) return { ok: false, reason: 'detached' };
        return validViewAttach(result) ? result : { ok: false, reason: 'unavailable' };
      } catch { return mine === epoch ? { ok: false, reason: 'unavailable' } : { ok: false, reason: 'detached' }; }
    },
    async setBounds(bounds) {
      if (!validDayflowViewBounds(bounds)) return false;
      const { x, y, width, height } = bounds;
      return flag('setBounds', { x, y, width, height });
    },
    async setBlocked(blocked) {
      if (typeof blocked !== 'boolean') return false;
      return flag('setBlocked', blocked);
    },
    async detach() { epoch += 1; return flag('detach'); },
    async returnFocus() { return flag('returnFocus'); },
  };
}
