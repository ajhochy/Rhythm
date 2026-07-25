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
      let wakeSeen = false;
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
        if (observableText.includes('PARENT_WAKE_RECON')) wakeSeen = true;
        if (wakeSeen && frame.type === 'session.status' && frame.working === false) {
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
