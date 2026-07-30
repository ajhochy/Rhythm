/**
 * R3 env-gated live contract. WRITE-ONLY in the R3 implementation workstream;
 * do not run there because its action-safety policy forbids starting or using
 * the sandbox/API/engine.
 *
 * Exact test command (after an isolated sandbox is already running):
 *   cd apps/api_server
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   DB_PATH=/tmp/rhythm-r3-live/rhythm.db \
 *   RHYTHM_LIVE_DB_PATH=/tmp/rhythm-r3-live/rhythm.db \
 *   npx vitest run src/__tests__/r3_scheduled_failure_live_e2e.test.ts \
 *     --no-file-parallelism
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const describeLive = LIVE ? describe : describe.skip;
const createdScheduleIds: string[] = [];

function assertSafeBase(url: string): void {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error(`RHYTHM_LIVE_URL must be loopback, got ${parsed.hostname}`);
  }
  if (parsed.port === '4000' || parsed.port === '4001') {
    throw new Error(`RHYTHM_LIVE_URL must not target the installed app port: ${parsed.port}`);
  }
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status}: ${text}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function poll<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let latest!: T;
  while (Date.now() < deadline) {
    latest = await read();
    if (accept(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`condition not met within ${timeoutMs}ms: ${JSON.stringify(latest)}`);
}

afterEach(async () => {
  for (const id of createdScheduleIds.splice(0)) {
    await fetch(`${BASE}/agent-schedules/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
});

describeLive('R3 scheduled infrastructure failure live contract', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    assertSafeBase(BASE);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    expect(engine.status).toBe('ready');
  });

  it(
    'r3-c7-live: required-MCP infrastructure failure creates one categorized result and no teacher duplicate',
    async () => {
      const missingMcp = `r3-missing-${randomUUID().slice(0, 8)}`;
      const schedule = await apiJson<{ id: string }>('/agent-schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: `R3 single-result ${missingMcp}`,
          scheduleType: 'once',
          runAt: new Date(Date.now() + 86_400_000).toISOString(),
          timezone: 'America/Los_Angeles',
          prompt: 'This prompt must never reach a model.',
          agentKind: 'opencode',
          allowedMcps: [missingMcp],
        }),
      });
      createdScheduleIds.push(schedule.id);

      await apiJson(`/agent-schedules/${schedule.id}/trigger-now`, {
        method: 'POST',
        body: '{}',
      });

      const terminal = await poll(
        () =>
          apiJson<{ lastRunStatus: string | null; lastError: string | null }>(
            `/agent-schedules/${schedule.id}`,
          ),
        (task) => task.lastRunStatus === 'error',
        75_000,
      );
      expect(terminal.lastError).toMatch(/required_mcp_unavailable/i);
      expect(terminal.lastError).toContain(missingMcp);

      const sessionList = await apiJson<{
        sessions: Array<{ id: string; name: string; scheduledTaskId: string | null }>;
      }>(`/agent-sessions?scheduledTaskId=${encodeURIComponent(schedule.id)}`);
      const matching = sessionList.sessions.filter(
        (session) => session.scheduledTaskId === schedule.id,
      );
      expect(matching).toHaveLength(1);
      expect(matching[0].name).not.toMatch(/teacher escalation/i);
    },
    90_000,
  );
});
