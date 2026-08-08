/**
 * Live E2E for #1123 — interactive async delegation completion→parent wake.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 because it drives real Gemini turns against
 * an explicitly isolated branch-built API + fork engine.
 *
 * Recon was performed first against ports 4198/4197 on 2026-07-24. It observed:
 *   - POST /agent-delegation/delegate-async → 202 in 43ms
 *   - the user's concurrent turn → message.part.delta USER_STEER_ACCEPTED
 *   - the callback injected as a normal parent input message
 *   - the parent wake answer → message.part.delta PARENT_WAKE_RECON
 *
 * The completion wait below is WebSocket-only. It never polls the child.
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const describeLive = LIVE ? describe : describe.skip;

let createdAgentIds: string[] = [];
let createdSessionIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 50,
  label = 'poll',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms — last: ${String(lastError)}`);
}

function openWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function observableFrameText(frame: Record<string, unknown>): string {
  const part = frame.part as { text?: unknown } | undefined;
  const data = frame.data as { text?: unknown } | string | undefined;
  if (typeof frame.delta === 'string') return frame.delta;
  if (typeof part?.text === 'string') return part.text;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && typeof data.text === 'string') return data.text;
  if (typeof frame.text === 'string') return frame.text;
  return '';
}

afterEach(async () => {
  for (const id of createdSessionIds.reverse()) {
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const id of createdAgentIds.reverse()) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
  createdAgentIds = [];
  createdSessionIds = [];
});

describeLive('live E2E — #1123 async delegation', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE}`);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    if (engine.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${engine.status})`);
    }
    const auth = await apiJson<{ providers: string[] }>('/opencode/auth');
    if (!auth.providers?.includes('google')) {
      throw new Error("PRECONDITION: the isolated engine's Google provider is not authenticated");
    }
  });

  it('issue-001-c8: HTTP delegation rejects invalid overrides and persists default and selected child models', async () => {
    // Regression caught: invalid model input silently falls back, or a valid
    // override is accepted but the engine child still runs the profile default.
    const catalog = await apiJson<Array<{
      provider: string;
      modelId: string;
      authorized: boolean;
    }>>('/agents/models/catalog');
    // The catalog's `authorized` flag alone is not a usability signal: #1143's
    // custom-provider merge hardcodes `authorized: true` for any provider the
    // engine advertises but Rhythm never authenticated, so the engine's own
    // `opencode` (Zen) rows read authorized and 401 on the first real turn.
    // Intersect with the engine's real auth list — the same source beforeAll
    // already gates on — before spending a live turn on a model.
    const auth = await apiJson<{ providers: string[] }>('/opencode/auth');
    const authedProviders = new Set(auth.providers ?? []);
    const runnable = new Set(
      catalog
        .filter((entry) => entry.authorized && authedProviders.has(entry.provider))
        .map((entry) => `${entry.provider}/${entry.modelId}`),
    );
    // Pinned rather than "first two runnable rows": an unpinned pick can land on
    // a preview//robotics model the account cannot serve, which fails this test
    // for a reason that has nothing to do with model-override selection. This
    // pair is the one the sibling #1123 live test already drives end to end.
    const pair = [
      { provider: 'google', modelId: 'gemini-2.5-pro' },
      { provider: 'google', modelId: 'gemini-2.5-flash' },
    ];
    const missing = pair.filter((m) => !runnable.has(`${m.provider}/${m.modelId}`));
    if (missing.length > 0) {
      throw new Error(
        `PRECONDITION: need two authenticated models for selected-model evidence; ` +
        `missing ${JSON.stringify(missing)} from runnable set ` +
        `${JSON.stringify([...runnable])}`,
      );
    }
    const [defaultModel, overrideModel] = pair;
    const suffix = randomUUID().slice(0, 8);
    const managerId = `live-001-manager-${suffix}`;
    const specialistId = `live-001-specialist-${suffix}`;
    for (const input of [
      {
        id: managerId,
        label: `Live #001 manager ${suffix}`,
        isAgent: true,
        isManager: true,
        enabled: true,
        sessionSelectable: true,
        modelProvider: defaultModel.provider,
        modelId: defaultModel.modelId,
        ocAgent: managerId,
        allowedDelegatesJson: JSON.stringify([specialistId]),
        corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }),
      },
      {
        id: specialistId,
        label: `Live #001 specialist ${suffix}`,
        isAgent: true,
        enabled: true,
        sessionSelectable: true,
        modelProvider: defaultModel.provider,
        modelId: defaultModel.modelId,
        ocAgent: specialistId,
        systemPrompt: 'Reply with exactly MODEL_OVERRIDE_LIVE_OK.',
      },
    ]) {
      const created = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      createdAgentIds.push(created.id);
    }
    await apiJson('/system/refresh', { method: 'POST' });
    const parent = await apiJson<{ id: string }>('/agent-sessions', {
      method: 'POST',
      body: JSON.stringify({
        agentId: managerId,
        name: `Live #001 ${suffix}`,
        cwd: process.env.RHYTHM_LIVE_SESSION_CWD ?? homedir(),
      }),
    });
    createdSessionIds.push(parent.id);

    const invalid = await api('/agent-delegation/delegate-async', {
      method: 'POST',
      body: JSON.stringify({
        callerSessionId: parent.id,
        targetAgentConfigId: specialistId,
        prompt: 'This must not create a child.',
        model: { providerID: 'not-a-provider', modelID: 'not-a-model' },
      }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { message: expect.stringMatching(/unknown or unauthorized/i) },
    });
    expect(await apiJson<Array<unknown>>(`/agent-sessions/${parent.id}/children`)).toEqual([]);

    for (const model of [undefined, overrideModel]) {
      const response = await api('/agent-delegation/delegate-async', {
        method: 'POST',
        body: JSON.stringify({
          callerSessionId: parent.id,
          targetAgentConfigId: specialistId,
          prompt: 'Reply with the exact system-prompt marker.',
          ...(model ? { model: { providerID: model.provider, modelID: model.modelId } } : {}),
        }),
      });
      expect(response.status).toBe(202);
      const dispatch = await response.json() as { sessionId: string };
      createdSessionIds.push(dispatch.sessionId);
      const expected = model ?? defaultModel;
      await poll(
        async () => {
          const snapshot = await apiJson<{
            session: { status: string; providerId: string | null; modelId: string | null };
          }>(`/agent-sessions/${dispatch.sessionId}`);
          if (
            snapshot.session.status !== 'idle' ||
            snapshot.session.providerId !== expected.provider ||
            snapshot.session.modelId !== expected.modelId
          ) {
            throw new Error(`observed ${JSON.stringify(snapshot.session)}`);
          }
          return snapshot;
        },
        180_000,
        100,
        `child selected ${expected.provider}/${expected.modelId}`,
      );
    }
  }, 360_000);

  it('issue-1175-c8: locked async callers and targets are rejected before any child session is created', async () => {
    const suffix = randomUUID().slice(0, 8);
    const lockedCallerId = `live-1175-locked-caller-${suffix}`;
    const callerTargetId = `live-1175-caller-target-${suffix}`;
    const targetManagerId = `live-1175-target-manager-${suffix}`;
    const lockedTargetId = `live-1175-locked-target-${suffix}`;

    for (const input of [
      {
        id: lockedCallerId,
        label: `Live #1175 locked caller ${suffix}`,
        isAgent: true,
        isManager: true,
        enabled: true,
        sessionSelectable: true,
        allowedDelegatesJson: JSON.stringify([callerTargetId]),
        corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }),
      },
      {
        id: callerTargetId,
        label: `Live #1175 caller target ${suffix}`,
        isAgent: true,
        enabled: true,
        sessionSelectable: true,
      },
      {
        id: targetManagerId,
        label: `Live #1175 target manager ${suffix}`,
        isAgent: true,
        isManager: true,
        enabled: true,
        sessionSelectable: true,
        allowedDelegatesJson: JSON.stringify([lockedTargetId]),
        corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }),
      },
      {
        id: lockedTargetId,
        label: `Live #1175 locked target ${suffix}`,
        isAgent: true,
        enabled: true,
        sessionSelectable: true,
      },
    ]) {
      const created = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      createdAgentIds.push(created.id);
    }

    const callerParent = await apiJson<{ id: string }>('/agent-sessions', {
      method: 'POST',
      body: JSON.stringify({
        agentId: lockedCallerId,
        name: `Live #1175 locked caller ${suffix}`,
        cwd: process.env.RHYTHM_LIVE_SESSION_CWD ?? homedir(),
      }),
    });
    const targetParent = await apiJson<{ id: string }>('/agent-sessions', {
      method: 'POST',
      body: JSON.stringify({
        agentId: targetManagerId,
        name: `Live #1175 locked target ${suffix}`,
        cwd: process.env.RHYTHM_LIVE_SESSION_CWD ?? homedir(),
      }),
    });
    createdSessionIds.push(callerParent.id, targetParent.id);

    for (const id of [lockedCallerId, lockedTargetId]) {
      const lock = await api(`/agent-configs/${id}/security-lock`, {
        method: 'POST',
        body: JSON.stringify({
          reason: `Issue #1175 live lock ${suffix}`,
          actor: 'issue-1175-live-e2e',
        }),
      });
      expect(lock.status).toBe(200);
    }

    const cases = [
      {
        callerSessionId: callerParent.id,
        callerAgentConfigId: lockedCallerId,
        targetAgentConfigId: callerTargetId,
        expectedStatus: 403,
      },
      {
        callerSessionId: targetParent.id,
        callerAgentConfigId: targetManagerId,
        targetAgentConfigId: lockedTargetId,
        expectedStatus: 400,
      },
    ];
    for (const testCase of cases) {
      const before = await apiJson<Array<{ id: string }>>(
        `/agent-sessions/${testCase.callerSessionId}/children`,
      );
      const response = await api('/agent-delegation/delegate-async', {
        method: 'POST',
        body: JSON.stringify({
          callerAgentConfigId: testCase.callerAgentConfigId,
          callerSessionId: testCase.callerSessionId,
          targetAgentConfigId: testCase.targetAgentConfigId,
          prompt: 'This must never create or prompt a child.',
        }),
      });
      const responseText = await response.text();
      expect(response.status).toBe(testCase.expectedStatus);
      expect(responseText).toContain('security-locked');
      const after = await apiJson<Array<{ id: string }>>(
        `/agent-sessions/${testCase.callerSessionId}/children`,
      );
      expect(after).toEqual(before);
    }
  });

  it(
    'issue-1123-c6: a real child completes and wakes its concurrently steered parent exactly once without child polling',
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const childId = `live-1123-child-${suffix}`;
      const managerId = `live-1123-manager-${suffix}`;

      for (const input of [
        {
          id: childId,
          label: `Live #1123 child ${suffix}`,
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          modelProvider: 'google',
          modelId: 'gemini-2.5-pro',
          ocAgent: childId,
          systemPrompt: 'Return exactly CHILD_RECON_DONE and nothing else. Do not use tools.',
        },
        {
          id: managerId,
          label: `Live #1123 manager ${suffix}`,
          isAgent: true,
          isManager: true,
          enabled: true,
          sessionSelectable: true,
          modelProvider: 'google',
          modelId: 'gemini-2.5-pro',
          ocAgent: managerId,
          allowedDelegatesJson: JSON.stringify([childId]),
          corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }),
          systemPrompt:
            'You are a deterministic test manager. For an ordinary user message beginning ' +
            'USER_STEER_RECON, reply exactly USER_STEER_ACCEPTED. For a message beginning ' +
            '[Async delegation update], reply exactly PARENT_WAKE_RECON followed by the ' +
            'delegated result. Do not call tools.',
        },
      ]) {
        const created = await apiJson<{ id: string }>('/agent-configs', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        createdAgentIds.push(created.id);
      }
      await apiJson('/system/refresh', { method: 'POST' });

      const parent = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId: managerId,
          name: `Live #1123 ${suffix}`,
          cwd: process.env.RHYTHM_LIVE_SESSION_CWD ?? homedir(),
        }),
      });
      createdSessionIds.push(parent.id);

      const ws = await openWs();
      const frames: Array<Record<string, unknown>> = [];
      let observableText = '';
      let resolveDone!: () => void;
      let rejectDone!: (error: Error) => void;
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });
      const timeout = setTimeout(() => {
        rejectDone(
          new Error(
            `parent wake did not complete; observable=${observableText}; ` +
              `types=${frames.map((frame) => frame.type).join(',')}`,
          ),
        );
      }, 180_000);

      ws.on('message', (raw) => {
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch {
          return;
        }
        if (frame.id !== parent.id) return;
        frames.push(frame);
        observableText += observableFrameText(frame);
        // The durable behavior under test is the parent wake answer itself.
        // `session.status` is transport/version-specific and can be omitted
        // after the final delta even though the answer and callback persisted.
        if (observableText.includes('PARENT_WAKE_RECON')) {
          resolveDone();
        }
      });

      try {
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'session.input',
            id: parent.id,
            data: 'USER_STEER_RECON: acknowledge this direction now.',
          }),
        );
        await poll(
          async () => {
            const snapshot = await apiJson<{ session: { status: string } }>(
              `/agent-sessions/${parent.id}`,
            );
            if (snapshot.session.status !== 'working') {
              throw new Error(`parent status=${snapshot.session.status}`);
            }
            return snapshot;
          },
          20_000,
          25,
          'parent working before async dispatch',
        );

        const dispatchedAt = Date.now();
        const dispatchResponse = await api('/agent-delegation/delegate-async', {
          method: 'POST',
          body: JSON.stringify({
            callerAgentConfigId: managerId,
            callerSessionId: parent.id,
            targetAgentConfigId: childId,
            prompt: 'Return the exact marker requested by your system prompt.',
          }),
        });
        const dispatchMs = Date.now() - dispatchedAt;
        const dispatchText = await dispatchResponse.text();
        expect(dispatchResponse.status).toBe(202);
        const dispatch = JSON.parse(dispatchText) as {
          sessionId: string;
          sdkSessionId: string;
          status: string;
          targetAgentConfigId: string;
        };
        createdSessionIds.push(dispatch.sessionId);
        expect(dispatch).toMatchObject({
          status: 'dispatched',
          targetAgentConfigId: childId,
        });
        expect(dispatchMs, 'async dispatch blocked on child completion').toBeLessThan(5_000);
        expect(observableText).not.toContain('PARENT_WAKE_RECON');

        await done;
        expect(observableText).toContain('USER_STEER_ACCEPTED');
        expect(observableText.indexOf('USER_STEER_ACCEPTED')).toBeLessThan(
          observableText.indexOf('PARENT_WAKE_RECON'),
        );
        expect(observableText).toContain('CHILD_RECON_DONE');

        const snapshot = await apiJson<{
          session: { sdkSessionId: string };
          messages: Array<{ role: string; rawText: string }>;
        }>(`/agent-sessions/${parent.id}`);
        const callbackInputs = snapshot.messages.filter(
          (message) =>
            message.role === 'input' &&
            message.rawText.includes('[Async delegation update]') &&
            message.rawText.includes(dispatch.sessionId) &&
            message.rawText.includes('CHILD_RECON_DONE'),
        );
        expect(callbackInputs, 'completion callback was lost or duplicated').toHaveLength(1);
        const wakeOutputs = snapshot.messages.filter(
          (message) =>
            message.role === 'output' && message.rawText.includes('PARENT_WAKE_RECON'),
        );
        expect(wakeOutputs).toHaveLength(1);

        const children = await apiJson<Array<{ id: string; parentID: string }>>(
          `/agent-sessions/${parent.id}/children`,
        );
        expect(children).toContainEqual(
          expect.objectContaining({
            id: dispatch.sdkSessionId,
            parentID: snapshot.session.sdkSessionId,
          }),
        );
      } finally {
        clearTimeout(timeout);
        ws.close();
      }
    },
    240_000,
  );
});
