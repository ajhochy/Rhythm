/**
 * Live E2E test for #957 — agent role-text must NOT be materialized as skill
 * stubs in the managed-skills dir.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Read-only: it inspects the running server's state, mutates nothing,
 * needs no cleanup.
 *
 * Run it:
 *   RHYTHM_LIVE_E2E=1 npx vitest run __tests__/live_e2e_957.test.ts
 *
 * Prerequisites:
 *   - The Rhythm api_server is running on localhost:4001 (AGENT_LOCAL=true, so
 *     /agent-configs and /opencode/skills need no bearer token).
 *   - The opencode engine is spawned and ready (GET /opencode/health → ready).
 *   - The server was started at least once against the current DB (so the skill
 *     seed + #797 backfill have run — that is exactly the boot path that used to
 *     write the agent-role stubs).
 *
 * What it proves (the acceptance criteria of #957):
 *   1. NO agent-role stub exists in the managed-skills dir — no managed skill
 *      (GET /opencode/skills, managed=true) is named after an agent
 *      (GET /agent-configs id / GET /agent-sessions/agents name), AND no
 *      on-disk subdir of the managed dir is named after an agent id.
 *   2. Real managed skills still materialize/appear — the managed skill set is
 *      non-empty after removing any (hypothetical) agent-named entries, so the
 *      fix did not break legitimate materialization (#949 harvest + published
 *      skills).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const MANAGED_DIR =
  process.env.RHYTHM_MANAGED_SKILLS_DIR ??
  join(homedir(), '.config', 'opencode', 'rhythm-managed-skills');

const describeLive = LIVE ? describe : describe.skip;

async function apiJson<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

/** Every identifier an agent-role stub would be named after (agent id + engine name). */
async function agentIdentifiers(): Promise<Set<string>> {
  const ids = new Set<string>();
  const configs = await apiJson<Array<{ id?: string; ocAgent?: string; label?: string }>>(
    '/agent-configs',
  );
  for (const c of configs ?? []) {
    if (c.id) ids.add(c.id);
    if (c.ocAgent) ids.add(c.ocAgent);
  }
  const engineAgents = await apiJson<Array<{ name?: string }>>('/agent-sessions/agents');
  for (const a of engineAgents ?? []) if (a.name) ids.add(a.name);
  return ids;
}

describeLive('live E2E — #957 no agent-role skill stubs', () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${eng.status}) — wait for spawn`);
    }
  });

  it('no managed skill is named after an agent (API view)', async () => {
    const agents = await agentIdentifiers();
    const skills = await apiJson<Array<{ name: string; managed?: boolean }>>('/opencode/skills');

    const managed = (skills ?? []).filter((s) => s.managed);
    const agentStubs = managed.filter((s) => agents.has(s.name)).map((s) => s.name);

    expect(agentStubs, `agent-role stubs in managed skills: ${agentStubs.join(', ')}`).toEqual([]);

    // Materialization still works: real managed skills are present.
    expect(managed.length).toBeGreaterThan(0);
  });

  it('no managed-dir subdir is named after an agent (disk view)', async () => {
    const agents = await agentIdentifiers();
    expect(existsSync(MANAGED_DIR), `managed dir missing at ${MANAGED_DIR}`).toBe(true);

    const subdirs = readdirSync(MANAGED_DIR).filter(
      (e) => e !== 'drafts' && statSync(join(MANAGED_DIR, e)).isDirectory(),
    );
    const agentDirs = subdirs.filter((d) => agents.has(d));

    expect(agentDirs, `agent-named stub dirs on disk: ${agentDirs.join(', ')}`).toEqual([]);
    // Real skills still materialize to disk.
    expect(subdirs.length).toBeGreaterThan(0);
  });
});
