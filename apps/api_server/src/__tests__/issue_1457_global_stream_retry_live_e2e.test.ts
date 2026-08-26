/**
 * Live behavioral gate for #1457. Run only after the shared sandbox is assigned:
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 DB_PATH=<sandbox>/rhythm.db \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
 * npx vitest run src/__tests__/issue_1457_global_stream_retry_live_e2e.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const API = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json() as Promise<T>;
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read().catch(() => null);
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out waiting for engine/bridge recovery');
}

describeLive('issue #1457 live global stream recovery', () => {
  beforeAll(() => {
    assertLiveE2EIsolation();
    expect(new URL(API).port).toBe('4098');
    expect(new URL(ENGINE).port).toBe('4097');
  });

  it('recovers the bridge after the isolated engine process is replaced', async () => {
    const before = await json<{ pid: number; bootId: string }>(`${ENGINE}/global/health`);
    process.kill(before.pid, 'SIGTERM');

    const after = await waitFor(async () => {
      const identity = await json<{ pid: number; bootId: string }>(`${ENGINE}/global/health`);
      return identity.pid !== before.pid && identity.bootId !== before.bootId ? identity : null;
    });
    expect(after.pid).not.toBe(before.pid);

    const health = await waitFor(async () => {
      const value = await json<{ status: string; bridgeLive: boolean }>(`${API}/opencode/health`);
      return value.status === 'ready' && value.bridgeLive ? value : null;
    });
    expect(health).toMatchObject({ status: 'ready', bridgeLive: true });
  }, 45_000);
});
