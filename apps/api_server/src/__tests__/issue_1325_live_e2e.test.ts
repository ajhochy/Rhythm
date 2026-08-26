/**
 * Live bridge-health probe for issue #1325.
 *
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
 *   npx vitest run src/__tests__/issue_1325_live_e2e.test.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const API_BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE_BASE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const SANDBOX = process.env.RHYTHM_SANDBOX_DIR ?? '';
const ROOT = resolve(__dirname, '../../../..');
const SANDBOX_SCRIPT = resolve(ROOT, 'tools/dev/sandbox.sh');
const describeLive = LIVE ? describe : describe.skip;

function recordedPid(name: 'api_server.pid' | 'opencode_engine.pid'): number {
  return Number(readFileSync(resolve(SANDBOX, name), 'utf8').trim());
}

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
  beforeAll(() => {
    assertLiveE2EIsolation();
    expect(SANDBOX.startsWith('/')).toBe(true);
  });

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
    const apiPid = recordedPid('api_server.pid');
    const first = await (await fetch(`${ENGINE_BASE}/global/health`)).json() as {
      pid: number;
      bootId: string;
    };

    expect(recordedPid('opencode_engine.pid')).toBe(first.pid);
    process.kill(first.pid, 'SIGTERM');

    await waitFor(async () => {
      const available = await fetch(`${ENGINE_BASE}/global/health`)
        .then((response) => response.ok)
        .catch(() => false);
      return available ? null : true;
    });
    const degraded = await waitFor(async () => {
      const response = await fetch(`${API_BASE}/opencode/health`);
      const health = await response.json() as {
        status: string;
        bridgeLive: boolean;
        message: string;
      };
      return !health.bridgeLive ? health : null;
    });
    expect(degraded).toMatchObject({ status: 'unavailable', bridgeLive: false });

    execFileSync(SANDBOX_SCRIPT, ['restart-engine'], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      timeout: 30_000,
    });
    expect(recordedPid('api_server.pid')).toBe(apiPid);

    const second = await waitFor(async () => {
      const response = await fetch(`${ENGINE_BASE}/global/health`);
      if (!response.ok) return null;
      const identity = await response.json() as { pid: number; bootId: string };
      return identity.pid !== first.pid && identity.bootId !== first.bootId
        ? identity
        : null;
    });
    expect(second.pid).not.toBe(first.pid);
    expect(second.bootId).not.toBe(first.bootId);
    expect(recordedPid('opencode_engine.pid')).toBe(second.pid);

    const bridge = await waitFor(async () => {
      const response = await fetch(`${API_BASE}/opencode/health`);
      if (!response.ok) return null;
      const health = await response.json() as { status: string; bridgeLive: boolean };
      return health.status === 'ready' && health.bridgeLive ? health : null;
    });
    expect(bridge).toMatchObject({ status: 'ready', bridgeLive: true });
  }, 75_000);
});
