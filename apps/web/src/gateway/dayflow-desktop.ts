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
