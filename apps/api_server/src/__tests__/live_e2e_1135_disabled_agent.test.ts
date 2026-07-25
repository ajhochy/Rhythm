/**
 * Live E2E test for #1135 — disabled agent profiles must be fully invisible
 * and un-invokable at the engine boundary.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Drives the running sandbox api_server + real opencode engine (never
 * the live app — see `assertLiveE2EIsolation`).
 *
 * Run it against the dev sandbox (`tools/dev/sandbox.sh up`):
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   DB_PATH=<sandbox dir>/rhythm.db \
 *   npx vitest run src/__tests__/live_e2e_1135_disabled_agent.test.ts
 *
 * What it proves (the issue's acceptance criterion, items 1/2/4): PATCH
 * enabled:false on an agent_configs row (a) removes it from
 * GET /agent-sessions/agents within a bounded reload window, and (b)
 * re-enabling makes it reappear — asserting the OBSERVABLE response state,
 * not that any function ran.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const AGENTS_DIR = join(homedir(), '.config', 'opencode', 'agents');

const describeLive = LIVE ? describe : describe.skip;

let createdAgentIds: string[] = [];

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
  intervalMs = 1000,
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

async function listAgentIds(): Promise<string[]> {
  const { agents } = await apiJson<{ agents: Array<{ name: string }> }>('/agent-sessions/agents');
  return agents.map((a) => a.name);
}

afterEach(async () => {
  for (const id of createdAgentIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
    await rm(join(AGENTS_DIR, `${id}.md`), { force: true }).catch(() => {});
  }
  createdAgentIds = [];
});

describeLive('live E2E — #1135 disabled agent profile purged from projection + registry', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start the sandbox first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${eng.status})`);
    }
  });

  it(
    'PATCH enabled:false removes the profile from the live registry; re-enabling brings it back',
    async () => {
      // 1. Create an enabled, session-selectable profile — the exact shape
      //    that gets projected to ~/.config/opencode/agents/<id>.md.
      const cfg = await apiJson<{ id: string; enabled: boolean }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          label: 'E2E Disabled Agent Purge 1135',
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          systemPrompt: 'You are a terse test agent.',
        }),
      });
      createdAgentIds.push(cfg.id);
      expect(cfg.enabled).toBe(true);

      // 2. Confirm it appears in the live registry before disabling.
      await poll(
        async () => {
          const ids = await listAgentIds();
          if (!ids.includes(cfg.id)) throw new Error('not yet listed');
        },
        20_000,
        1_000,
        'profile to appear in agent-sessions/agents',
      );

      // 3. Act — disable it.
      const disabled = await apiJson<{ enabled: boolean }>(`/agent-configs/${cfg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      });
      expect(disabled.enabled).toBe(false);

      // 4. PASS iff the id disappears from the live registry within a bounded
      //    retry window (absorbs the sub-second write→reload race).
      await poll(
        async () => {
          const ids = await listAgentIds();
          if (ids.includes(cfg.id)) throw new Error('still listed after disable');
        },
        20_000,
        1_000,
        'profile to disappear from agent-sessions/agents after disable',
      );

      // 5. Restore — re-enable and confirm it reappears (guards item 6:
      //    re-enable re-projects current model/prompt, not a stale file).
      const reenabled = await apiJson<{ enabled: boolean }>(`/agent-configs/${cfg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: true }),
      });
      expect(reenabled.enabled).toBe(true);

      await poll(
        async () => {
          const ids = await listAgentIds();
          if (!ids.includes(cfg.id)) throw new Error('not yet re-listed');
        },
        20_000,
        1_000,
        'profile to reappear in agent-sessions/agents after re-enable',
      );
    },
    90_000,
  );
});
