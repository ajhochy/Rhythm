import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { decisionSettingsPath } from './decision_settings';
import type { ClosedProvider } from './router_grid_config';

export interface GridExhaustion { provider: ClosedProvider; accountId: string; exhaustedUntil: number }
export function routerGridExhaustionPath(): string { return join(dirname(decisionSettingsPath()), 'router-grid-exhaustion.json'); }
/** No event wiring; caller supplies reset/retry-after deadline. */
export class RouterGridExhaustionStore {
  constructor(private readonly path = routerGridExhaustionPath(), private readonly clock: () => number = Date.now) {}
  private save(entries: GridExhaustion[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(entries) + '\n', { mode: 0o600 });
    renameSync(tmp, this.path);
  }
  list(): GridExhaustion[] {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(this.path, 'utf8')); } catch { return []; }
    if (!Array.isArray(raw)) return [];
    const now = this.clock();
    const entries: GridExhaustion[] = raw.filter(e => e && (e.provider === 'anthropic' || e.provider === 'openai') &&
      typeof e.accountId === 'string' && !!e.accountId && Number.isFinite(e.exhaustedUntil) && e.exhaustedUntil > now)
      .map(e => ({ provider: e.provider, accountId: e.accountId, exhaustedUntil: e.exhaustedUntil }));
    if (entries.length !== raw.length) this.save(entries);
    return entries;
  }
  markExhausted(provider: ClosedProvider, accountId: string, exhaustedUntil: number): void {
    if ((provider !== 'anthropic' && provider !== 'openai') || !accountId.trim() || !Number.isFinite(exhaustedUntil)) throw new Error('invalid_exhaustion');
    const entries = this.list().filter(e => e.provider !== provider || e.accountId !== accountId);
    if (exhaustedUntil > this.clock()) entries.push({ provider, accountId, exhaustedUntil });
    this.save(entries);
  }
  isExhausted(provider: ClosedProvider, accountId: string): boolean { return this.list().some(e => e.provider === provider && e.accountId === accountId); }
}
