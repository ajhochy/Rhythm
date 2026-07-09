/**
 * Live E2E test for #947 — ~/.config/opencode/skills is the SOLE Rhythm-managed
 * skill source, external Claude Code / Codex skill stores are no longer scanned,
 * and Rhythm imports only agent-referenced skills (no blanket auto-pull).
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Mostly read-only against the running server; the migration section
 * operates on its own throwaway temp dirs and mutates nothing real.
 *
 * Run it (the gate launches the server against a FRESH empty DB with
 * RHYTHM_MANAGED_SKILLS_DIR pointed at a temp dir, so boot re-runs the skill
 * seed + #797 backfill against the new sole-source dir, and the engine is
 * spawned with OPENCODE_DISABLE_EXTERNAL_SKILLS=1):
 *
 *   MANAGED=$(mktemp -d)
 *   DB=$(mktemp -d)/rhythm.db
 *   # build fork + api_server first (see docs/ai/testing-guide.md), then launch:
 *   RHYTHM_MANAGED_SKILLS_DIR="$MANAGED" \
 *   RHYTHM_DB_PATH="$DB" \
 *   RHYTHM_OPENCODE_BIN_DIR=<path to built fork bin> \
 *   AGENT_LOCAL=true PORT=4001 node apps/api_server/dist/server.js &
 *   # wait for GET /opencode/health → ready, then:
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://localhost:4001 \
 *   RHYTHM_MANAGED_SKILLS_DIR="$MANAGED" \
 *     npx vitest run src/__tests__/live_e2e_947.test.ts
 *
 * What it proves (#947 acceptance):
 *   1. Sole source — every skill the fork reports as managed lives under the
 *      RHYTHM_MANAGED_SKILLS_DIR (~/.config/opencode/skills in prod), NOT the
 *      retired rhythm-managed-skills sibling.
 *   2. Agent-referenced skills appear — a workflow-chain skill (e.g. coding-agent)
 *      that exists in ~/.claude/skills is imported into the sole dir and served.
 *   3. External Claude-Code-only skills do NOT appear — a ~/.claude/skills skill
 *      that no agent references (e.g. defuddle/supabase) is neither scanned
 *      (external scan off) nor materialized (seed drops it).
 *   4. Migration is no-loss — the count of SKILL.md before == after on temp dirs.
 *   5. RESTART DOES NOT CLOBBER A REFINEMENT (#947 second pass) — populate
 *      once, hand-edit the populated file (simulating the self-improvement
 *      engine refining it in place), re-invoke population (simulating a
 *      second boot). The file must come back byte-identical to the edit and
 *      the marker must have short-circuited. Runs entirely against its own
 *      temp dirs + an isolated in-memory DB — never the real ~/.config/opencode
 *      or the real rhythm.db.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { canonicalAgentSkillNames } from '../services/agent_profile_sync';
import {
  migrateLegacyManagedSkills,
  slugForSkillName,
} from '../services/rhythm_managed_skills';
import { populateWorkflowSkillsOnce } from '../services/skill_seed_importer';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const CLAUDE_SKILLS_SRC = join(homedir(), '.claude', 'skills');
const MANAGED_DIR =
  process.env.RHYTHM_MANAGED_SKILLS_DIR ??
  join(homedir(), '.config', 'opencode', 'skills');

const describeLive = LIVE ? describe : describe.skip;

/** Names of ~/.claude/skills that contain a SKILL.md (real Claude Code skills). */
function claudeSkillNames(): Set<string> {
  if (!existsSync(CLAUDE_SKILLS_SRC)) return new Set();
  return new Set(
    readdirSync(CLAUDE_SKILLS_SRC).filter((e) =>
      existsSync(join(CLAUDE_SKILLS_SRC, e, 'SKILL.md')),
    ),
  );
}

async function apiJson<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

interface LiveSkill {
  name: string;
  location: string;
  managed?: boolean;
}

