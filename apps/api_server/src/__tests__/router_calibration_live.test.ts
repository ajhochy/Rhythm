import { describe, expect, it } from 'vitest';
import { gridTierFromScore } from '../services/decision/router_grid_classifier';

// Complement to the packaged real-model turn: exercise the updated default through an isolated API/engine.
describe.skipIf(process.env.RHYTHM_LIVE_E2E !== '1')('Grid calibration defaults through the dev sandbox', () => {
  it('serves the revised edit boundary while preserving capable routes', async () => {
    const api = process.env.RHYTHM_LIVE_API_URL;
    const engine = process.env.RHYTHM_LIVE_ENGINE_URL;
    expect(api, 'requires the isolated sandbox API').toBe('http://127.0.0.1:4098');
    expect(engine, 'requires the isolated sandbox engine').toBe('http://127.0.0.1:4097');
    const get = async (url: string) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(await get(`${api}/health`)).toMatchObject({ status: 'ok' });
    expect(await get(`${api}/opencode/health`)).toMatchObject({ status: 'ready' });
    expect(await get(`${engine}/global/health`)).toMatchObject({ healthy: true });
    const grid = await get(`${api}/agent-decisions/grid`) as {
      source: string; classifier: { tier_thresholds: [number, number, number] };
      routing: { coding: Record<number, Array<{ model: string }>> };
    };
    expect(grid.source).toBe('defaults');
    expect(grid.classifier.tier_thresholds).toEqual([0.1, 1.5, 2.25]);
    expect(gridTierFromScore(0.85, grid.classifier.tier_thresholds)).toBe(3);
    expect(gridTierFromScore(2.01, grid.classifier.tier_thresholds)).toBe(2);
    expect(gridTierFromScore(2.97, grid.classifier.tier_thresholds)).toBe(1);
    expect(grid.routing.coding[3][0].model).toBe('anthropic/claude-haiku-5-5');
  }, 60_000);
});
