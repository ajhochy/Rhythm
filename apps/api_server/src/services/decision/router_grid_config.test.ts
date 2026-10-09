import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as mod from './router_grid_config';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function api() { expect(mod, 'config exports must exist').not.toBeNull(); return mod!; }
describe('grid config rejects unsafe overrides and resolves aliases', () => {
  it('defaults retain calibrated thresholds, reserve, all category/tier routes', () => {
    const c = api().defaultRouterGridConfig();
    expect(c.classifier.tier_thresholds).toEqual([0.1, 0.35, 2.25]); expect(c.reserve_pct).toBe(15);
    expect(c.routing.knowledge).toEqual(c.routing.coding);
    expect(c.routing.design[3][0].effort).toBe('high');
  });
  it('partial override merges objects, replaces arrays, SAME_AS follows overridden source', () => {
    const c = api().normaliseRouterGridConfig({ reserve_pct: 20, routing: { coding: { 4: [{ model: 'openai/gpt-6-luna', effort: 'low', cost_per_task: 0 }] } } });
    expect(c.reserve_pct).toBe(20); expect(c.routing.coding[4]).toHaveLength(1);
    expect(c.routing.knowledge[4]).toEqual(c.routing.coding[4]); expect(c.routing.coding[2]).toHaveLength(2);
  });
  it('mtime cache reloads changed override and falls back on malformed or missing file', () => {
    const d = mkdtempSync(join(tmpdir(), 'grid-config-')); dirs.push(d); const p = join(d, 'router-grid.json');
    writeFileSync(p, '{"reserve_pct":20}'); const a = api().loadRouterGridConfig(p);
    expect(a.reserve_pct).toBe(20); expect(api().loadRouterGridConfig(p)).toBe(a);
    writeFileSync(p, '{"reserve_pct":25.5}'); expect(api().loadRouterGridConfig(p).reserve_pct).toBe(25.5);
    writeFileSync(p, '{bad'); expect(api().loadRouterGridConfig(p).reserve_pct).toBe(15);
    expect(api().loadRouterGridConfig(join(d, 'missing')).reserve_pct).toBe(15);
  });
  it.each([
    { reserve_pct: -1 }, { reserve_pct: 101 }, { classifier: { tier_thresholds: [0.35, 0.1, 2.25] } },
    { classifier: { tier_thresholds: [0, 1, 4] } }, { classifier: { can_queue_min_p: 2 } },
    { classifier: { security_min_p: -1 } }, { classifier: { rules_default_tier: 0 } },
    { routing: { coding: 'SAME_AS:knowledge', knowledge: 'SAME_AS:coding' } },
    { routing: { knowledge: 'SAME_AS:missing' } }, { routing: { coding: { 4: [{ model: 'missing', effort: 'low' }] } } },
    { models: { 'openai/gpt-6-luna': { price_in: -1 } } }, { openrouter_fallback: { coding: { 4: { models: ['openai/gpt-6-luna'] } } } },
  ])('invalid merged config throws rather than publishing %j', raw => { const m = api(); expect(() => m.normaliseRouterGridConfig(raw)).toThrow(); });
});
