import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as mod from './router_grid_exhaustion';
import * as selector from './router_grid_select';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
describe('grid exhaustion store and cached snapshot adapter', () => {
  it('exhaustion survives fresh store, expires and prunes on disk, provider-scoped', () => {
    expect(mod, 'store export must exist').not.toBeNull();
    const d = mkdtempSync(join(tmpdir(), 'grid-exhaustion-')); dirs.push(d); const p = join(d, 'exhaustion.json');
    let now = 1000;
    const store = new mod!.RouterGridExhaustionStore(p, () => now);
    store.markExhausted('anthropic', 'runtime-id', 2000);
    expect(new mod!.RouterGridExhaustionStore(p, () => now).isExhausted('anthropic', 'runtime-id')).toBe(true);
    expect(store.isExhausted('openai', 'runtime-id')).toBe(false);
    expect(store.list()).toEqual([{ provider: 'anthropic', accountId: 'runtime-id', exhaustedUntil: 2000 }]);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    now = 2000; expect(store.isExhausted('anthropic', 'runtime-id')).toBe(false);
    expect(store.list()).toEqual([]); expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual([]);
    expect(() => store.markExhausted('openai', 'id', NaN)).toThrow();
    writeFileSync(p, '{bad'); expect(new mod!.RouterGridExhaustionStore(p, () => now).list()).toEqual([]);
  });
  it('adapter discovers runtime IDs, min windows, earliest valid reset, unknown usage and exhaustion', () => {
    expect(selector, 'adapter export must exist').not.toBeNull();
    const result = selector!.accountsFromSnapshot({ fetchedAt: '2026-10-08T00:00:00Z', providers: [
      { provider: 'anthropic', accountId: 'discovered', label: 'a', kind: 'window', items: [{ label: '5h', remainingFraction: 0.8, resetAt: '2026-10-08T02:00:00Z' }, { label: '7d', remainingFraction: 0.2, resetAt: '2026-10-08T01:00:00Z' }] },
      { provider: 'openai', accountId: 'unknown', label: 'o', kind: 'window', items: [{ label: '5h', remainingFraction: null }] },
      { provider: 'openrouter', label: 'r', kind: 'credits', items: [] },
      { provider: 'openai', label: 'no-id', kind: 'window', items: [] },
      { provider: 'anthropic', accountId: 'unavailable', label: 'a', kind: 'unavailable', items: [] },
    ] }, [{ provider: 'anthropic', accountId: 'discovered', exhaustedUntil: 123 }]);
    expect(result).toEqual([
      { id: 'discovered', provider: 'anthropic', quotaRemainingPct: 20, resetsAt: Date.parse('2026-10-08T01:00:00Z'), exhaustedUntil: 123 },
      { id: 'unknown', provider: 'openai', quotaRemainingPct: null, resetsAt: null, exhaustedUntil: null },
    ]);
  });
});
