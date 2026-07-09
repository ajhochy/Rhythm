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
import { writeDraftManagedSkill } from '../services/rhythm_managed_skills';

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

/**
 * #959 — dependency guard, DETERMINISTIC live gate.
 *
 * Deliberately does NOT depend on live LLM distillation (the #949 harvest step
 * — known-fragile on free-tier models, #951, and already covered by #949's own
 * gate + the block above). Instead it SEEDS the precondition:
 *   - Two draft SKILL.md files written directly via the harvester's own
 *     `writeDraftManagedSkill` (filesystem only — the SAME managed dir the
 *     running server's fork scans; RHYTHM_MANAGED_SKILLS_DIR is left unset here
 *     so it resolves to the home default, exactly as the server does — no
 *     second better-sqlite3 connection, no torn-read risk). Both have a
 *     concrete stated purpose but an empty/placeholder body, so the REAL judge
 *     reliably scores each in the 0-20 disable tier (scoreSkillBody is
 *     fail-closed to 0 regardless) — the disable branch is reached without
 *     mocking the scorer.
 *   - A SCOPED agent-config whose allowlist references ONLY the first draft
 *     (via the real POST /agent-configs). This is exactly the
 *     agent_configs.allowed_skills_json surface the guard reads, so the first
 *     draft is "depended on" and the second is not.
 *
 * The evaluation trigger is MODEL-INDEPENDENT: the gate launches the server
 * with `RHYTHM_HARVEST_EVAL_THRESHOLD=0`, so evaluateHarvestedDrafts (which
 * fires unconditionally after EVERY completed turn) evaluates every
 * status:draft draft regardless of usage. The test therefore only needs ONE
 * arbitrary turn to complete — it never depends on a weak model choosing to
 * invoke specific skills. Both drafts get an identical bad body and are
 * evaluated in the same pass, so the ONLY difference between them is the
 * dependency, making the guard the sole discriminator.
 *
 * The keep/disable DECISION stays fully real: real evaluateHarvestedDrafts,
 * real agent_configs allowlist read, real LLM judge scoring, real
 * materialize/dematerialize against the running server.
 */
