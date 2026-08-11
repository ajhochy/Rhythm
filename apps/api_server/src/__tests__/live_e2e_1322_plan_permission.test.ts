/**
 * Live behavioral contract for #1322.
 *
 * Build the fork and api_server, then run against the isolated sandbox:
 *   tools/dev/sandbox.sh up
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   npx vitest run src/__tests__/live_e2e_1322_plan_permission.test.ts
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const describeLive = LIVE ? describe : describe.skip;
const MARKER = 'RHYTHM_PLAN_1322_ECHO';

let createdAgentIds: string[] = [];
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
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function poll<T>(fn: () => Promise<T>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error(`poll timed out: ${String(lastError)}`);
}

async function runEchoTurn(sessionId: string): Promise<Array<Record<string, unknown>>> {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({
    v: 1,
    type: 'session.input',
    id: sessionId,
    data: `Use the bash tool exactly once to run: echo ${MARKER}. Do not simulate it.`,
  }));
  try {
    await poll(async () => {
      const current = await apiJson<{ session: { status: string } }>(
        `/agent-sessions/${sessionId}`,
      );
      if (current.session.status === 'working' || current.session.status === 'starting') {
        throw new Error(`session still ${current.session.status}`);
      }
      return current;
    });
  } finally {
    ws.close();
  }

  const result = await apiJson<{ messages: Array<Record<string, unknown>> }>(
    `/agent-sessions/${sessionId}/messages`,
  );
  return result.messages.flatMap((message) =>
    ((message.parts ?? []) as Array<Record<string, unknown>>).filter(
      (part) => part.type === 'tool' && part.tool === 'bash',
    ),
  );
}

afterEach(async () => {
  for (const id of createdSessionIds) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of createdAgentIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  createdSessionIds = [];
  createdAgentIds = [];
});

describeLive('live E2E — #1322 plan session permission policy', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE}`);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    if (engine.status !== 'ready') throw new Error(`engine status is ${engine.status}`);
  });

  it('issue-1322-c4: echo is denied in plan mode and completes in default mode', async () => {
    const agent = await apiJson<{ id: string }>('/agent-configs', {
      method: 'POST',
      body: JSON.stringify({
        label: 'Plan Permission Live Probe',
        isAgent: true,
        enabled: true,
        sessionSelectable: true,
        corePermissionsJson: JSON.stringify({ bash: 'allow' }),
        systemPrompt: 'Follow the user instruction and invoke bash exactly once.',
      }),
    });
    createdAgentIds.push(agent.id);
    await apiJson('/system/refresh', { method: 'POST' });

    const create = async (permissionMode: 'plan' | 'default') => {
      const session = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId: agent.id,
          cwd: '/tmp',
          name: `#1322 ${permissionMode}`,
          permissionMode,
        }),
      });
      createdSessionIds.push(session.id);
      return session.id;
    };

    const planTools = await runEchoTurn(await create('plan'));
    expect(planTools.length, 'plan turn never attempted bash').toBeGreaterThan(0);
    expect(
      planTools.some((part) => {
        const state = part.state as Record<string, unknown> | undefined;
        return state?.status === 'completed' && JSON.stringify(state).includes(MARKER);
      }),
      'echo completed despite the per-session plan policy',
    ).toBe(false);

    const defaultTools = await runEchoTurn(await create('default'));
    expect(
      defaultTools.some((part) => {
        const state = part.state as Record<string, unknown> | undefined;
        return state?.status === 'completed' && JSON.stringify(state).includes(MARKER);
      }),
      'default-mode echo did not complete normally',
    ).toBe(true);
  }, 180_000);
});
