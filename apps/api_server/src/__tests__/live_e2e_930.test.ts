/**
 * Live E2E test for #930 — model fallback chain on rate-limit exhaustion.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite because it drives real LLM sessions against the running local agent
 * server on :4001 (same convention as live_e2e_948_949.test.ts).
 *
 * Run it:
 *   RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_930.test.ts
 *
 * Prerequisites:
 *   - Rhythm api_server running on localhost:4001 (AGENT_LOCAL=true so
 *     /opencode/spillover and /agent-configs need no bearer token).
 *   - opencode engine spawned and ready (GET /opencode/health → ready).
 *   - At least one NON-Anthropic provider authed (openai / google /
 *     openrouter) — the cross-provider handoff needs a tier to land on.
 *     Phase A runs its turns on OpenRouter's free model, so openrouter auth
 *     is the cheapest sufficient setup.
 *
 * Phase B (mid-run resume) is ADDITIONALLY gated behind
 * RHYTHM_LIVE_E2E_FORCE_EXHAUSTED=1, which asserts the OPERATOR started the
 * backend with the engine-level knob:
 *   RHYTHM_FORCE_EXHAUSTED=1  (read by the vendored rhythm-anthropic-accounts
 *   plugin: every Anthropic request returns a synthetic 429 + fires
 *   markAccountsExhausted — no real Anthropic tokens burned)
 * Without that knob a genuine mid-turn Anthropic exhaustion cannot be forced
 * deterministically, so Phase B self-skips. Phases A1-A3 exercise the route
 * intake, persistence, notification, and next-turn pickup without it.
 *
 * NOT covered live (documented gap): true at-most-once — forcing the RETRY
 * turn (on openai/google/openrouter) to fail is not deterministically
 * possible; that path is unit-covered in services/__tests__/
 * turn_redispatch.test.ts. Phase A3 asserts the adjacent live invariant:
 * an exhaustion report with no failing turn in flight never spuriously
 * re-dispatches.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { WebSocket } from 'ws';
import { homedir } from 'node:os';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const FORCE_EXHAUSTED = process.env.RHYTHM_LIVE_E2E_FORCE_EXHAUSTED === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';

const describeLive = LIVE ? describe : describe.skip;
const describeLiveForced = LIVE && FORCE_EXHAUSTED ? describe : describe.skip;

// The exact reason string broadcast by opencode_spillover_routes.ts.
const CROSS_PROVIDER_REASON = 'rate_limit_cross_provider';
// Providers a handoff may legitimately land on (any authed non-Anthropic
// tier of FALLBACK_CHAIN; 'glm' can never be authed).
const NON_ANTHROPIC_TIERS = ['openai', 'google', 'openrouter'];

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

interface SessionRow {
  id: string;
  status: string;
  statusMessage: string | null;
  sdkSessionId: string | null;
  providerId: string | null;
  modelId: string | null;
}

async function getSession(id: string): Promise<SessionRow> {
  const r = await apiJson<{ session: SessionRow }>(`/agent-sessions/${id}`);
  return r.session;
}

async function createTempAgent(label: string, provider: string, modelId: string): Promise<string> {
  const cfg = await apiJson<{ id: string }>('/agent-configs', {
    method: 'POST',
    body: JSON.stringify({
      label,
      isAgent: true,
      enabled: true,
      sessionSelectable: true,
      modelProvider: provider,
      modelId: modelId || undefined,
      systemPrompt: 'You are a terse test agent. Answer in one short sentence.',
    }),
  });
  createdAgentIds.push(cfg.id);
  return cfg.id;
}

async function createSession(agentId: string, name: string): Promise<string> {
  const sess = await apiJson<{ id: string }>('/agent-sessions', {
    method: 'POST',
    body: JSON.stringify({ agentId, name, cwd: homedir() }),
  });
  createdSessionIds.push(sess.id);
  return sess.id;
}

/** Poll a predicate with a timeout (ms). Throws the last error on timeout. */
async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 800,
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

/** WS connection that records every broadcast frame for later assertions. */
function openCapturingWs(): Promise<{ ws: WebSocket; frames: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const url = BASE.replace(/^http/, 'ws') + '/ws/agents';
    const ws = new WebSocket(url);
    const frames: Array<Record<string, unknown>> = [];
    ws.on('message', (raw) => {
      try {
        frames.push(JSON.parse(String(raw)) as Record<string, unknown>);
      } catch {
        /* non-JSON frame — ignore */
      }
    });
    ws.once('open', () => resolve({ ws, frames }));
    ws.once('error', reject);
  });
}

function sendTurn(ws: WebSocket, sessionId: string, text: string): void {
  ws.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: text }));
}

afterEach(async () => {
  for (const id of createdSessionIds) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of createdAgentIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  createdSessionIds = [];
  createdAgentIds = [];
});

