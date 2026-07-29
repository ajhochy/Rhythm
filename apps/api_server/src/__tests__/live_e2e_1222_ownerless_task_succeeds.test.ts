/**
 * Live E2E — issue #1222, "Live test: trigger a legacy ownerless task and
 * confirm success."
 *
 * #1222's own investigation found the strongest correlate of the legacy
 * 26-row Postgres collection's 100% failure rate was `created_by_user_id:
 * null` — but also found a COUNTER-example already on the local instance:
 * the seeded "Memory Consolidation" task is itself ownerless
 * (createdByUserId: null) and succeeds there. Tracing the code confirms
 * ownership is never consulted by session creation (only by memory
 * retrieval scoping) — so the correlation is with WHICH ENGINE handles the
 * row, not ownership itself. This test proves the corollary live: against a
 * genuinely healthy local engine (this sandbox), an ownerless
 * (createdByUserId: null) scheduled task runs successfully, exactly like the
 * owned ones — confirming ownership was never the causal gate, and that the
 * real fix (#1222's error-surfacing + #1214's quarantine of the actually-
 * broken host) is the correct one rather than adding a new ownership check
 * that would have broken this legitimate case.
 *
 * Run against the isolated dev sandbox (see docs/ai/testing-guide.md):
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4242 \
 *   DB_PATH=/tmp/rhythm-sandbox-scheduler/rhythm.db \
 *   npx vitest run src/__tests__/live_e2e_1222_ownerless_task_succeeds.test.ts
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const describeLive = LIVE ? describe : describe.skip;

// #1222 live guard: assert this points at a LOCAL sandbox, never a specific
// pinned port — the sandbox's chosen port varies by run/parallel session.
function assertLocalNonDefaultUrl(url: string): void {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLoopback) {
    throw new Error(`[live-E2E] RHYTHM_LIVE_URL must be a loopback host, got: ${host}`);
  }
  if (parsed.port === '4000' || parsed.port === '4001') {
    throw new Error(
      `[live-E2E] RHYTHM_LIVE_URL must not be the real app's port (4000/4001), got: ${parsed.port}`,
    );
  }
}

const MODEL = {
  provider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'openrouter',
  id: process.env.RHYTHM_LIVE_MODEL_ID || 'anthropic/claude-haiku-4.5',
};

let createdScheduleIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 2000,
  label = 'poll',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms — last: ${String(lastErr)}`);
}

afterEach(async () => {
  for (const id of createdScheduleIds) await api(`/agent-schedules/${id}`, { method: 'DELETE' }).catch(() => {});
  createdScheduleIds = [];
});

describeLive('live E2E — #1222 an ownerless (createdByUserId: null) scheduled task succeeds on a healthy engine', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    assertLocalNonDefaultUrl(BASE);
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start the sandbox first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${eng.status})`);
    }
  });

  it(
    'a schedule created with NO auth header (createdByUserId: null) runs to success',
    async () => {
      // Deliberately no Authorization header — mirrors how the legacy/system
      // schedules (e.g. the seeded Memory Consolidation task) end up
      // ownerless: created_by_user_id is populated ONLY from req.auth?.user.id.
      const schedule = await apiJson<{ id: string; createdByUserId: number | null }>(
        '/agent-schedules',
        {
          method: 'POST',
          body: JSON.stringify({
            name: 'E2E ownerless task 1222',
            scheduleType: 'daily',
            scheduledTime: '23:59',
            prompt: 'Reply with the single word: acknowledged.',
            modelProvider: MODEL.provider,
            modelId: MODEL.id || undefined,
          }),
        },
      );
      createdScheduleIds.push(schedule.id);
      expect(schedule.createdByUserId).toBeNull();

      await api(`/agent-schedules/${schedule.id}/trigger-now`, { method: 'POST' });

      const finished = await poll(
        async () => {
          const task = await apiJson<{ lastRunStatus: string | null; lastError: string | null }>(
            `/agent-schedules/${schedule.id}`,
          );
          if (task.lastRunStatus !== 'success' && task.lastRunStatus !== 'error') {
            throw new Error(`still ${task.lastRunStatus ?? 'pending'}`);
          }
          return task;
        },
        150_000, // up to 1 cron tick (60s) + a real LLM turn
        2_000,
        'ownerless scheduled run to finish',
      );

      // Either the run succeeds outright, or — if it fails for some
      // environment reason (e.g. missing sandbox credentials) — the error
      // must be the REAL, specific reason (#1222's fix), never the old
      // generic "AgentRunner: failed to create opencode session".
      if (finished.lastRunStatus === 'error') {
        expect(finished.lastError).not.toBe('AgentRunner: failed to create opencode session');
      }
      expect(finished.lastRunStatus, `run failed: ${finished.lastError}`).toBe('success');
    },
    180_000,
  );
});
