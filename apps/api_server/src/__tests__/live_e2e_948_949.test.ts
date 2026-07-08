/**
 * Live E2E test for #948 (POST /system/refresh) + #949 (harvest-to-file).
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite because it drives real LLM sessions (costs tokens, ~2-3 min) against
 * the running local agent server on :4001.
 *
 * Run it:
 *   RHYTHM_LIVE_E2E=1 npx vitest run __tests__/live_e2e_948_949.test.ts
 *
 * Prerequisites:
 *   - The Rhythm api_server is running on localhost:4001 (AGENT_LOCAL=true,
 *     so /system/refresh and /agent-configs need no bearer token).
 *   - The opencode engine is spawned and ready (GET /opencode/health → ready).
 *   - A working Anthropic key is configured (the #949 phase runs 2 real LLM
 *     turns).
 *
 * What it proves:
 *   #948 (deterministic, ~2s): a Config Doctor-style on-disk edit to an agent
 *     profile is invisible to GET /agent-sessions/agents until POST
 *     /system/refresh invalidates the fork's infinite-TTL global config cache.
 *   #949 (LLM-driven, ~2-3 min): a 2+ round session on a SCOPED extracting
 *     agent triggers distillFromSession, which writes a draft SKILL.md under
 *     drafts/, auto-binds the draft name to the agent's allowedSkillsJson,
 *     and makes the draft discoverable via GET /opencode/skills.
 *
 * Cleanup: every artifact created (agent config + agent file, draft skill,
 * session) is removed in afterEach, even on failure.
 */
import { vi, describe, it, expect, afterEach, beforeAll } from 'vitest';
import { WebSocket } from 'ws';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const AGENTS_DIR = join(homedir(), '.config', 'opencode', 'agents');
const DRAFTS_DIR = join(homedir(), '.config', 'opencode', 'rhythm-managed-skills', 'drafts');

const describeLive = LIVE ? describe : describe.skip;

// A real skill name that exists on the live server, used as the seed
// allowedSkillsJson for the temp scoped agent so the session can run.
const SEED_SKILL = 'smoke-test';
const MODEL = { provider: 'anthropic', id: 'claude-sonnet-4-6' };

// Per-test artifacts awaiting cleanup.
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
      modelId: MODEL.id,
      // SCOPED (array, not null) so distill auto-bind actually fires (#949
      // step 3). null would make autoBindDraftToExtractingAgent skip.
      allowedSkillsJson: JSON.stringify([SEED_SKILL]),
      systemPrompt:
        'You are a test agent. When asked to write code, produce a clear, step-by-step procedure that another developer could follow. Keep each step short and concrete.',
    }),
  });
  createdAgentIds.push(cfg.id);
  return cfg.id;
}

async function deleteAgent(id: string): Promise<void> {
  await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
  // Also remove the projected agent file (delete endpoint should do this, but
  // be belt-and-suspenders so the agents dir is clean).
  await rm(join(AGENTS_DIR, `${id}.md`), { force: true });
}

async function listEngineAgents(): Promise<Array<{ name: string; description?: string }>> {
  const r = await apiJson<{ agents: Array<{ name: string; description?: string }> }>(
    '/agent-sessions/agents',
  );
  return r.agents ?? [];
}

async function refresh(): Promise<{ status: string; refreshed: string[] }> {
  return apiJson('/system/refresh', { method: 'POST' });
}

/** Poll a predicate with a timeout (ms). Throws the last error on timeout. */
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

/** Edit the `description:` frontmatter line of an agent .md file on disk. */
async function patchAgentFileDescription(agentId: string, newDescription: string): Promise<void> {
  const file = join(AGENTS_DIR, `${agentId}.md`);
  const content = await readFile(file, 'utf8');
  const replaced = /^description:.*$/m.test(content)
    ? content.replace(/^description:.*$/m, `description: ${newDescription}`)
    : `description: ${newDescription}\n${content}`;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, replaced, 'utf8');
}

/** Send a prompt via the WS gateway and wait for the session to go idle. */
async function sendPromptAndAwait(
  ws: WebSocket,
  sessionId: string,
  text: string,
): Promise<void> {
  const sent = new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.send(
        JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: text }),
      );
      ws.off('open', onOpen);
      resolve();
    };
    if (ws.readyState === WebSocket.OPEN) onOpen();
    else {
      ws.once('open', onOpen);
      ws.once('error', reject);
    }
  });
  await sent;
  // Poll the session row until the turn is done (status back to 'idle').
  await poll(
    async () => {
      const s = await apiJson<{ session: { status: string } }>(
        `/agent-sessions/${sessionId}`,
      );
      if (s.session.status !== 'working' && s.session.status !== 'starting') return s;
      throw new Error(`session still ${s.session.status}`);
    },
    120_000,
    800,
    `await turn idle for ${sessionId}`,
  );
}

function connectWs(): WebSocket {
  const url = BASE.replace(/^http/, 'ws') + '/ws/agents';
  return new WebSocket(url);
}

async function listSkills(): Promise<Array<{ name: string; description?: string }>> {
  const r = await apiJson<unknown>('/opencode/skills');
  return Array.isArray(r) ? (r as Array<{ name: string; description?: string }>) : [];
}

afterEach(async () => {
  // Best-effort cleanup — never let one test's leftovers break the next.
  for (const id of createdSessionIds) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of createdAgentIds) await deleteAgent(id);
  for (const name of createdDraftNames) {
    await rm(join(DRAFTS_DIR, name), { recursive: true, force: true }).catch(() => {});
  }
  createdSessionIds = [];
  createdAgentIds = [];
  createdDraftNames = [];
});

