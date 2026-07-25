/**
 * Live behavioral contract for #1161.
 *
 * Drives the real sandbox api_server + opencode engine. It is intentionally
 * skipped unless RHYTHM_LIVE_E2E=1 and refuses non-isolated state.
 *
 * Run only after the dev-sandbox ports are free:
 *   tools/dev/sandbox.sh up
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   DB_PATH=<sandbox-dir>/rhythm.db \
 *   npx vitest run src/__tests__/live_e2e_1161_cookbook_bound_profile.test.ts
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const describeLive = LIVE ? describe : describe.skip;
const MODEL = {
  provider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'openrouter',
  id: process.env.RHYTHM_LIVE_MODEL_ID || 'anthropic/claude-haiku-4.5',
};
const PROFILE_MARKER = 'RHYTHM_COOKBOOK_BOUND_1161';

let createdAgentIds: string[] = [];
let createdRecipeIds: string[] = [];
let createdSessionIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

function assistantText(messages: unknown[]): string {
  return messages
    .map((entry) => {
      const message = entry as Record<string, unknown>;
      const info = (message.info ?? message) as Record<string, unknown>;
      if (info.role !== 'output' && info.role !== 'assistant') return '';
      const parts = (message.parts ?? []) as Array<Record<string, unknown>>;
      return parts
        .filter((part) => part.type === 'text')
        .map((part) => String(part.text ?? part.content ?? ''))
        .join('');
    })
    .join('')
    .trim();
}

afterEach(async () => {
  for (const id of createdSessionIds) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of createdRecipeIds) {
    await api(`/agent-cookbook/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of createdAgentIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  createdSessionIds = [];
  createdRecipeIds = [];
  createdAgentIds = [];
});

describeLive('live E2E — #1161 cookbook bound profile', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE}`);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    if (engine.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${engine.status})`);
    }
  });

  it(
    'issue-1161-c4: bound and unbound cookbook runs use their observable live profile identities',
    async () => {
      const suffix = Date.now();
      const profileId = `e2e-cookbook-bound-${suffix}`;
      const recipeTitle = `E2E bound cookbook ${suffix}`;
      const profile = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: profileId,
          label: `E2E Cookbook Specialist ${suffix}`,
          icon: 'book',
          enabled: true,
          isAgent: true,
          sessionSelectable: true,
          modelProvider: MODEL.provider,
          modelId: MODEL.id,
          ocAgent: profileId,
          allowedMcpsJson: '[]',
          allowedSkillsJson: '[]',
          corePermissionsJson: JSON.stringify({ read: 'deny', bash: 'deny' }),
          systemPrompt:
            `For cookbook binding proof, respond with exactly ${PROFILE_MARKER} and nothing else.`,
        }),
      });
      createdAgentIds.push(profile.id);

      const registry = await apiJson<{
        agents: Array<{
          name: string;
          model?: { providerID: string; modelID: string };
          options?: Record<string, unknown>;
          permission?: unknown;
        }>;
      }>('/agent-sessions/agents');
      const registered = registry.agents.find((agent) => agent.name === profileId);
      expect(registered, 'bound profile must be loaded by the real engine registry').toBeDefined();
      expect(registered?.model).toEqual({
        providerID: MODEL.provider,
        modelID: MODEL.id,
      });
      expect(registered?.options).toMatchObject({
        mcpAllowlist: { servers: [], tools: [] },
        skillAllowlist: [],
      });
      expect(registered?.permission).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ permission: 'read', action: 'deny' }),
          expect.objectContaining({ permission: 'bash', action: 'deny' }),
        ]),
      );

      const boundRecipe = await apiJson<{ id: string }>('/agent-cookbook', {
        method: 'POST',
        body: JSON.stringify({
          title: recipeTitle,
          steps: [`Reply with exactly ${PROFILE_MARKER}.`],
          boundConfigId: profileId,
        }),
      });
      createdRecipeIds.push(boundRecipe.id);

      const boundRun = await apiJson<{ sessionId: string; status: string }>(
        `/agent-cookbook/${boundRecipe.id}/run`,
        { method: 'POST' },
      );
      createdSessionIds.push(boundRun.sessionId);
      expect(boundRun.status).toBe('done');

      const boundSession = await apiJson<{
        session: {
          agentKind: string;
          name: string;
        };
        messages: unknown[];
      }>(`/agent-sessions/${boundRun.sessionId}`);
      expect(boundSession.session.agentKind).toBe(profileId);
      expect(boundSession.session.name).toBe(recipeTitle);
      expect(assistantText(boundSession.messages)).toContain(PROFILE_MARKER);

      const unboundRecipe = await apiJson<{ id: string }>('/agent-cookbook', {
        method: 'POST',
        body: JSON.stringify({
          title: `E2E unbound cookbook ${suffix}`,
          steps: ['Reply with one short sentence.'],
        }),
      });
      createdRecipeIds.push(unboundRecipe.id);

      const unboundRun = await apiJson<{ sessionId: string; status: string }>(
        `/agent-cookbook/${unboundRecipe.id}/run`,
        { method: 'POST' },
      );
      createdSessionIds.push(unboundRun.sessionId);
      expect(unboundRun.status).toBe('done');
      const unboundSession = await apiJson<{
        session: { agentKind: string };
      }>(`/agent-sessions/${unboundRun.sessionId}`);
      expect(unboundSession.session.agentKind).toBe('claude-code');
    },
    180_000,
  );
});
