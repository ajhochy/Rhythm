/**
 * Unify-7 — names-alignment guard (#775 invariant).
 *
 * Per-session skill scoping only works if the names stored in
 * `allowed_skills_json` are EXACTLY the fork's SKILL.md `name`s. The picker and
 * agent_profile_sync both source from `GET /opencode/skills`, so the invariant
 * reduces to: the proxy is a faithful mirror of the fork's `GET /skill` names,
 * and any stored allowlist must be a subset of that set (a dead name = a silent
 * no-match).
 *
 * The full end-to-end version runs against the real binary in
 * tools/release/smoke_skill_alignment.sh; this is the fast in-CI guard.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';

const listSkills = vi.fn();
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listSkills: (...a: unknown[]) => listSkills(...a),
    reloadSkills: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** The #775 alignment check, factored so both prod intent and this test agree. */
function allowlistAlignsWithLive(allowlist: string[], liveNames: Set<string>): {
  ok: boolean;
  dead: string[];
} {
  const dead = allowlist.filter((n) => !liveNames.has(n));
  return { ok: dead.length === 0, dead };
}

describe('skill names alignment (Unify-7 / #775)', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    const { createApp } = await import('../app');
    const started = await startTestServer(createApp());
    baseUrl = started.baseUrl;
    close = started.close;
  });
  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  it('GET /opencode/skills mirrors the fork GET /skill names exactly', async () => {
    listSkills.mockResolvedValue([
      { name: 'docx', location: '/x/docx/SKILL.md' },
      { name: 'engineering:code-review', location: '/x/ecr/SKILL.md' },
    ]);
    const res = await fetch(`${baseUrl}/opencode/skills`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(new Set(body.map((s) => s.name))).toEqual(
      new Set(['docx', 'engineering:code-review']),
    );
  });

  it('a stored allowlist of live names aligns; a dead name is flagged', async () => {
    const live = new Set(['docx', 'engineering:code-review']);
    expect(allowlistAlignsWithLive(['docx'], live).ok).toBe(true);
    const dead = allowlistAlignsWithLive(['docx', 'docx-typo'], live);
    expect(dead.ok).toBe(false);
    expect(dead.dead).toEqual(['docx-typo']);
  });
});
