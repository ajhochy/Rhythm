/**
 * Live E2E tests for the Gemini lane: #952 (unscoped tool-cap) + #927 (projectId).
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite because it drives REAL Gemini turns (costs Google Code Assist quota,
 * ~1-3 min) against the running local agent server.
 *
 * Run it:
 *   RHYTHM_LIVE_E2E=1 npx vitest run __tests__/live_e2e_927_952_gemini.test.ts
 *   # optional: RHYTHM_LIVE_URL=http://localhost:4001 (default)
 *
 * PRECONDITIONS the orchestrator must satisfy before running:
 *   - api_server running on RHYTHM_LIVE_URL (default :4001, AGENT_LOCAL=true so
 *     no bearer token is needed).
 *   - The opencode engine spawned and ready (GET /opencode/health → ready),
 *     built from THIS branch's fork (the #952 fix relies on the fork's deferred
 *     MCP mode — #843 — which is already on main).
 *   - Google/Gemini OAuth is configured on the engine (the `google` provider
 *     must appear in GET /opencode/auth). Without it these tests can only prove
 *     an auth failure, not the projectId/tool-cap behavior, so beforeAll fails
 *     fast with a clear message.
 *   - At least one MCP server connected (so the unscoped surface is non-trivial
 *     and #952 actually exercises the cap). The `rhythm` server is always on.
 *
 * These tests DO NOT complete any OAuth flow and DO NOT call the Re-auth
 * endpoint (/opencode/auth/google/authorize) — that is the whole point of #927:
 * multiple consecutive turns must resolve the projectId with ZERO manual clicks.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { WebSocket } from 'ws';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const describeLive = LIVE ? describe : describe.skip;

// Failure signatures — the observable symptoms of each bug. If a turn ends with
// any of these in its status message or transcript, the fix regressed.
const TOOL_CAP_SIGNATURE =
  /512|function[_ ]declaration|GenerateContentRequest|too many tools|proto is invalid/i;
const PROJECT_ID_SIGNATURE =
  /project[_ ]?id|Google Cloud project|not (set )?in (the |your )?config|ProjectIdRequired/i;

let createdAgentIds: string[] = [];
let createdSessionIds: string[] = [];

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

async function poll<T>(fn: () => Promise<T>, timeoutMs: number, intervalMs = 800, label = 'poll'): Promise<T> {
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

/** Create an UNSCOPED Gemini agent config (modelProvider=google, no MCP scope). */
async function createUnscopedGeminiAgent(label: string): Promise<string> {
  const cfg = await apiJson<{ id: string }>('/agent-configs', {
    method: 'POST',
    body: JSON.stringify({
      label,
      isAgent: true,
      enabled: true,
      sessionSelectable: true,
      modelProvider: 'google',
      modelId: 'gemini-2.5-pro',
      // No allowedMcpsJson → UNSCOPED: the ws_gateway pushes a null scope, which
      // is exactly the path that used to inject the full tool surface (#952).
      systemPrompt: 'You are a terse assistant. Answer in one short sentence.',
    }),
  });
  createdAgentIds.push(cfg.id);
  return cfg.id;
}

async function createSession(agentId: string, name: string): Promise<string> {
  // POST /agent-sessions returns the session object directly (res.json(session)),
  // NOT wrapped in { session } — matches commit c00681c7b. (GET /agent-sessions/:id
  // below IS a { session, messages } snapshot; that's a different endpoint shape.)
  const r = await apiJson<{ id: string }>('/agent-sessions', {
    method: 'POST',
    body: JSON.stringify({ agentId, name, cwd: process.cwd() }),
  });
  createdSessionIds.push(r.id);
  return r.id;
}

function openWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

interface SessionSnapshot {
  session: { status: string; statusMessage?: string | null };
  messages: unknown[];
}

/** Send one prompt, wait for the turn to leave working/starting, return the snapshot. */
async function runTurn(ws: WebSocket, sessionId: string, text: string): Promise<SessionSnapshot> {
  ws.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: text }));
  return poll(
    async () => {
      const snap = await apiJson<SessionSnapshot>(`/agent-sessions/${sessionId}`);
      const st = snap.session.status;
      if (st === 'working' || st === 'starting') throw new Error(`still ${st}`);
      return snap;
    },
    180_000,
    1000,
    `turn idle for ${sessionId}`,
  );
}

