/**
 * #845 (tokens-05) — skill-effectiveness dashboard contract tests.
 *
 * The Skills UI (#813) already shows lifecycle pills but not the LLM-judge
 * measurement ledger's `measureReason` — the one-sentence rationale that
 * distinguishes a "kept" measurement (post > baseline) from a "reverted" one
 * (revert marker). `?withMetadata=true` already returns baselineScore /
 * postScore / uses (the score + usage columns), but `measureReason` is
 * dropped by the route's join even though the sidecar row carries it
 * (agent_skills.measure_reason). This test proves the CONTRACT: extending the
 * join to include `measureReason` so the Flutter expansion area can render
 * measurement history (baseline vs post score, revert events) without a new
 * table/migration.
 *
 * CONTRACT TEST — must fail before implementation (measureReason absent from
 * the metadata payload), and pass once opencode_skills_routes.ts's
 * SkillMetadata / DEFAULT_METADATA / join include it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { startTestServer } from './helpers/real_server';

const MANAGED_DIR = mkdtempSync(join(tmpdir(), 'rhythm-managed-skills-845-'));
process.env.RHYTHM_MANAGED_SKILLS_DIR = MANAGED_DIR;

const reloadSkills = vi.fn().mockResolvedValue([]);
const listSkills = vi.fn();

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listSkills: (...args: unknown[]) => listSkills(...args),
    reloadSkills: (...args: unknown[]) => reloadSkills(...args),
  },
  opencodeSessionMap: new Map(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('issue-845: skill-effectiveness dashboard — measureReason surfaced', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let db: Database.Database;

  beforeEach(async () => {
    db = makeDb();
    setDb(db);
    const { createApp } = await import('../app');
    const started = await startTestServer(createApp());
    baseUrl = started.baseUrl;
    close = started.close;
  });

  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  it('issue-845-c1: ?withMetadata=true includes measureReason (baseline/post narrative) when a sidecar row has one', async () => {
    const loc = join(MANAGED_DIR, 'measured-skill', 'SKILL.md');
    listSkills.mockResolvedValue([
      { name: 'measured-skill', description: 'A measured skill', location: loc },
    ]);
    const repo = new AgentSkillsRepository(db);
    repo.create({
      title: 'measured-skill',
      confidence: 0.7,
      status: 'active',
      source: 'auto-refined',
      uses: 12,
      isExternal: 0,
      baselineScore: 60,
      postScore: 82,
      measureReason: 'baseline=60 (ok); post=82 (better); decision=keep',
    });

    const res = await fetch(`${baseUrl}/opencode/skills?withMetadata=true`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      name: string;
      metadata: Record<string, unknown>;
    }>;
    const entry = body.find((s) => s.name === 'measured-skill')!;
    expect(entry.metadata.measureReason).toBe(
      'baseline=60 (ok); post=82 (better); decision=keep',
    );
    // Score + usage fields the dashboard also renders — already present, no
    // regression check that they are still passed through unchanged.
    expect(entry.metadata.baselineScore).toBe(60);
    expect(entry.metadata.postScore).toBe(82);
    expect(entry.metadata.uses).toBe(12);
  });

  it('issue-845-c2: a revert-event marker (revertedMarker shape) is surfaced verbatim in measureReason', async () => {
    const loc = join(MANAGED_DIR, 'reverted-skill', 'SKILL.md');
    listSkills.mockResolvedValue([
      { name: 'reverted-skill', description: 'A reverted skill', location: loc },
    ]);
    const repo = new AgentSkillsRepository(db);
    repo.create({
      title: 'reverted-skill',
      confidence: 0.4,
      status: 'reverted',
      source: 'auto-refined',
      uses: 3,
      isExternal: 0,
      baselineScore: 70,
      postScore: 55,
      measureReason: 'reverted:hash:abc123',
    });

    const res = await fetch(`${baseUrl}/opencode/skills?withMetadata=true`);
    const body = (await res.json()) as Array<{
      name: string;
      metadata: Record<string, unknown>;
    }>;
    const entry = body.find((s) => s.name === 'reverted-skill')!;
    expect(entry.metadata.measureReason).toBe('reverted:hash:abc123');
    expect(entry.metadata.status).toBe('reverted');
  });

  it('issue-845-c3: a skill with NO sidecar row defaults measureReason to null (falsifies naive non-null default)', async () => {
    const loc = join(MANAGED_DIR, 'unmeasured-skill', 'SKILL.md');
    listSkills.mockResolvedValue([
      { name: 'unmeasured-skill', description: 'Never measured', location: loc },
    ]);
    // No repo.create() call — this skill has no sidecar row at all.

    const res = await fetch(`${baseUrl}/opencode/skills?withMetadata=true`);
    const body = (await res.json()) as Array<{
      name: string;
      metadata: Record<string, unknown>;
    }>;
    const entry = body.find((s) => s.name === 'unmeasured-skill')!;
    expect(entry.metadata.measureReason).toBeNull();
  });
});
