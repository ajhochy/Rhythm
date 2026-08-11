/**
 * Live bridge-health probe for issue #1325.
 *
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
 *   npx vitest run src/__tests__/issue_1325_live_e2e.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const API_BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE_BASE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const describeLive = LIVE ? describe : describe.skip;

describeLive('issue #1325 live engine/bridge health', () => {
  beforeAll(() => assertLiveE2EIsolation());

  it('reports ready only with a live bridge and exposes stable boot identity', async () => {
    const apiHealthResponse = await fetch(`${API_BASE}/opencode/health`);
    expect(apiHealthResponse.status).toBe(200);
    expect(await apiHealthResponse.json()).toMatchObject({
      status: 'ready',
      bridgeLive: true,
    });

    const firstResponse = await fetch(`${ENGINE_BASE}/global/health`);
    const secondResponse = await fetch(`${ENGINE_BASE}/global/health`);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    const first = await firstResponse.json() as {
      healthy: boolean;
      version: string;
      pid: number;
      bootId: string;
    };
    const second = await secondResponse.json();
    expect(first.healthy).toBe(true);
    expect(first.pid).toBeGreaterThan(0);
    expect(first.bootId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toEqual(first);
  });
});
