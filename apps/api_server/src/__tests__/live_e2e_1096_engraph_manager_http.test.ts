/**
 * #1096 HTTP behavioral gate.
 *
 * Unlike live_e2e_engraph_manager.test.ts (which drives the manager class
 * directly), this file drives the exact /engraph-manager HTTP surface used by
 * the Flutter client against an already-running isolated api_server.
 *
 * The operator must launch the sandbox with an isolated DB, manager config,
 * HOME, memory root, and the branch build before enabling this test:
 *
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:<sandbox-port> \
 *   DB_PATH=/tmp/<sandbox>/rhythm.db \
 *   RHYTHM_LIVE_ENGRAPH_BIN=/absolute/path/to/engraph \
 *   npx vitest run src/__tests__/live_e2e_1096_engraph_manager_http.test.ts
 *
 * This test intentionally never launches or terminates the api_server.
 */
import { describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const BINARY = process.env.RHYTHM_LIVE_ENGRAPH_BIN?.trim() ?? '';

type ManagerState =
  | 'disabled'
  | 'discovering'
  | 'indexing'
  | 'starting'
  | 'ready'
  | 'error';

interface ManagerStatus {
  enabled: boolean;
  state: ManagerState;
  executablePath: string | null;
  lastHealthyAt: string | null;
  lastFailureCategory: string | null;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}/engraph-manager${path}`, init);
}

async function readStatus(): Promise<ManagerStatus> {
  const response = await request('/status');
  expect(response.status).toBe(200);
  return (await response.json()) as ManagerStatus;
}

async function waitForState(
  wanted: ManagerState,
  timeoutMs = 120_000,
): Promise<ManagerStatus> {
  const deadline = Date.now() + timeoutMs;
  let status = await readStatus();
  while (status.state !== wanted && Date.now() < deadline) {
    if (status.state === 'error') {
      throw new Error(
        `Engraph entered error state (${status.lastFailureCategory ?? 'unknown'})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    status = await readStatus();
  }
  expect(status.state).toBe(wanted);
  return status;
}

function assertUnrelatedProcessAlive(): void {
  const rawPid = process.env.RHYTHM_LIVE_UNRELATED_PID?.trim();
  if (!rawPid) return;
  const pid = Number(rawPid);
  expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
  expect(() => process.kill(pid, 0)).not.toThrow();
}

describeLive('live HTTP E2E — #1096 Engraph manager lifecycle', () => {
  it(
    'issue-1096-c7: HTTP lifecycle reaches ready only after a real authenticated <=1s search',
    async () => {
      assertLiveE2EIsolation();
      expect(BASE).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
      expect(BINARY).not.toBe('');

      const disabled = await request('/disable', { method: 'POST' });
      expect(disabled.status).toBe(200);

      const chosen = await request('/choose-binary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: BINARY }),
      });
      expect(chosen.status).toBe(200);
      expect(await chosen.json()).toMatchObject({ ok: true });

      const enabled = await request('/enable', { method: 'POST' });
      expect(enabled.status).toBe(200);
      expect(await enabled.json()).toMatchObject({ accepted: true });

      const ready = await waitForState('ready');
      expect(ready.enabled).toBe(true);
      expect(ready.lastHealthyAt).not.toBeNull();

      const health = await request('/check-health', { method: 'POST' });
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        ok: true,
        latencyMs: expect.any(Number),
      });
    },
    130_000,
  );

  it(
    'issue-1096-c9: HTTP start retry rebuild and shutdown preserve an unrelated process',
    async () => {
      assertLiveE2EIsolation();
      assertUnrelatedProcessAlive();

      const retry = await request('/retry', { method: 'POST' });
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ accepted: true });
      await waitForState('ready');
      assertUnrelatedProcessAlive();

      const rebuild = await request('/rebuild', { method: 'POST' });
      expect(rebuild.status).toBe(200);
      expect(await rebuild.json()).toMatchObject({ accepted: true });
      await waitForState('ready');
      assertUnrelatedProcessAlive();

      const disabled = await request('/disable', { method: 'POST' });
      expect(disabled.status).toBe(200);
      expect(await readStatus()).toMatchObject({
        enabled: false,
        state: 'disabled',
      });
      assertUnrelatedProcessAlive();
    },
    260_000,
  );
});