/** Assert a turn produced a real answer and did NOT break with `signature`. */
function assertHealthyTurn(snap: SessionSnapshot, signature: RegExp, ctx: string): void {
  const blob = JSON.stringify(snap.messages) + ' ' + (snap.session.statusMessage ?? '');
  expect(snap.session.status, `${ctx}: session errored — ${snap.session.statusMessage ?? ''}`).not.toBe(
    'error',
  );
  expect(signature.test(blob), `${ctx}: transcript/status matched failure signature ${signature}`).toBe(
    false,
  );
  // A real turn appended at least one assistant response (proves the model
  // actually ran, not that it silently produced nothing). This codebase maps
  // the SDK 'assistant' role to 'output' at write time (see
  // agent_sessions_controller / agent_session_messages_repository), so check
  // for an 'output' message — NOT the literal substring 'assistant', which the
  // messages API never emits.
  const hasOutput = snap.messages.some(
    (m): boolean => !!m && typeof m === 'object' && (m as { role?: string }).role === 'output',
  );
  expect(hasOutput, `${ctx}: no output (assistant) message — turn did not complete`).toBe(true);
}

afterEach(async () => {
  for (const id of createdSessionIds) {
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => {});
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of createdAgentIds) await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
  createdSessionIds = [];
  createdAgentIds = [];
});

describeLive('live E2E — Gemini lane (#952 + #927)', () => {
  beforeAll(async () => {
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') throw new Error(`opencode engine not ready (status=${eng.status})`);
    const auth = await apiJson<{ providers: string[] }>('/opencode/auth');
    if (!auth.providers?.includes('google')) {
      throw new Error(
        "PRECONDITION: the 'google' provider is not authed on the engine. Complete Gemini " +
          'OAuth (Agents → Re-auth Gemini) before running this live gate.',
      );
    }
  });

  // #952 — an UNSCOPED Gemini agent turn must not break on tool count. Before the
  // fix the full MCP surface was injected and Gemini 400'd on >512 declarations.
  it(
    '#952: an unscoped Gemini turn does not break on the tool-declaration cap',
    async () => {
      const agentId = await createUnscopedGeminiAgent('E2E Gemini Unscoped 952');
      const sessionId = await createSession(agentId, 'gemini-952');
      const ws = await openWs();
      try {
        const snap = await runTurn(ws, sessionId, 'Say hello and stop.');
        assertHealthyTurn(snap, TOOL_CAP_SIGNATURE, '#952 unscoped Gemini turn');
      } finally {
        ws.close();
      }
    },
    240_000,
  );

  // #927 — recurring failure: projectId "not in config" after a few turns / on
  // session switch. Run SEVERAL consecutive turns across TWO sessions with NO
  // Re-auth click. Every turn must resolve the projectId cleanly.
  it(
    '#927: multiple consecutive Gemini turns across sessions resolve projectId without any re-auth',
    async () => {
      const agentId = await createUnscopedGeminiAgent('E2E Gemini Unscoped 927');
      const sessionA = await createSession(agentId, 'gemini-927-A');
      const sessionB = await createSession(agentId, 'gemini-927-B');
      const ws = await openWs();
      try {
        // Alternate sessions to exercise the "session switch" recurrence trigger.
        const plan: Array<[string, string]> = [
          [sessionA, 'Reply with the single word: one.'],
          [sessionB, 'Reply with the single word: two.'],
          [sessionA, 'Reply with the single word: three.'],
          [sessionB, 'Reply with the single word: four.'],
        ];
        for (const [sid, prompt] of plan) {
          const snap = await runTurn(ws, sid, prompt);
          assertHealthyTurn(snap, PROJECT_ID_SIGNATURE, `#927 turn on ${sid}`);
        }
      } finally {
        ws.close();
      }
    },
    600_000,
  );
});
