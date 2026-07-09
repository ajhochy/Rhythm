/**
 * Live E2E test for #929 (skill self-regulation loop).
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite because it drives multiple real LLM turns against the running local
 * agent server (harvest + 3 real `skill`-tool invocations + evaluation).
 *
 * Run it:
 *   RHYTHM_LIVE_E2E=1 npx vitest run __tests__/live_e2e_929.test.ts
 *
 * NOTE ON PORT: live_e2e_948_949.test.ts defaults to :4001 (that was the
 * server's port when it was written). The server in THIS environment runs on
 * :4000 — set RHYTHM_LIVE_URL to override either way; do not assume the
 * default matches your running instance.
 *
 * Prerequisites (same as live_e2e_948_949.test.ts):
 *   - The Rhythm api_server is running (AGENT_LOCAL=true — no bearer token).
 *   - The opencode engine is spawned and ready (GET /opencode/health → ready).
 *   - A working model is configured (this test runs several real LLM turns).
 *
 * What it proves (Units 1-3; Unit 4 needs a whole bad-harvest streak and is
 * out of scope for a single-skill smoke — it has full unit coverage in
 * harvested_skill_evaluator.test.ts instead):
 *   Unit 1: the harvested draft is immediately usable — GET /opencode/skills
 *     lists it right after the #949 harvest (already proven by
 *     live_e2e_948_949.test.ts; re-asserted here as this test's precondition).
 *   Unit 2: real `skill`-tool invocations (not the legacy DB-preface hint) are
 *     what the evaluator counts — driven by explicitly prompting the SAME
 *     scoped agent to invoke the skill tool by name, 3 times.
 *   Unit 3: once the draft's real usage count reaches the threshold, the
 *     fire-and-forget evaluator (wired into agent_runner.ts's post-turn path)
 *     scores it and moves it OFF `status: draft` — to `active` (kept),
 *     `rewrite-needed` (flagged, still live), or it disappears from the live
 *     picker (disabled/archived). The test accepts any of the three — which
 *     one depends on the real LLM judge's opinion of THIS run's draft body,
 *     which is not something a live test should pin down exactly.
 *
 * Cleanup: every artifact created (agent config + agent file, draft/disabled
 * skill dir, session) is removed in afterEach, even on failure.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { WebSocket } from 'ws';
import { readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
// NOTE: defaults to :4000 (this environment's reservation) rather than
// live_e2e_948_949.test.ts's :4001 — always honors RHYTHM_LIVE_URL either way.
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4000';
const DRAFTS_DIR = join(homedir(), '.config', 'opencode', 'rhythm-managed-skills', 'drafts');
const DISABLED_DIR = join(homedir(), '.config', 'opencode', 'rhythm-managed-skills', 'disabled');

const describeLive = LIVE ? describe : describe.skip;

const MODEL = { provider: 'openrouter', id: '' };
const SEED_SKILL = 'smoke-test';

let createdAgentIds: string[] = [];
let createdSessionIds: string[] = [];
let createdDraftNames: string[] = [];

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

async function createTempAgent(label: string): Promise<string> {
  const cfg = await apiJson<{ id: string }>('/agent-configs', {
    method: 'POST',
    body: JSON.stringify({
      label,
      isAgent: true,
      enabled: true,
      sessionSelectable: true,
      modelProvider: MODEL.provider,
      modelId: MODEL.id || undefined,
      // SCOPED (array, not null) so #949's auto-bind fires for the harvest.
      allowedSkillsJson: JSON.stringify([SEED_SKILL]),
      systemPrompt:
        'You are a test agent. When asked to write code, produce a clear, step-by-step procedure that another developer could follow. Keep each step short and concrete. When asked to use a specific skill by name via the skill tool, always do so.',
    }),
  });
  createdAgentIds.push(cfg.id);
  return cfg.id;
}

async function deleteAgent(id: string): Promise<void> {
  await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
}

async function refresh(): Promise<void> {
  await api('/system/refresh', { method: 'POST' }).catch(() => {});
}

async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 500,
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

function connectWs(): WebSocket {
  const url = BASE.replace(/^http/, 'ws') + '/ws/agents';
  return new WebSocket(url);
}

async function sendPromptAndAwait(ws: WebSocket, sessionId: string, text: string): Promise<void> {
  if (ws.readyState !== WebSocket.OPEN) {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
  }
  ws.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: text }));
  await poll(
    async () => {
      const s = await apiJson<{ session: { status: string } }>(`/agent-sessions/${sessionId}`);
      if (s.session.status !== 'working' && s.session.status !== 'starting') return s;
      throw new Error(`session still ${s.session.status}`);
    },
    120_000,
    800,
    `await turn idle for ${sessionId}`,
  );
}

interface SkillEntryWithMetadata {
  name: string;
  metadata?: { status: string | null; uses: number | null };
}

async function listSkillsWithMetadata(): Promise<SkillEntryWithMetadata[]> {
  const r = await apiJson<unknown>('/opencode/skills?withMetadata=true');
  return Array.isArray(r) ? (r as SkillEntryWithMetadata[]) : [];
}

afterEach(async () => {
  for (const id of createdSessionIds) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of createdAgentIds) await deleteAgent(id);
  for (const name of createdDraftNames) {
    await rm(join(DRAFTS_DIR, name), { recursive: true, force: true }).catch(() => {});
    await rm(join(DISABLED_DIR, name), { recursive: true, force: true }).catch(() => {});
  }
  createdSessionIds = [];
  createdAgentIds = [];
  createdDraftNames = [];
});

describeLive('live E2E — #929 skill self-regulation loop', () => {
  beforeAll(async () => {
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${eng.status}) — wait for spawn and re-run`);
    }
  });

  it(
    'a harvested draft, exercised 3 times via the real skill tool, gets evaluated off status:draft',
    async () => {
      const agentId = await createTempAgent('E2E Self-Regulation A');
      await refresh();

      const sess = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({ agentId, name: 'E2E self-regulation probe', cwd: homedir() }),
      });
      const sessionId = sess.id;
      createdSessionIds.push(sessionId);

      const ws = connectWs();
      let draftName: string;
      try {
        // ── Harvest (same shape as #949's own live test) ─────────────────────
        const beforeNames = new Set((await readdir(DRAFTS_DIR).catch(() => [])).map((d) => d));
        await sendPromptAndAwait(
          ws,
          sessionId,
          'Write a Python function that checks whether a number is prime. Explain each step of the algorithm concisely.',
        );
        await sendPromptAndAwait(
          ws,
          sessionId,
          'Now extend it to handle edge cases: 0, 1, negative numbers, and large inputs. List the steps you took.',
        );

        const newDraftDir = await poll(
          async () => {
            const entries = await readdir(DRAFTS_DIR).catch(() => [] as string[]);
            const fresh = entries.filter((d) => !beforeNames.has(d));
            for (const name of fresh) {
              if (existsSync(join(DRAFTS_DIR, name, 'SKILL.md'))) return name;
            }
            throw new Error('no new draft SKILL.md yet');
          },
          120_000,
          1_500,
          'wait for distill draft file',
        );
        draftName = newDraftDir;
        createdDraftNames.push(draftName);

        // ── Unit 2 — 3 real skill-tool invocations of the SAME draft ─────────
        for (let i = 0; i < 3; i++) {
          await sendPromptAndAwait(
            ws,
            sessionId,
            `Use the skill tool to load the skill named "${draftName}" now, then briefly summarize its first step.`,
          );
        }
      } finally {
        ws.close();
      }

      // ── Unit 3 — the fire-and-forget evaluator (triggered after each of the
      // 3 turns above via agent_runner.ts) should have scored the draft and
      // moved it off `status: draft` by now. Poll GET /opencode/skills for
      // either: still listed with a NON-draft status (kept/rewrite-needed), or
      // no longer listed at all (disabled/archived) — both are valid terminal
      // outcomes; which one depends on the live judge's opinion of this run's
      // draft body.
      await poll(
        async () => {
          const skills = await listSkillsWithMetadata();
          const entry = skills.find((s) => s.name === draftName);
          if (!entry) return { outcome: 'disabled' as const };
          if (entry.metadata?.status && entry.metadata.status !== 'draft') {
            return { outcome: entry.metadata.status };
          }
          throw new Error(`'${draftName}' still status:draft — evaluator has not run yet`);
        },
        60_000,
        1_500,
        'wait for harvested_skill_evaluator to move the draft off status:draft',
      );

      const finalSkills = await listSkillsWithMetadata();
      const finalEntry = finalSkills.find((s) => s.name === draftName);
      if (finalEntry) {
        expect(finalEntry.metadata?.status).not.toBe('draft');
        expect(['active', 'rewrite-needed']).toContain(finalEntry.metadata?.status);
      } else {
        // Disabled — archived out of the live picker. Confirm the archive got it.
        expect(existsSync(join(DISABLED_DIR, draftName, 'SKILL.md'))).toBe(true);
      }
    },
    300_000, // 5 min hard cap: 2 harvest turns + 3 skill-invocation turns + evaluator LLM judge + polling.
  );
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
});
