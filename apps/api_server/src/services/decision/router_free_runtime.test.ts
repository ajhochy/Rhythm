import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { defaultRouterGridConfig } from './router_grid_config';
import type { GridAccount } from './router_grid_select';
import { checkFreeMode, freeCapacity, holdForFreeMode, releaseFreeQueue } from './router_free_runtime';

const now = Date.parse('2026-10-09T12:00:00Z');
const enabled = (budget = 0) => { const c = defaultRouterGridConfig(); c.free_mode = { ...c.free_mode, enabled: true, paid_openrouter_budget_usd: budget }; return c; };
const path = () => join(mkdtempSync(join(tmpdir(), 'free-runtime-')), 'router-free-state.json');
const accounts = (pct: number | null, exhaustedUntil: number | null = null): GridAccount[] => (['anthropic', 'openai'] as const)
  .flatMap(provider => [1, 2].map(n => ({ id: `${provider}-${n}`, provider, quotaRemainingPct: pct, resetsAt: null, exhaustedUntil })));
const classification = { tier: 3 as const, category: 'knowledge' as const, canQueue: false };

describe('Free Mode runtime (F1 hold, F2 release, F3 gate)', () => {
  it('disabled config never activates or creates state', () => {
    const statePath = path();
    expect(checkFreeMode({ config: defaultRouterGridConfig(), accounts: accounts(0), usageFresh: true, openrouterUsable: false, tier: 3, now, statePath }))
      .toMatchObject({ enabled: false, active: false, recovered: false });
    expect(existsSync(statePath)).toBe(false);
  });
  it('activates only on all four verified-exhausted accounts; budget 0 means paid OpenRouter never substitutes', () => {
    const base = { usageFresh: true, tier: 3 as const, now };
    expect(checkFreeMode({ ...base, config: enabled(), accounts: accounts(0), openrouterUsable: true, statePath: path() }).active).toBe(true);
    expect(checkFreeMode({ ...base, config: enabled(5), accounts: accounts(0), openrouterUsable: true, statePath: path() }).active).toBe(false);
    expect(checkFreeMode({ ...base, config: enabled(), accounts: accounts(0).slice(1), openrouterUsable: false, statePath: path() }).active).toBe(false);
    expect(checkFreeMode({ ...base, config: enabled(), accounts: accounts(null), openrouterUsable: false, statePath: path() }).active).toBe(false);
  });
  it('a reset deadline or stale positive quota is not recovery; only fresh positive quota recovers', () => {
    const config = enabled(), statePath = path();
    expect(holdForFreeMode({ config, taskId: 'session:a', ownerUserId: 1, reference: 'session:a', classification, now, statePath }).durable).toBe(true);
    const expiredCooldown = accounts(null, now - 1);
    expect(freeCapacity(expiredCooldown, true, now).every(a => a.exhausted === 'unknown')).toBe(true);
    for (const [list, fresh] of [[expiredCooldown, true], [accounts(50), false]] as const) {
      expect(checkFreeMode({ config, accounts: list, usageFresh: fresh, openrouterUsable: false, tier: 3, now, statePath }))
        .toMatchObject({ active: true, recovered: false });
    }
    expect(checkFreeMode({ config, accounts: accounts(50), usageFresh: true, openrouterUsable: false, tier: 3, now, statePath }))
      .toMatchObject({ active: false, recovered: true });
  });
  it('hold persists a body-free descriptor with unknown privacy, once per task', () => {
    const config = enabled(), statePath = path();
    for (let i = 0; i < 2; i++) holdForFreeMode({ config, taskId: 'scheduled:t1', ownerUserId: null, reference: 'scheduled:t1', classification, now, statePath });
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state.queue).toEqual([{ taskId: 'scheduled:t1', ownerUserId: 'system', reference: 'scheduled:t1', enqueuedAt: now,
      classification: { tier: 3, category: 'knowledge', canQueue: false, containsPrivateData: 'unknown' } }]);
    expect(state.dailyCount).toBe(0); // zero Free calls committed
  });
  it('release goes Tier 1 first then oldest, rechecks owner/target, and never replays', async () => {
    const config = enabled(), statePath = path();
    const hold = (ref: string, tier: 1 | 2 | 3, at: number, owner: number | null = 1) =>
      holdForFreeMode({ config, taskId: ref, ownerUserId: owner, reference: ref, classification: { ...classification, tier }, now: at, statePath });
    hold('session:old-t3', 3, now - 300); hold('session:t2', 2, now - 200); hold('session:new-t1', 1, now - 100);
    hold('session:gone', 2, now - 400); hold('session:other-owner', 2, now - 500);
    const notified: string[] = [];
    const result = await releaseFreeQueue(config, {
      currentOwner: async ref => ref === 'session:gone' ? undefined : ref === 'session:other-owner' ? 2 : 1,
      release: async ref => { notified.push(ref); },
    }, statePath);
    expect(notified).toEqual(['session:new-t1', 'session:old-t3', 'session:t2']);
    expect(result.dropped.sort()).toEqual(['session:gone', 'session:other-owner']);
    expect(JSON.parse(readFileSync(statePath, 'utf8')).queue).toEqual([]);
  });
});
