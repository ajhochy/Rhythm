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
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const DB_PATH = process.env.RHYTHM_LIVE_DB_PATH ?? '';
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
    if (!DB_PATH.startsWith('/private/tmp/') && !DB_PATH.startsWith('/tmp/')) {
      throw new Error('RHYTHM_LIVE_DB_PATH must point at the isolated sandbox database');
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

        // Resolve the delegated child's LOCAL session id.
        //
        // NOTE (repair attempt 1 — see docs/ai/runs/2026-07-24-1156-*.md):
        // GET /:id/children returns raw opencode SDK `Session[]` objects
        // (opencode_client_service.listChildren → client.session.children) —
        // their `.id` is the SDK session id, NOT a local `agent_sessions` row
        // id. `GET /agent-sessions/:id` (getOne) looks a row up ONLY via
        // `repo.findById`, which is keyed on the LOCAL id — passing the SDK id
        // 404s (confirmed: agent_sessions_controller.ts getOne ~L371-374 vs
        // getChildren ~L1442-1467). That was a TEST bug, not a product gap:
        // the fix under test (`isHeadless`) operates on the LOCAL child row
        // that `upsertChildSession` creates (opencode_stream_bridge.ts
        // ~L1441-1461), which is exactly the row this discovery now finds.
        //
        // #1348 intentionally hides child rows from scope=chats. Discover the
        // local row from the isolated sandbox DB instead, then continue to
        // drive its normal API routes and WS frames by local session id.
        const childSession = await poll(
          async () => {
            const db = new Database(DB_PATH, { readonly: true });
            const child = db
              .prepare(
                `SELECT id, parent_session_id AS parentSessionId,
                        delegation_depth AS delegationDepth, status
                   FROM agent_sessions
                  WHERE parent_session_id = ?
                  ORDER BY created_at DESC
                  LIMIT 1`,
              )
              .get(session.id) as
              | {
                  id: string;
                  parentSessionId: string;
                  delegationDepth: number;
                  status: string;
                }
              | undefined;
            db.close();
            if (!child) throw new Error('no local child row yet (upsertChildSession race)');
            expect(child.parentSessionId).toBe(session.id);
            expect(child.delegationDepth).toBeGreaterThan(0);
            return child;
          },
          30_000,
          500,
          'await delegated child local row',
        );

        // PASS criterion 1: the child session did not end in 'error' (the
        // hang manifested as the child stalling / erroring on the first
        // non-allowlisted tool call).
        const childState = await apiJson<{ session: { status: string } }>(
          `/agent-sessions/${childSession.id}`,
        );
        expect(childState.session.status).not.toBe('error');

        // PASS criterion 2: the child's glob tool call reached 'completed' —
        // proof the permission gate did not block it. Poll (the child's own
        // turn may still be wrapping up even after the manager's task-tool
        // call returns).
        const completedGlobCalls = await poll(
          async () => {
            const { messages: childMessages } = await apiJson<{
              messages: Array<Record<string, unknown>>;
            }>(`/agent-sessions/${childSession.id}/messages?limit=500`);
            const globCalls = childMessages.flatMap((m) => {
              const parts = (m.parts ?? []) as Array<Record<string, unknown>>;
              return parts.filter((p) => p.type === 'tool' && String(p.tool ?? '') === 'glob');
            });
            const completed = globCalls.filter(
              (p) => (p.state as Record<string, unknown> | undefined)?.status === 'completed',
            );
            if (completed.length === 0) throw new Error('no completed glob tool call yet');
            return completed;
          },
          60_000,
          1000,
          'await child glob tool call completion',
        );
        expect(
          completedGlobCalls.length,
          'expected the delegated child to complete a glob tool call — 0 completed means the permission gate blocked/hung it',
        ).toBeGreaterThan(0);

        // PASS criterion 3 (the issue's stated gate): NO permission.asked
        // frame was ever broadcast for the child session — the headless
        // auto-accept must have resolved it without forwarding to a UI.
        const childFrames = framesBySession.get(childSession.id) ?? [];
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