describeLive('live E2E — #930 fallback chain (route-level, no engine forcing needed)', () => {
  beforeAll(async () => {
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${eng.status}) — wait for spawn and re-run`);
    }
  });

  it(
    'A1+A2+A3: exhaustion intake → authed cross-provider handoff persisted + broadcast; next turn routes to the new provider; an idle-time report never spuriously re-dispatches',
    async () => {
      // Phase A runs its turns on OpenRouter's free model so the test itself
      // costs nothing and works while RHYTHM_FORCE_EXHAUSTED 429s anthropic.
      const agentId = await createTempAgent('E2E 930 Route', 'openrouter', '');
      const sessionId = await createSession(agentId, 'E2E 930 route probe');

      const { ws, frames } = await openCapturingWs();
      try {
        // One cheap turn so the engine session exists (persists sdk_session_id).
        // Wait for an actual assistant answer, not just a non-working status —
        // the DB can still read 'idle' before the engine starts the turn, and
        // A1 below REQUIRES the turn to be finished (idle-time report).
        sendTurn(ws, sessionId, 'Reply with the single word: ready');
        const settled = await poll(
          async () => {
            const s = await getSession(sessionId);
            if (s.status === 'working' || s.status === 'starting') {
              throw new Error(`session still ${s.status}`);
            }
            const m = await apiJson<{ messages: Array<{ role: string }> }>(
              `/agent-sessions/${sessionId}/messages`,
            );
            if (!m.messages.some((msg) => msg.role === 'output')) {
              throw new Error(`no assistant answer yet (status=${s.status})`);
            }
            return s;
          },
          120_000,
          800,
          `await first answer for ${sessionId}`,
        );
        expect(settled.status).toBe('idle');
        const sdkSessionId = settled.sdkSessionId;
        expect(sdkSessionId, 'sdk_session_id not persisted after first turn').toBeTruthy();

        // ── A1: exhaustion intake resolves + persists + notifies ──────────
        frames.length = 0;
        const body = await apiJson<{
          ok: boolean;
          handoff: boolean;
          providerID: string;
          modelID: string;
        }>('/opencode/spillover', {
          method: 'POST',
          body: JSON.stringify({ sdkSessionId, fromAccountId: 'team', exhausted: true }),
        });
        expect(body.ok).toBe(true);
        expect(
          body.handoff,
          'no cross-provider tier resolved — auth a non-Anthropic provider (openrouter suffices) and re-run',
        ).toBe(true);
        // Tolerant of WHICH tier it lands on (authed set varies by machine),
        // strict that it is a non-Anthropic FALLBACK_CHAIN tier.
        expect(NON_ANTHROPIC_TIERS).toContain(body.providerID);
        expect(body.modelID).toBeTruthy();

        // Persistence on the session row.
        const after = await getSession(sessionId);
        expect(after.providerId).toBe(body.providerID);
        expect(after.modelId).toBe(body.modelID);

        // Notification: exact reason string, on this session.
        const spill = await poll(
          async () => {
            const f = frames.find(
              (fr) => fr.type === 'session.spillover' && fr.sessionId === sessionId,
            );
            if (!f) throw new Error('session.spillover frame not yet received');
            return f;
          },
          10_000,
          250,
          'await session.spillover frame',
        );
        expect(spill.reason).toBe(CROSS_PROVIDER_REASON);
        expect(spill.toProvider).toBe(body.providerID);
        expect(spill.toModel).toBe(body.modelID);

        // ── A2: next-turn pickup — the following turn runs on the new provider
        frames.length = 0;
        const assistantFramesOf = () =>
          frames.filter((fr) => {
            if (fr.type !== 'message.updated' || fr.id !== sessionId) return false;
            const info = fr.info as Record<string, unknown> | undefined;
            return info?.role === 'assistant' && typeof info?.providerID === 'string';
          });
        sendTurn(ws, sessionId, 'Reply with the single word: switched');
        // Live-run evidence (2026-07-08): the DB status can still read 'idle'
        // before the engine flips the session to working, so a bare
        // settle-poll returns before ANY turn events stream. Wait for the
        // assistant frame itself, then for the turn to settle.
        await poll(
          async () => {
            if (assistantFramesOf().length === 0) {
              const s = await getSession(sessionId);
              throw new Error(`no assistant frame yet (status=${s.status})`);
            }
            const s = await getSession(sessionId);
            if (s.status === 'working' || s.status === 'starting') {
              throw new Error(`assistant frame seen but session still ${s.status}`);
            }
            return s;
          },
          120_000,
          800,
          'await turn-2 assistant frame',
        );
        // NOTE: the engine RE-EMITS message.updated for PRIOR messages during
        // a turn (rehydration/title passes), so the FIRST assistant frame can
        // be turn-1's (old provider). Assert the handed-off provider appears
        // among the turn's assistant frames — the new answer must have been
        // produced on it.
        const assistantProviders = assistantFramesOf().map(
          (fr) => ((fr as Record<string, unknown>).info as Record<string, unknown>).providerID,
        );
        expect(assistantProviders, `assistant frames carried providers [${assistantProviders.join(', ')}]`).toContain(
          body.providerID,
        );

        // ── A3: an exhaustion report while the session is IDLE (no failing
        // turn in flight) must never spuriously re-dispatch or error the
        // session. (True at-most-once — retry fails → normal error — is
        // unit-covered in turn_redispatch.test.ts; not forcible live.)
        await apiJson('/opencode/spillover', {
          method: 'POST',
          body: JSON.stringify({ sdkSessionId, fromAccountId: 'team', exhausted: true }),
        });
        await new Promise((r) => setTimeout(r, 3_000));
        const still = await getSession(sessionId);
        expect(still.status, `status=${still.status} message=${still.statusMessage}`).toBe('idle');
      } finally {
        ws.close();
      }
    },
    300_000, // 2 live turns + polling
  );
});

describeLiveForced('live E2E — #930 mid-run resume (requires backend RHYTHM_FORCE_EXHAUSTED=1)', () => {
  beforeAll(async () => {
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${eng.status}) — wait for spawn and re-run`);
    }
  });

  it(
    'B: an interrupted anthropic turn resumes on the fallback provider in the SAME session — one final answer, no duplicate partial, no user-visible error',
    async () => {
      // Anthropic-pinned agent: with RHYTHM_FORCE_EXHAUSTED=1 the very first
      // request 429s synthetically (no tokens burned) and fires the
      // markAccountsExhausted → spillover → revert + re-prompt path.
      const agentId = await createTempAgent('E2E 930 Midrun', 'anthropic', 'claude-sonnet-4-6');
      const sessionId = await createSession(agentId, 'E2E 930 mid-run probe');

      const { ws, frames } = await openCapturingWs();
      try {
        sendTurn(ws, sessionId, 'Reply with the single word: resumed');

        // The turn must settle to IDLE (resumed + completed on the fallback
        // provider) — NOT to error. The abort of the failed turn can produce a
        // TRANSIENT idle before the re-prompt lands, so require an assistant
        // answer to exist too, not just an idle status. Generous timeout:
        // 429 + handoff + abort + revert + full retry turn.
        const settled = await poll(
          async () => {
            const s = await getSession(sessionId);
            if (s.status === 'error') return s; // fail fast — assertions below flag it
            if (s.status !== 'idle') throw new Error(`session still ${s.status}`);
            const m = await apiJson<{ messages: Array<{ role: string }> }>(
              `/agent-sessions/${sessionId}/messages`,
            );
            if (!m.messages.some((msg) => msg.role === 'output')) {
              throw new Error('idle but no assistant answer yet (abort-transient idle)');
            }
            return s;
          },
          180_000,
          800,
          `await resumed answer for ${sessionId}`,
        );
        expect(settled.status).toBe('idle');

        // Same session, new provider persisted.
        expect(settled.providerId).not.toBe('anthropic');
        expect(NON_ANTHROPIC_TIERS).toContain(settled.providerId);

        // The handoff was notified with the exact reason string.
        const spill = frames.find(
          (fr) => fr.type === 'session.spillover' && fr.sessionId === sessionId,
        );
        expect(spill, 'no session.spillover frame for the mid-run handoff').toBeTruthy();
        expect((spill as Record<string, unknown>).reason).toBe(CROSS_PROVIDER_REASON);

        // No user-visible error frame: the failed turn's error was deferred
        // and consumed by the re-dispatch, not finalized.
        const errFrame = frames.find((fr) => fr.type === 'error' && fr.id === sessionId);
        expect(errFrame, `error frame surfaced: ${JSON.stringify(errFrame)}`).toBeUndefined();

        // Exactly ONE final answer, no duplicate partial output. The synthetic
        // 429 fires before any assistant text streams, and the revert discards
        // the failed turn engine-side — so the transcript must contain exactly
        // one assistant ('output') message.
        const msgs = await apiJson<{ messages: Array<{ role: string; rawText?: string | null }> }>(
          `/agent-sessions/${sessionId}/messages`,
        );
        const outputs = msgs.messages.filter((m) => m.role === 'output');
        expect(outputs).toHaveLength(1);
        // The reverted user message may or may not have been removed by a
        // message.removed event depending on engine timing — tolerate 1-2
        // input rows, but never more (no unbounded replay).
        const inputs = msgs.messages.filter((m) => m.role === 'input');
        expect(inputs.length).toBeGreaterThanOrEqual(1);
        expect(inputs.length).toBeLessThanOrEqual(2);
      } finally {
        ws.close();
      }
    },
    240_000,
  );
});

// Keep vitest from auto-exiting while a stray WS is still closing.
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
});
