/**
 * Live E2E test for #1156 — delegated subagent permission gate.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Drives a REAL parent→child `task`-tool delegation against the
 * sandboxed api_server + fork engine (never the live app on :4001 — see the
 * `describeLive` guard below and AGENTS.md "Rhythm Repository Development
 * Workflow"). Patterned on `live_e2e_inert_regressions.test.ts` (manager +
 * task-tool delegation) and `live_e2e_1073_permission_roundtrip.test.ts` (WS
 * permission-frame capture).
 *
 * Acceptance criterion (docs/ai/current-plan.md, issue #1156):
 *   A headless parent→child delegation (no Flutter UI attached) completes a
 *   glob/grep tool call on the CHILD session to completion, with NO
 *   `permission.asked` frame ever forwarded/left pending for that child. Before
 *   the fix, the child's first non-allowlisted tool call (glob/grep) hung
 *   forever because the gate forwarded the ask to a UI that doesn't exist for
 *   a headless delegated session.
 *
 * Run:
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *     npx vitest run src/__tests__/issue_1156_live_e2e.test.ts
 *
 * Record the exact command + observed output in
 * docs/ai/runs/2026-07-24-1156-delegated-permission-gate.md per AGENTS.md's
 * behavioral verification gate.
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { WebSocket } from 'ws';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const describeLive = LIVE ? describe : describe.skip;

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
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 800,
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
  throw new Error(`${label} timed out after ${timeoutMs}ms; last=${String(lastError)}`);
}

async function openWs(): Promise<WebSocket> {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
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

describeLive('live E2E — #1156 delegated subagent permission gate', () => {
  beforeAll(async () => {
    if (BASE.includes(':4001') || BASE.includes(':4096')) {
      throw new Error(
        'refusing to run #1156 live E2E against the live app ports (4001/4096) — use the sandbox (:4098) per AGENTS.md',
      );
    }
    const health = await api('/health');
    if (!health.ok) throw new Error(`sandbox server is not reachable at ${BASE}`);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    if (engine.status !== 'ready') throw new Error(`fork engine is not ready: ${engine.status}`);
  });

  it(
    'headless parent->child delegation completes a glob tool call with no forwarded permission ask',
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const childId = `live-1156-child-${suffix}`;
      const managerId = `live-1156-manager-${suffix}`;

      for (const input of [
        {
          id: childId,
          label: `1156 child ${suffix}`,
          isAgent: true,
          modelProvider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'google',
          modelId: process.env.RHYTHM_LIVE_MODEL_ID || 'gemini-2.5-pro',
          systemPrompt:
            'On every task, first call your glob tool with pattern "*.md" in the current directory, ' +
            'then report GLOB_DONE followed by the number of matches. Never skip the glob call.',
        },
        {
          id: managerId,
          label: `1156 manager ${suffix}`,
          isAgent: true,
          isManager: true,
          ocAgent: managerId,
          allowedDelegatesJson: JSON.stringify([childId]),
          modelProvider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'google',
          modelId: process.env.RHYTHM_LIVE_MODEL_ID || 'gemini-2.5-pro',
          systemPrompt:
            `When asked to delegate, call the task tool exactly once with subagent_type=${childId}. ` +
            'Never answer directly, never call glob/grep yourself.',
        },
      ]) {
        const created = await apiJson<{ id: string }>('/agent-configs', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        createdAgentIds.push(created.id);
      }

      const session = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId: managerId,
          name: `1156 headless delegation probe ${suffix}`,
          cwd: process.env.RHYTHM_LIVE_SESSION_CWD ?? homedir(),
        }),
      });
      createdSessionIds.push(session.id);

      const ws = await openWs();
      const framesBySession = new Map<string, Array<Record<string, unknown>>>();
      ws.on('message', (raw) => {
        try {
          const frame = JSON.parse(String(raw)) as Record<string, unknown>;
          const sid = String(frame.sessionId ?? '');
          if (!sid) return;
          const bucket = framesBySession.get(sid) ?? [];
          bucket.push(frame);
          framesBySession.set(sid, bucket);
        } catch {
          /* ignore non-JSON frames */
        }
      });

      try {
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'session.input',
            id: session.id,
            data: `Delegate to ${childId} using your task tool. Ask it to run its glob and report GLOB_DONE.`,
          }),
        );

        // Wait for the manager's turn to finish (task tool call resolves
        // synchronously from the manager's perspective once the child
        // completes).
        await poll(
          async () => {
            const s = await apiJson<{ session: { status: string } }>(
              `/agent-sessions/${session.id}`,
            );
            if (s.session.status === 'starting' || s.session.status === 'working') {
              throw new Error(`manager session still ${s.session.status}`);
            }
            return s;
          },
          180_000,
          800,
          'await manager turn idle',
        );

        // Resolve the delegated child session id.
        const children = await poll(
          async () => {
            const kids = await apiJson<Array<{ id: string }>>(
              `/agent-sessions/${session.id}/children`,
            );
            if (kids.length === 0) throw new Error('no child session yet');
            return kids;
          },
          30_000,
          500,
          'await delegated child session',
        );
        const childSessionId = children[0].id;

        // PASS criterion 1: the child session did not end in 'error' (the
        // hang manifested as the child stalling / erroring on the first
        // non-allowlisted tool call).
        const childState = await apiJson<{ session: { status: string } }>(
          `/agent-sessions/${childSessionId}`,
        );
        expect(childState.session.status).not.toBe('error');

        // PASS criterion 2: the child's glob tool call reached 'completed' —
        // proof the permission gate did not block it.
        const { messages: childMessages } = await apiJson<{ messages: Array<Record<string, unknown>> }>(
          `/agent-sessions/${childSessionId}/messages?limit=500`,
        );
        const globCalls = childMessages.flatMap((m) => {
          const parts = (m.parts ?? []) as Array<Record<string, unknown>>;
          return parts.filter((p) => p.type === 'tool' && String(p.tool ?? '') === 'glob');
        });
        const completedGlobCalls = globCalls.filter(
          (p) => (p.state as Record<string, unknown> | undefined)?.status === 'completed',
        );
        expect(
          completedGlobCalls.length,
          'expected the delegated child to complete a glob tool call — 0 completed means the permission gate blocked/hung it',
        ).toBeGreaterThan(0);

        // PASS criterion 3 (the issue's stated gate): NO permission.asked
        // frame was ever broadcast for the child session — the headless
        // auto-accept must have resolved it without forwarding to a UI.
        const childFrames = framesBySession.get(childSessionId) ?? [];
        const forwardedAsks = childFrames.filter((f) => f.type === 'permission.asked');
        expect(
          forwardedAsks.length,
          'a permission.asked frame was forwarded for the headless delegated child — the gate did not auto-accept it',
        ).toBe(0);
      } finally {
        ws.close();
      }
    },
    240_000,
  );
});