describeLive('live E2E — #948 + #949', () => {
  beforeAll(async () => {
    // Fail fast with a clear message if the server isn't up / engine not ready.
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(
        `opencode engine not ready (status=${eng.status}) — wait for spawn and re-run`,
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // #948 — deterministic, ~2s. Proves the fork's infinite-TTL global config
  // cache is invalidated by POST /system/refresh, so a Config Doctor on-disk
  // edit to an agent file is visible to new sessions without a restart.
  // ───────────────────────────────────────────────────────────────────────────
  describe('#948 — POST /system/refresh invalidates the agent profile cache', () => {
    it('a disk edit is invisible until refresh, then visible after', async () => {
      const id = await createTempAgent('E2E Cache A');
      // Newly-created agent file isn't in the cached config yet — refresh once
      // so it appears, giving us a baseline to mutate.
      await refresh();
      const before = await poll(
        async () => {
          const agents = await listEngineAgents();
          const a = agents.find((x) => x.name === id);
          if (!a) throw new Error('temp agent not discovered after refresh');
          return a;
        },
        15_000,
        500,
        'discover temp agent',
      );
      expect(before.description).toBe('E2E Cache A');

      // Config Doctor-style on-disk edit to the description frontmatter.
      await patchAgentFileDescription(id, 'E2E Cache A (edited by doctor)');

      // Cache is still stale — the edit must NOT be visible without refresh.
      const stale = await listEngineAgents();
      const staleAgent = stale.find((x) => x.name === id);
      expect(staleAgent, 'temp agent vanished from listAgents — cache mismatch').toBeTruthy();
      expect(staleAgent!.description).toBe('E2E Cache A');

      // The fix: refresh invalidates the global config cache.
      const r = await refresh();
      expect(r.status).toBe('ok');
      expect(r.refreshed).toContain('agent-profiles');
      expect(r.refreshed).toContain('skills');

      // Now the on-disk edit is visible to new sessions.
      const fresh = await listEngineAgents();
      const freshAgent = fresh.find((x) => x.name === id);
      expect(freshAgent!.description).toBe('E2E Cache A (edited by doctor)');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // #949 — LLM-driven, ~2-3 min. Runs a real 2+ round session on a scoped
  // extracting agent and verifies distillFromSession harvests a draft skill,
  // auto-binds it, and makes it discoverable.
  // ───────────────────────────────────────────────────────────────────────────
  describe('#949 — distillFromSession harvests a draft + auto-binds', () => {
    // Relaxed timeout: real LLM turns + the fire-and-forget distill LLM call.
    // NOTE: the distill is LLM-driven (confidence gate ≥0.6, dedup). It can
    // flake on a low-confidence or duplicate-title distill; re-run if so. The
    // prompts are deliberately procedural to maximize harvestable signal.
    it(
      '2+ round session on a scoped agent produces a draft skill file',
      async () => {
        const agentId = await createTempAgent('E2E Distill A');
        await refresh(); // make the new agent discoverable

        // Create a session bound to the scoped agent.
        const sess = await apiJson<{ session: { id: string } }>('/agent-sessions', {
          method: 'POST',
          body: JSON.stringify({
            agentId,
            name: 'E2E distill probe',
            cwd: homedir(),
          }),
        });
        const sessionId = sess.session.id;
        createdSessionIds.push(sessionId);

        // Two procedural prompts — distill needs ≥2 assistant ('output') rounds.
        // The prompts are deliberately step-by-step so the distill LLM has a
        // clear procedure to harvest (confidence gate ≥0.6).
        const ws = connectWs();
        try {
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
        } finally {
          ws.close();
        }

        // distillFromSession is fire-and-forget after the 2nd turn — poll the
        // drafts dir for a freshly-written SKILL.md (generous timeout: the
        // distill LLM call can take 30-60s).
        const beforeNames = new Set(
          (await readdir(DRAFTS_DIR).catch(() => [])).map((d) => d),
        );
        const newDraftDir = await poll(
          async () => {
            const entries = await readdir(DRAFTS_DIR).catch(() => [] as string[]);
            const fresh = entries.filter((d) => !beforeNames.has(d));
            for (const name of fresh) {
              const skillMd = join(DRAFTS_DIR, name, 'SKILL.md');
              if (existsSync(skillMd)) return { name, skillMd };
            }
            throw new Error('no new draft SKILL.md yet');
          },
          120_000,
          1_500,
          'wait for distill draft file',
        );
        createdDraftNames.push(newDraftDir.name);

        // Step 2: draft file exists with status: draft frontmatter.
        const body = await readFile(newDraftDir.skillMd, 'utf8');
        expect(body).toMatch(/status:\s*draft/);

        // Step 4: GET /opencode/skills lists the draft.
        const skills = await listSkills();
        const found = skills.find((s) => s.name === newDraftDir.name);
        expect(found, `draft '${newDraftDir.name}' not in /opencode/skills`).toBeTruthy();

        // Step 3: the extracting agent's allowedSkillsJson now includes the
        // draft name. (Auto-bind fires because the agent is SCOPED — null would
        // skip, which is why SEED_SKILL made this an array.)
        const cfg = await apiJson<{ allowedSkillsJson: string | null }>(
          `/agent-configs/${agentId}`,
        );
        const allowed = cfg.allowedSkillsJson ? (JSON.parse(cfg.allowedSkillsJson) as string[]) : [];
        expect(allowed).toContain(newDraftDir.name);

        // Step 5 (Flutter UI): the UI reads GET /opencode/skills, which we just
        // asserted lists the draft — so the UI will show it. Manual visual
        // confirmation stays with the reviewer; the API contract is proven here.
      },
      240_000, // 4 min hard cap: 2 LLM turns + distill LLM + polling.
    );
  });
});

// Keep vitest from auto-exiting while a stray WS is still closing.
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
});
