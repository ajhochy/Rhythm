/**
 * Live E2E test for #957 — agent role-text must NOT be materialized as skill
 * stubs in the managed-skills dir.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Read-only: it inspects the running server's state, mutates nothing,
 * needs no cleanup.
 *
 * Run it (the gate launches the server against a FRESH empty DB with
 * RHYTHM_MANAGED_SKILLS_DIR pointed at a temp dir, so boot re-runs the skill
 * seed + #797 backfill — the exact path that used to write the agent stubs):
 *   RHYTHM_LIVE_E2E=1 RHYTHM_MANAGED_SKILLS_DIR=<temp> npx vitest run \
 *     __tests__/live_e2e_957.test.ts
 *
 * Prerequisites:
 *   - api_server running on RHYTHM_LIVE_URL (default localhost:4001) against a
 *     fresh DB, with RHYTHM_MANAGED_SKILLS_DIR set to a temp dir.
 *   - opencode engine spawned + ready (GET /opencode/health → ready).
 *
 * Detection is by PROVENANCE, not name — Rhythm has an intentional 1:1 naming
 * convention where several ids (coding-agent, planning-agent, verification-gate,
 * …) are BOTH real ~/.claude/skills AND workflow agent ids. A name match would
 * false-positive on those. So the "agent-only" set is:
 *   basenames(~/.config/opencode/agents/*.md)  MINUS  names(~/.claude/skills)
 * i.e. agents that are NOT also real skills (email-assistant, secretary,
 * config-doctor, the UUID agents, …). With the fix these NEVER enter the skill
 * store; without it every one materializes as a stub.
 *
 * What it proves (#957 acceptance):
 *   1. No agent-only id appears as a materialized skill — API view
 *      (GET /opencode/skills, managed=true) AND on-disk view (managed dir).
 *   2. Real ~/.claude/skills still materialize (managed skill set non-empty),
 *      so the fix did not break legitimate materialization.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const AGENTS_SRC = join(homedir(), '.config', 'opencode', 'agents');
const CLAUDE_SKILLS_SRC = join(homedir(), '.claude', 'skills');
const MANAGED_DIR =
  process.env.RHYTHM_MANAGED_SKILLS_DIR ??
  join(homedir(), '.config', 'opencode', 'skills'); // #947 — sole managed dir

const describeLive = LIVE ? describe : describe.skip;

/** dir names under ~/.claude/skills that contain a SKILL.md (real skills). */
function claudeSkillNames(): Set<string> {
  if (!existsSync(CLAUDE_SKILLS_SRC)) return new Set();
  return new Set(
    readdirSync(CLAUDE_SKILLS_SRC).filter((e) =>
      existsSync(join(CLAUDE_SKILLS_SRC, e, 'SKILL.md')),
    ),
  );
}

/** Agents that are NOT also real skills — the ids a #957 stub would be named after. */
function agentOnlyIds(): Set<string> {
  if (!existsSync(AGENTS_SRC)) return new Set();
  const skills = claudeSkillNames();
  const ids = readdirSync(AGENTS_SRC)
    .filter((e) => e.toLowerCase().endsWith('.md'))
    .map((e) => e.replace(/\.md$/i, ''))
    .filter((id) => !skills.has(id));
  return new Set(ids);
}

async function apiJson<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
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

  it('no agent-only id is a materialized skill (API view)', async () => {
    const agentOnly = agentOnlyIds();
    const skills = await apiJson<Array<{ name: string; managed?: boolean }>>('/opencode/skills');

    const managed = (skills ?? []).filter((s) => s.managed);
    const stubs = managed.filter((s) => agentOnly.has(s.name)).map((s) => s.name);

    expect(stubs, `agent-only ids materialized as skills: ${stubs.join(', ')}`).toEqual([]);
    // Materialization still works: real ~/.claude/skills are present.
    expect(managed.length).toBeGreaterThan(0);
  });

  it('no agent-only id is a managed-dir subdir (disk view)', () => {
    const agentOnly = agentOnlyIds();
    expect(existsSync(MANAGED_DIR), `managed dir missing at ${MANAGED_DIR}`).toBe(true);

    const subdirs = readdirSync(MANAGED_DIR).filter(
      (e) => e !== 'drafts' && statSync(join(MANAGED_DIR, e)).isDirectory(),
    );
    const stubDirs = subdirs.filter((d) => agentOnly.has(d));

    expect(stubDirs, `agent-only stub dirs on disk: ${stubDirs.join(', ')}`).toEqual([]);
    // Real skills still materialize to disk.
    expect(subdirs.length).toBeGreaterThan(0);
  });
});
