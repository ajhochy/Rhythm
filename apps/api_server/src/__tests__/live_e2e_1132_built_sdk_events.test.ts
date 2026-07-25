/**
 * Live behavioral gate for #1132.
 *
 * The change is "only types", but these five generated event variants are
 * load-bearing. This test drives the running api_server and its built fork,
 * then observes the same WS cards/deltas and HTTP resolutions the desktop
 * consumes. It is intentionally gated and refuses the normal app ports.
 *
 * Coordinator-owned launch:
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:<sandbox-port> DB_PATH=<temp-db> \
 *   npx vitest run src/__tests__/live_e2e_1132_built_sdk_events.test.ts
 */
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4001';
const MODEL = {
  provider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'openrouter',
  id: process.env.RHYTHM_LIVE_MODEL_ID || 'anthropic/claude-haiku-4.5',
};

const createdAgentIds: string[] = [];
const createdSessionIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${body}`);
  return body ? (JSON.parse(body) as T) : (undefined as T);
}

async function poll<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new Error(`${label} timed out: ${String(last)}`);
}

async function openWs(): Promise<WebSocket> {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

async function createSession(agentId: string, suffix: string): Promise<string> {
  const session = await apiJson<{ id: string }>('/agent-sessions', {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      name: `#1132 built event smoke ${suffix}`,
      cwd: process.env.RHYTHM_LIVE_SESSION_CWD ?? homedir(),
    }),
  });
  createdSessionIds.push(session.id);
  return session.id;
}

async function waitIdle(sessionId: string): Promise<void> {
  await poll(
    async () => {
      const result = await apiJson<{ session: { status: string } }>(
        `/agent-sessions/${sessionId}`,
      );
      if (result.session.status === 'starting' || result.session.status === 'working') {
        throw new Error(`session still ${result.session.status}`);
      }
    },
    120_000,
    `session ${sessionId} idle`,
  );
}

afterEach(async () => {
  for (const id of createdSessionIds.splice(0)) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const id of createdAgentIds.splice(0)) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
});

describeLive('live E2E — #1132 built SDK event surface', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (BASE.includes(':4001') || BASE.includes(':4096')) {
      throw new Error('refusing normal app/engine ports; point RHYTHM_LIVE_URL at the sandbox');
    }
    expect((await api('/health')).ok).toBe(true);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    expect(engine.status).toBe('ready');
  });

  it(
    'built fork preserves permission, question reply/reject, and streamed message behavior',
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const created = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: `live-1132-${suffix}`,
          label: `#1132 SDK events ${suffix}`,
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          modelProvider: MODEL.provider,
          modelId: MODEL.id || undefined,
          corePermissionsJson: JSON.stringify({ question: 'allow', bash: 'ask' }),
          systemPrompt:
            'You are a deterministic integration-test agent. Obey exactly one protocol per turn. ' +
            'For ASK_REPLY or ASK_REJECT, call the question tool exactly once with header "Protocol", ' +
            'question "Choose a color", options Blue and Green, then after the tool resolves write ' +
            'QUESTION_DONE. For RUN_PERMISSION, call bash exactly once with command pwd, then whether ' +
            'it succeeds or is rejected write PERMISSION_DONE. Do not substitute prose for a required tool call.',
        }),
      });
      createdAgentIds.push(created.id);
      await apiJson('/system/refresh', { method: 'POST' });

      const ws = await openWs();
      const frames: Array<Record<string, unknown>> = [];
      ws.on('message', (raw) => {
        try {
          frames.push(JSON.parse(String(raw)) as Record<string, unknown>);
        } catch {
          // Ignore non-JSON transport noise.
        }
      });

      try {
        // Reply path: question.asked -> HTTP reply -> question.resolved and
        // actual streamed assistant text.
        const replySession = await createSession(created.id, 'reply');
        ws.send(JSON.stringify({ v: 1, type: 'session.input', id: replySession, data: 'ASK_REPLY' }));
        const asked = await poll(
          async () => {
            const frame = frames.find(
              (item) => item.type === 'question.asked' && item.sessionId === replySession,
            );
            if (!frame?.callId) throw new Error('question.asked with callId not observed');
            return frame;
          },
          90_000,
          'question reply ask',
        );
        const reply = await api(
          `/agent-sessions/${replySession}/question/${encodeURIComponent(String(asked.callId))}/reply`,
          { method: 'POST', body: JSON.stringify({ answers: [['Blue']] }) },
        );
        expect(reply.status).toBe(204);
        await poll(
          async () => {
            const frame = frames.find(
              (item) =>
                item.type === 'question.resolved' &&
                item.sessionId === replySession &&
                item.rejected === false,
            );
            if (!frame) throw new Error('question reply resolution not observed');
          },
          20_000,
          'question reply resolution',
        );
        await waitIdle(replySession);
        expect(
          frames.some(
            (item) =>
              item.type === 'message.part.delta' &&
              typeof item.delta === 'string' &&
              item.delta.length > 0,
          ),
          'no observable streamed message delta after question reply',
        ).toBe(true);

        // Reject path: a second real question is rejected through the same
        // desktop-facing route and visibly resolves as rejected.
        const rejectSession = await createSession(created.id, 'reject');
        ws.send(JSON.stringify({ v: 1, type: 'session.input', id: rejectSession, data: 'ASK_REJECT' }));
        const rejectedAsk = await poll(
          async () => {
            const frame = frames.find(
              (item) => item.type === 'question.asked' && item.sessionId === rejectSession,
            );
            if (!frame?.callId) throw new Error('second question.asked with callId not observed');
            return frame;
          },
          90_000,
          'question reject ask',
        );
        const reject = await api(
          `/agent-sessions/${rejectSession}/question/${encodeURIComponent(String(rejectedAsk.callId))}/reject`,
          { method: 'POST' },
        );
        expect(reject.status).toBe(204);
        await poll(
          async () => {
            const frame = frames.find(
              (item) =>
                item.type === 'question.resolved' &&
                item.sessionId === rejectSession &&
                item.rejected === true,
            );
            if (!frame) throw new Error('question reject resolution not observed');
          },
          20_000,
          'question reject resolution',
        );

        // Permission path: real bash execution blocks on permission.asked;
        // reject it through the API and observe the UI-facing resolution.
        const permissionSession = await createSession(created.id, 'permission');
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'session.input',
            id: permissionSession,
            data: 'RUN_PERMISSION',
          }),
        );
        const permission = await poll(
          async () => {
            const frame = frames.find(
              (item) =>
                item.type === 'permission.asked' &&
                item.sessionId === permissionSession &&
                typeof item.permissionId === 'string',
            );
            if (!frame) throw new Error('permission.asked not observed');
            return frame;
          },
          90_000,
          'permission ask',
        );
        const denied = await api(
          `/agent-sessions/${permissionSession}/permission/${encodeURIComponent(
            String(permission.permissionId),
          )}/deny`,
          { method: 'POST', body: JSON.stringify({ message: 'SDK event smoke rejection' }) },
        );
        expect(denied.status).toBe(204);
        await poll(
          async () => {
            const frame = frames.find(
              (item) =>
                item.type === 'permission.resolved' &&
                item.permissionId === permission.permissionId &&
                item.decision === 'deny',
            );
            if (!frame) throw new Error('permission denial resolution not observed');
          },
          20_000,
          'permission resolution',
        );
        await waitIdle(permissionSession);
      } finally {
        ws.close();
      }
    },
    300_000,
  );
});