describeLive('live E2E — #947 sole skill source', () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${eng.status}) — wait for spawn`);
    }
  });

  it('every managed skill lives under the sole managed dir (not rhythm-managed-skills)', async () => {
    const skills = await apiJson<LiveSkill[]>('/opencode/skills');
    const managed = (skills ?? []).filter((s) => s.managed);
    expect(managed.length).toBeGreaterThan(0);

    const straddlers = managed.filter((s) => !s.location.startsWith(MANAGED_DIR));
    expect(
      straddlers.map((s) => `${s.name}@${s.location}`),
      `managed skills not under ${MANAGED_DIR}`,
    ).toEqual([]);

    // Nothing is served out of the retired sibling dir.
    const legacy = (skills ?? []).filter((s) => s.location.includes('rhythm-managed-skills'));
    expect(legacy.map((s) => s.name), 'skills still served from rhythm-managed-skills').toEqual([]);
  });

  it('an agent-referenced ~/.claude/skills skill IS served from the sole dir', async () => {
    const referenced = canonicalAgentSkillNames();
    const claude = claudeSkillNames();
    // Prefer coding-agent; else any referenced skill that exists in ~/.claude/skills.
    const target =
      referenced.has('coding-agent') && claude.has('coding-agent')
        ? 'coding-agent'
        : [...referenced].find((n) => claude.has(n));
    if (!target) return; // no referenced skill present on this machine — nothing to assert

    const skills = await apiJson<LiveSkill[]>('/opencode/skills');
    const hit = (skills ?? []).find((s) => s.name === target);
    expect(hit, `agent-referenced skill "${target}" missing from the served set`).toBeTruthy();
    expect(hit!.location.startsWith(MANAGED_DIR)).toBe(true);
  });

  it('a Claude-Code-only skill that NO agent references does NOT appear', async () => {
    const referenced = canonicalAgentSkillNames();
    const claudeOnlyUnreferenced = [...claudeSkillNames()].filter((n) => !referenced.has(n));
    if (claudeOnlyUnreferenced.length === 0) return; // nothing unreferenced to assert

    const skills = await apiJson<LiveSkill[]>('/opencode/skills');
    const served = new Set((skills ?? []).map((s) => s.name));
    const leaked = claudeOnlyUnreferenced.filter((n) => served.has(n));
    expect(
      leaked,
      `unreferenced Claude Code skills leaked into the picker (external scan should be off + seed should skip): ${leaked.join(', ')}`,
    ).toEqual([]);
  });

  it('migration is no-loss — SKILL.md count before == after (temp dirs)', () => {
    const legacy = mkdtempSync(join(tmpdir(), 'rhythm-947-live-legacy-'));
    const sole = mkdtempSync(join(tmpdir(), 'rhythm-947-live-sole-'));
    try {
      const names = ['alpha', 'beta', 'gamma'];
      for (const n of names) {
        mkdirSync(join(legacy, n), { recursive: true });
        writeFileSync(join(legacy, n, 'SKILL.md'), `---\nname: ${n}\n---\nbody\n`);
      }
      const before = names.length;

      const r = migrateLegacyManagedSkills(legacy, sole);

      const after = names.filter((n) => existsSync(join(sole, n, 'SKILL.md'))).length;
      expect(r.lossless).toBe(true);
      expect(after).toBe(before);
      expect(r.moved).toBe(before);
    } finally {
      rmSync(legacy, { recursive: true, force: true });
      rmSync(sole, { recursive: true, force: true });
    }
  });

  it('a simulated restart does NOT clobber a refined managed skill file (#947 second pass)', () => {
    // Entirely self-contained: its own temp ~/.claude/skills-shaped source dir,
    // its own temp managed dir, its own in-memory DB for the durable marker.
    // Never touches the real ~/.config/opencode or the real rhythm.db.
    const claudeSrc = mkdtempSync(join(tmpdir(), 'rhythm-947-restart-claude-'));
    const managed = mkdtempSync(join(tmpdir(), 'rhythm-947-restart-managed-'));
    const priorManagedEnv = process.env.RHYTHM_MANAGED_SKILLS_DIR;
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      setDb(db);
      process.env.RHYTHM_MANAGED_SKILLS_DIR = managed;

      mkdirSync(join(claudeSrc, 'coding-agent'), { recursive: true });
      writeFileSync(
        join(claudeSrc, 'coding-agent', 'SKILL.md'),
        '---\nname: coding-agent\ndescription: Implements one focused request.\n---\nOriginal body.\n',
      );

      // "First boot" — populates the file.
      const first = populateWorkflowSkillsOnce({ claudeSkillsDir: claudeSrc });
      expect(first.alreadyDone).toBe(false);
      expect(first.copied).toBe(1);

      const destFile = join(managed, slugForSkillName('coding-agent'), 'SKILL.md');
      expect(existsSync(destFile)).toBe(true);

      // Simulate the self-improvement engine refining the skill in place —
      // this is the exact state a restart must never overwrite.
      const refined = '---\nname: coding-agent\n---\nREFINED BY SELF-IMPROVEMENT — must survive a restart.\n';
      writeFileSync(destFile, refined);

      // "Second boot" — simulated restart, same source dir, same managed dir,
      // same DB (the marker persisted).
      const second = populateWorkflowSkillsOnce({ claudeSkillsDir: claudeSrc });
      expect(second.alreadyDone).toBe(true);
      expect(second.copied).toBe(0);

      // The refinement is untouched — byte-identical to what was written above.
      expect(readFileSync(destFile, 'utf8')).toBe(refined);
    } finally {
      rmSync(claudeSrc, { recursive: true, force: true });
      rmSync(managed, { recursive: true, force: true });
      if (priorManagedEnv === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
      else process.env.RHYTHM_MANAGED_SKILLS_DIR = priorManagedEnv;
      db.close();
    }
  });
});