describeLive('live E2E — #959 dependency guard (deterministic seed, no live distillation)', () => {
  beforeAll(async () => {
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${eng.status}) — wait for spawn and re-run`);
    }
  });

  it(
    'a low-scoring draft referenced by an agent allowlist is NOT disabled; an identical un-referenced draft still is',
    async () => {
      // Names use alnum + dash only, so slug === name === frontmatter.name (no
      // slug/name ambiguity across writeDraftManagedSkill / listDraftSkillNames
      // / GET /opencode/skills). Timestamped to avoid collisions + ease cleanup.
      const ts = Date.now();
      const dependedName = `zzz-e2e-guard-dep-${ts}`;
      const undependedName = `zzz-e2e-guard-undep-${ts}`;

      const seedDraft = (name: string) => {
        writeDraftManagedSkill({
          name,
          description:
            'Deploy a production Kubernetes cluster with zero-downtime blue-green rollout and automated rollback.',
          body: 'TODO: write this later.',
          sourceSessionId: 'e2e-959-seed',
          confidence: 0.7,
          provenance: 'auto-extract',
        });
        createdDraftNames.push(name);
      };
      seedDraft(dependedName);
      seedDraft(undependedName);

      // Establish the dependency: a scoped agent referencing ONLY the depended
      // draft. It never runs — it exists solely to make dependedName depended-on.
      const anchor = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          label: `E2E #959 Dependency Anchor ${ts}`,
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          allowedSkillsJson: JSON.stringify([dependedName]),
        }),
      });
      createdAgentIds.push(anchor.id);

      // An UNRESTRICTED agent (no allowlist → null) whose session drives ONE
      // arbitrary turn to fire the post-turn evaluator. Being unrestricted it
      // contributes no allowlist entry, so undependedName stays referenced by
      // no agent. It does NOT invoke any skill.
      //
      // The model is PINNED to the authed Anthropic tier (provider 'anthropic',
      // claude-sonnet-4-6 — the resolver's hardcoded default + what migrations
      // pin working agents to). NOT openrouter/free: that tier HANGS in this
      // env (routes with no completion and no error frame, so the #952 fallback
      // watchdog gap can't rescue it) — which is exactly what sank the trigger
      // turn. The session persists no model, so resolveModelForSessionTurn
      // falls through to this agent_configs model (honored because 'anthropic'
      // is authed).
      const invoker = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          label: `E2E #959 Invoker ${ts}`,
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          modelProvider: 'anthropic',
          modelId: 'claude-sonnet-4-6',
          systemPrompt: 'You are a test agent. Reply concisely.',
        }),
      });
      createdAgentIds.push(invoker.id);

      // Make the fork discover the freshly-seeded draft files.
      await refresh();
      await poll(
        async () => {
          const names = new Set((await listSkillsWithMetadata()).map((s) => s.name));
          if (names.has(dependedName) && names.has(undependedName)) return true;
          throw new Error('seeded drafts not yet discovered by the engine');
        },
        30_000,
        1_000,
        'wait for engine to discover the seeded drafts',
      );

      const sess = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({ agentId: invoker.id, name: 'E2E #959 guard probe', cwd: homedir() }),
      });
      createdSessionIds.push(sess.id);

      const ws = connectWs();
      try {
        // ONE arbitrary completing turn. With RHYTHM_HARVEST_EVAL_THRESHOLD=0
        // (see the gate command in this file's docstring), the post-turn
        // evaluateHarvestedDrafts evaluates EVERY status:draft draft regardless
        // of usage — so the gate does NOT depend on the model invoking any
        // skill, only that a single turn completes.
        await sendPromptAndAwait(ws, sess.id, 'Reply with exactly the word: ok');
      } finally {
        ws.close();
      }

      // Wait for the evaluator to finish BOTH drafts: the depended one leaves
      // status:draft while staying live; the undepended one is archived
      // (removed from the live list, present in disabled/). If this stalls with
      // both still status:draft, the server was NOT launched with
      // RHYTHM_HARVEST_EVAL_THRESHOLD=0 (threshold fell back to 3).
      await poll(
        async () => {
          const skills = await listSkillsWithMetadata();
          const dep = skills.find((s) => s.name === dependedName);
          const undep = skills.find((s) => s.name === undependedName);
          const depDone = !!(dep && dep.metadata?.status && dep.metadata.status !== 'draft');
          const undepDone = !undep && existsSync(join(DISABLED_DIR, undependedName, 'SKILL.md'));
          if (depDone && undepDone) return true;
          throw new Error(
            `evaluator not done (dep=${dep?.metadata?.status ?? 'gone'}, undepListed=${!!undep}); ` +
              `if both are still 'draft', launch the server with RHYTHM_HARVEST_EVAL_THRESHOLD=0`,
          );
        },
        120_000,
        2_000,
        'wait for evaluateHarvestedDrafts to process both seeded drafts',
      );

      // ── #959 — the depended-on skill is NEVER auto-disabled ──────────────
      const skills = await listSkillsWithMetadata();
      const depEntry = skills.find((s) => s.name === dependedName);
      expect(
        depEntry,
        `#959 regression: depended-on draft '${dependedName}' was removed from the live picker`,
      ).toBeTruthy();
      expect(depEntry?.metadata?.status).not.toBe('draft');
      expect(['active', 'rewrite-needed']).toContain(depEntry?.metadata?.status);
      expect(existsSync(join(DISABLED_DIR, dependedName, 'SKILL.md'))).toBe(false);

      // ── Negative control — identical bad body, NO agent depends on it → it
      // DOES disable. Proves the dependency is the sole discriminator, not the
      // score (both drafts scored in the same disable tier).
      expect(skills.find((s) => s.name === undependedName)).toBeFalsy();
      expect(existsSync(join(DISABLED_DIR, undependedName, 'SKILL.md'))).toBe(true);
    },
    180_000, // 3 min: one completing turn + evaluator LLM judge x2 + polling.
  );
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
});
