/**
 * Live E2E test for #1088 — decouple picker visibility from schedulability.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Drives the running sandbox api_server + real opencode engine (never
 * the live app — see `assertLiveE2EIsolation`).
 *
 * Run it against the dev sandbox (`tools/dev/sandbox.sh up`):
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   DB_PATH=<sandbox dir>/rhythm.db \
 *   npx vitest run src/__tests__/live_e2e_1088_hidden_schedulable.test.ts
 *
 * What it proves (the issue's explicit acceptance criterion): a profile that
 * is HIDDEN from the picker (sessionSelectable=false) but explicitly marked
 * schedulable=true is (a) accepted by assertSchedulableProfile at schedule
 * create time, (b) projected `mode: all` so opencode resolves it as a
 * top-level `agent:` target, and (c) actually runs end-to-end through the
 * real scheduler → AgentRunner → opencode engine, producing a non-empty
 * assistant output — all while never appearing in the session picker.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const AGENTS_DIR = process.env.RHYTHM_SANDBOX_DIR
  ? join(process.env.RHYTHM_SANDBOX_DIR, 'home', '.config', 'opencode', 'agents')
  : join(homedir(), '.config', 'opencode', 'agents');

const describeLive = LIVE ? describe : describe.skip;

// Sandbox isolation can't reach keychain-bound Anthropic OAuth (see
// docs/ai/project-state.md), so default to an OpenRouter model that the
// sandbox auth.json can actually authenticate. Override via env for other
// backends. An empty id lets the engine pick the provider default.
const MODEL = {
  provider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'openrouter',
  id: process.env.RHYTHM_LIVE_MODEL_ID || 'anthropic/claude-haiku-4.5',
};

let createdAgentIds: string[] = [];
let createdScheduleIds: string[] = [];

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

async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 1000,
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

afterEach(async () => {
  for (const id of createdScheduleIds) await api(`/agent-schedules/${id}`, { method: 'DELETE' }).catch(() => {});
  for (const id of createdAgentIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
    await rm(join(AGENTS_DIR, `${id}.md`), { force: true }).catch(() => {});
  }
  createdScheduleIds = [];
  createdAgentIds = [];
});

describeLive('live E2E — #1088 hidden-but-schedulable specialist', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start the sandbox first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${eng.status})`);
    }
  });

  it(
    'schedules and runs a hidden specialist as its real profile, producing non-empty output',
    async () => {
      // 1. Create a HIDDEN specialist (sessionSelectable=false) explicitly
      //    marked schedulable=true — the exact shape #1088 unlocks.
      const cfg = await apiJson<{ id: string; sessionSelectable: boolean; schedulable: boolean }>(
        '/agent-configs',
        {
          method: 'POST',
          body: JSON.stringify({
            label: 'E2E Hidden Schedulable 1088',
            isAgent: true,
            enabled: true,
            sessionSelectable: false,
            schedulable: true,
            modelProvider: MODEL.provider,
            modelId: MODEL.id || undefined,
            systemPrompt: 'You are a terse test agent. Answer in one short sentence.',
          }),
        },
      );
      createdAgentIds.push(cfg.id);
      expect(cfg.sessionSelectable).toBe(false);
      expect(cfg.schedulable).toBe(true);

      // 2. Confirm the projected .md is `mode: all` (top-level runnable AND a
      //    delegation target) despite being hidden from the picker.
      const { readFile } = await import('node:fs/promises');
      const projected = await poll(
        async () => {
          const content = await readFile(join(AGENTS_DIR, `${cfg.id}.md`), 'utf8');
          if (!/^mode:\s*all\s*$/m.test(content)) throw new Error('mode not yet "all"');
          return content;
        },
        10_000,
        500,
        'projected .md mode:all',
      );
      expect(projected).toMatch(/^mode:\s*all\s*$/m);

      // 3. Create a schedule bound to the hidden specialist — must be ACCEPTED
      //    (the pre-#1088 guard rejected any sessionSelectable=false binding).
      const schedule = await apiJson<{ id: string }>('/agent-schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'E2E hidden-schedulable run',
          scheduleType: 'daily',
          scheduledTime: '23:59',
          prompt: 'Reply with the single word: acknowledged.',
          agentConfigId: cfg.id,
        }),
      });
      createdScheduleIds.push(schedule.id);

      // 4. Force it due now and let the real 1-minute scheduler tick pick it
      //    up through the real AgentRunner + opencode engine.
      await api(`/agent-schedules/${schedule.id}/trigger-now`, { method: 'POST' });

      const finished = await poll(
        async () => {
          const task = await apiJson<{ lastRunStatus: string | null; lastError: string | null }>(
            `/agent-schedules/${schedule.id}`,
          );
          if (
            task.lastRunStatus !== 'completed_no_op' &&
            task.lastRunStatus !== 'success' &&
            task.lastRunStatus !== 'error'
          ) {
            throw new Error(`still ${task.lastRunStatus ?? 'pending'}`);
          }
          return task;
        },
        150_000, // up to 1 cron tick (60s) + a real LLM turn
        2_000,
        'scheduled run to finish',
      );
      expect(finished.lastRunStatus, `run failed: ${finished.lastError}`).toBe('completed_no_op');

      // 5. The run executed AS the hidden specialist profile — locate its
      //    session and assert non-empty assistant output (behavior, not code).
      const { sessions } = await apiJson<{
        sessions: Array<{ id: string; agentKind: string; status: string; statusMessage: string | null }>;
      }>(`/agent-sessions?scheduledTaskId=${schedule.id}`);
      expect(sessions.length).toBeGreaterThan(0);
      const session = sessions[0];
      // Profile-bound scheduled sessions record the profile id in agentKind.
      expect(session.agentKind).toBe(cfg.id);

      // Engine→api message sync can lag a completed run by a beat, so poll the
      // transcript rather than reading once. Extract text from any string-ish
      // part field (engines vary: text | content | reasoning summaries).
      // The transcript API tags the model turn with role 'output' (user turn is
      // 'input'); older shapes used 'assistant'. Accept both. Text lives in a
      // 'text' part (alongside step-start/step-finish markers).
      const extractAssistantText = (messages: unknown[]): string => {
        return messages
          .map((m) => {
            const msg = m as Record<string, unknown>;
            const info = (msg.info ?? msg) as Record<string, unknown>;
            const role = info?.role;
            if (role !== 'output' && role !== 'assistant') return '';
            const parts = (msg.parts ?? []) as Array<Record<string, unknown>>;
            return parts
              .filter((p) => p.type === 'text')
              .map((p) => String(p.text ?? p.content ?? ''))
              .join('');
          })
          .join('')
          .trim();
      };

      const credsUnavailable =
        /credential|unavailable|expired|not authenticated|no api key|refresh them/i.test(
          session.statusMessage ?? '',
        );
      if (credsUnavailable) {
        throw new Error(
          `#1088 environment failure: sandbox model credentials unavailable (${session.statusMessage})`,
        );
      }
      const assistantText = await poll(
        async () => {
          const { messages } = await apiJson<{ messages: unknown[] }>(
            `/agent-sessions/${session.id}/messages`,
          );
          const environmentError = messages
            .map((message) => message as Record<string, unknown>)
            .filter((message) => message.role === 'system')
            .map((message) => String(message.rawText ?? message.strippedText ?? ''))
            .find((text) => /credential|credits?|expired|not authenticated|no api key|refresh them/i.test(text));
          if (environmentError) {
            throw new Error(
              '#1088 environment failure: model provider reports missing credentials or credits',
            );
          }
          const text = extractAssistantText(messages);
          if (text.length === 0) throw new Error('assistant text not synced yet');
          return text;
        },
        20_000,
        2_000,
        'assistant output to sync',
      );
      expect(assistantText.length).toBeGreaterThan(0);
    },
    180_000,
  );
});
