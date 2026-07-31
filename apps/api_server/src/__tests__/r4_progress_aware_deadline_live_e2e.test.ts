/**
 * Live behavioral contract for workstream R4.
 *
 * The sandbox api_server MUST start with the short legacy wall value plus the
 * new policy knobs. The bound profile performs separate one-second tool calls,
 * producing real message/part activity for longer than the former wall limit.
 *
 * Deferred command (do not run from an implementation agent):
 *
 *   AGENT_RUN_TIMEOUT_MS=5000 \
 *   AGENT_RUN_INACTIVITY_TIMEOUT_MS=5000 \
 *   AGENT_RUN_HARD_TIMEOUT_MS=45000 \
 *     tools/dev/sandbox.sh up
 *
 *   cd apps/api_server
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   DB_PATH=<sandbox-dir>/rhythm.db \
 *   RHYTHM_LIVE_OLD_WALL_MS=5000 \
 *     npx vitest run src/__tests__/r4_progress_aware_deadline_live_e2e.test.ts
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const OLD_WALL_MS = Number(process.env.RHYTHM_LIVE_OLD_WALL_MS ?? 5_000);
const MODEL = {
  provider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'openrouter',
  id: process.env.RHYTHM_LIVE_MODEL_ID || 'anthropic/claude-haiku-4.5',
};
const describeLive = LIVE ? describe : describe.skip;

let agentIds: string[] = [];
let recipeIds: string[] = [];
let sessionIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const result = await api(path, init);
  const text = await result.text();
  if (!result.ok) throw new Error(`${path} -> ${result.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

afterEach(async () => {
  for (const id of sessionIds) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of recipeIds) {
    await api(`/agent-cookbook/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of agentIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  agentIds = [];
  recipeIds = [];
  sessionIds = [];
});

describeLive('live E2E — R4 progress-aware AgentRunner deadline', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const health = await api('/health');
    if (!health.ok) throw new Error(`sandbox server is not reachable at ${BASE}`);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    if (engine.status !== 'ready') {
      throw new Error(`fork engine is not ready (status=${engine.status})`);
    }
  });

  it(
    'issue-0-c5: a progressing headless run outlives the former wall deadline',
    async () => {
      const suffix = Date.now();
      const profileId = `r4-progress-${suffix}`;
      const profile = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: profileId,
          label: `R4 progress probe ${suffix}`,
          enabled: true,
          isAgent: true,
          sessionSelectable: true,
          modelProvider: MODEL.provider,
          modelId: MODEL.id,
          ocAgent: profileId,
          allowedMcpsJson: '[]',
          allowedSkillsJson: '[]',
          corePermissionsJson: JSON.stringify({ read: 'deny', bash: 'allow' }),
          systemPrompt:
            'Make exactly eight separate bash tool calls in order. ' +
            'Call 1 runs `sleep 1; printf tick-1`, call 2 runs `sleep 1; printf tick-2`, ' +
            'and continue through tick-8. Never combine calls. After all eight, reply DONE.',
        }),
      });
      agentIds.push(profile.id);

      const recipe = await apiJson<{ id: string }>('/agent-cookbook', {
        method: 'POST',
        body: JSON.stringify({
          title: `R4 deadline probe ${suffix}`,
          steps: ['Follow the bound profile instructions exactly.'],
          boundConfigId: profileId,
        }),
      });
      recipeIds.push(recipe.id);

      const startedAt = Date.now();
      const runResult = await apiJson<{ sessionId: string; status: string }>(
        `/agent-cookbook/${recipe.id}/run`,
        { method: 'POST' },
      );
      const elapsedMs = Date.now() - startedAt;
      sessionIds.push(runResult.sessionId);

      expect(elapsedMs).toBeGreaterThan(OLD_WALL_MS);
      expect(runResult.status).toBe('done');
      const snapshot = await apiJson<{
        session: { status: string; statusMessage?: string | null };
        messages: Array<{ parts?: Array<{ type?: string; text?: string }> }>;
      }>(`/agent-sessions/${runResult.sessionId}`);
      expect(snapshot.session.status).toBe('idle');
      expect(snapshot.session.statusMessage ?? '').not.toMatch(/timed out/i);
      expect(JSON.stringify(snapshot.messages)).toContain('DONE');
    },
    120_000,
  );
});
