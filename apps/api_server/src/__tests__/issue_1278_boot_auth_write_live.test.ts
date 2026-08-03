/**
 * Live behavioral contract for #1278.
 *
 * The test observes one real isolated api_server + fork-engine boot. It proves
 * the auth watcher is armed only after restoreAuth finishes writing the
 * server-owned credential snapshot, so that write cannot immediately bounce
 * the engine that was just spawned.
 *
 * Required:
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:<non-production-port> \
 *   DB_PATH=/tmp/<sandbox>/rhythm.db \
 *   RHYTHM_SANDBOX_DIR=/tmp/<sandbox> \
 *   RHYTHM_LIVE_SERVER_LOG=/tmp/<sandbox>/api_server.log \
 *   npx vitest run src/__tests__/issue_1278_boot_auth_write_live.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const sandboxDir = resolve(process.env.RHYTHM_SANDBOX_DIR ?? '');
const serverLogPath = resolve(process.env.RHYTHM_LIVE_SERVER_LOG ?? '');

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describeLive('issue #1278 boot auth-write bounce regression', () => {
  it('issue-1278-c1: startup-owned auth reconciliation does not bounce the freshly initialized engine', async () => {
    assertLiveE2EIsolation();
    if (
      !/^http:\/\/127\.0\.0\.1:(?!4001$)\d{4,5}$/.test(baseUrl) ||
      !sandboxDir.startsWith('/private/tmp/') ||
      serverLogPath !== resolve(sandboxDir, 'api_server.log')
    ) {
      throw new Error(
        'Issue #1278 live test requires the isolated sandbox URL, directory, and api_server.log',
      );
    }

    const healthResponse = await fetch(`${baseUrl}/opencode/health`);
    expect(healthResponse.status).toBe(200);
    expect((await healthResponse.json()) as { status: string }).toMatchObject({
      status: 'ready',
    });

    // Let any debounced auth.json watcher reaction complete before inspecting
    // the stable boot transcript.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_250));

    const logs = readFileSync(serverLogPath, 'utf8');
    const restoreFinishedAt = logs.indexOf('[Opencode][timing] restoreAuth took');
    const watcherArmedAt = logs.indexOf('[server] auth credential watcher started (#856)');

    expect(restoreFinishedAt).toBeGreaterThanOrEqual(0);
    expect(watcherArmedAt).toBeGreaterThan(restoreFinishedAt);
    expect(
      countOccurrences(
        logs,
        '[OpencodeClientService] reloadCredentials: bouncing engine to pick up changed auth.json',
      ),
    ).toBe(0);
    expect(countOccurrences(logs, '[OpencodeClientService] SDK initialized')).toBe(1);
  });
});
