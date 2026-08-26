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

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read().catch(() => null);
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out waiting for engine respawn and bridge recovery');
}

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

  it('reattaches while api_server stays up after the isolated engine respawns', async () => {
    expect(new URL(API_BASE).port).toBe('4098');
    expect(new URL(ENGINE_BASE).port).toBe('4097');
    const apiBefore = await fetch(`${API_BASE}/health`);
    expect(apiBefore.status).toBe(200);
    const first = await (await fetch(`${ENGINE_BASE}/global/health`)).json() as {
      pid: number;
      bootId: string;
    };

    process.kill(first.pid, 'SIGTERM');

    const second = await waitFor(async () => {
      const response = await fetch(`${ENGINE_BASE}/global/health`);
      if (!response.ok) return null;
      const identity = await response.json() as { pid: number; bootId: string };
      return identity.pid !== first.pid && identity.bootId !== first.bootId
        ? identity
        : null;
    });
    expect(second.pid).not.toBe(first.pid);

    const bridge = await waitFor(async () => {
      const response = await fetch(`${API_BASE}/opencode/health`);
      if (!response.ok) return null;
      const health = await response.json() as { status: string; bridgeLive: boolean };
      return health.status === 'ready' && health.bridgeLive ? health : null;
    });
    expect(bridge).toMatchObject({ status: 'ready', bridgeLive: true });
  }, 45_000);
});
