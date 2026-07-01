/**
 * #797 (skill-unify2-06) — one-time, idempotent backfill of legacy `agent_skills`
 * rows onto the unified model.
 *
 * Exercises the REAL backfill against a real in-memory DB (so the schema_meta
 * run-once marker + the repo + the materializer's file write are all real). Only
 * the engine reload is faked (opencode_engine mock) and the live-set reader is
 * injected so the test controls which names already have a discoverable file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentSkillsRepository } from '../../repositories/agent_skills_repository';
import { slugForSkillName } from '../rhythm_managed_skills';

// materializeSkill calls opencodeClient.reloadSkills(); fake it so no real engine
// is needed. The file WRITE (writeManagedSkill) still hits the temp managed dir.
const reloadSkills = vi.fn().mockResolvedValue([]);
vi.mock('../opencode_engine', () => ({
  opencodeClient: { reloadSkills: (...a: unknown[]) => reloadSkills(...a) },
  opencodeSessionMap: new Map(),
}));

import {
  backfillSkillMetadata,
  BACKFILL_MARKER,
  type LiveEngineSkill,
} from '../skill_metadata_backfill';

let MANAGED_DIR: string;
let db: Database.Database;
let repo: AgentSkillsRepository;

function managedSkillPath(name: string): string {
  return join(MANAGED_DIR, slugForSkillName(name), 'SKILL.md');
}

beforeEach(() => {
  MANAGED_DIR = mkdtempSync(join(tmpdir(), 'rhythm-backfill-'));
  process.env.RHYTHM_MANAGED_SKILLS_DIR = MANAGED_DIR;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  repo = new AgentSkillsRepository(db);
  reloadSkills.mockClear();
});

afterEach(() => {
  rmSync(MANAGED_DIR, { recursive: true, force: true });
  delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
  db.close();
});

const liveSet = (...names: string[]): (() => Promise<LiveEngineSkill[]>) => {
  return async () =>
    names.map((n) => ({ name: n, location: managedSkillPath(n) }));
};

describe('backfillSkillMetadata (#797)', () => {
  it('published row matching an existing engine skill → joined, no dup file, no dup row, status active', async () => {
    // Row predates the sidecar model and is already published; a managed file
    // already exists for its name (simulated via the live set). Must NOT
    // re-materialize a second file, must NOT create a second row.
    const created = repo.create({
      title: 'Deploy Checklist',
      body: '# Deploy\n\nPrior body.',
      status: 'published',
      source: 'agent-stack-seed',
      confidence: 1,
    });

    const r = await backfillSkillMetadata({
      repo,
      listSkills: liveSet('Deploy Checklist'),
    });

    expect(r.publishedReconciled).toBe(1);
    expect(r.publishedMaterialized).toBe(0); // file already existed → join only
    // No file written by the backfill (live set claimed it exists).
    expect(existsSync(managedSkillPath('Deploy Checklist'))).toBe(false);
    // Exactly one row, normalized to active, same id (no duplicate).
    const rows = repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].status).toBe('active');
  });

  it('published row with NO existing file → materialized once + status active', async () => {
    repo.create({
      title: 'Orphan Skill',
      body: '# Orphan\n\nNeeds a file.',
      status: 'published',
      source: 'agent-stack-seed',
      confidence: 1,
    });

    const r = await backfillSkillMetadata({
      repo,
      listSkills: liveSet(), // empty live set → no file exists yet
    });

    expect(r.publishedReconciled).toBe(1);
    expect(r.publishedMaterialized).toBe(1);
    expect(existsSync(managedSkillPath('Orphan Skill'))).toBe(true);
    expect(repo.list()[0].status).toBe('active');
    expect(reloadSkills).toHaveBeenCalledTimes(1);
  });

  it('legacy draft (never-materialized) row → carried over as status=active, file absent', async () => {
    repo.create({
      title: 'Half Baked',
      body: '# WIP',
      status: 'draft',
      source: 'extractor',
      confidence: 0.4,
    });

    const r = await backfillSkillMetadata({
      repo,
      listSkills: liveSet(),
    });

    expect(r.draftCarriedOver).toBe(1);
    expect(r.publishedMaterialized).toBe(0);
    // Carried over, NOT materialized — the unified read shows it file-absent.
    expect(existsSync(managedSkillPath('Half Baked'))).toBe(false);
    expect(repo.list()[0].status).toBe('active');
  });

  it('collision: published row whose title equals an existing engine skill name → joined, never duplicated', async () => {
    // "research" is an external engine skill (case differs); the published row's
    // title collides with it. Must JOIN (status→active), never write a 2nd file.
    repo.create({
      title: 'research',
      body: '# Research',
      status: 'published',
      source: 'agent-stack-seed',
      confidence: 1,
    });

    const r = await backfillSkillMetadata({
      repo,
      // live name differs only by case — the join key is NOCASE.
      listSkills: liveSet('Research'),
    });

    expect(r.publishedReconciled).toBe(1);
    expect(r.publishedMaterialized).toBe(0);
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0].status).toBe('active');
  });

  it('re-running the backfill is a no-op (no double materialization, no duplicate rows, identical state)', async () => {
    repo.create({
      title: 'Orphan Skill',
      body: '# Orphan',
      status: 'published',
      source: 'agent-stack-seed',
      confidence: 1,
    });
    repo.create({
      title: 'Half Baked',
      body: '# WIP',
      status: 'draft',
      source: 'extractor',
      confidence: 0.4,
    });

    const first = await backfillSkillMetadata({ repo, listSkills: liveSet() });
    expect(first.alreadyDone).toBe(false);
    expect(first.publishedMaterialized).toBe(1);

    const stateAfterFirst = repo
      .list()
      .map((s) => ({ id: s.id, status: s.status, version: s.version }))
      .sort((a, b) => a.id.localeCompare(b.id));
    reloadSkills.mockClear();

    // Second run: marker present → short-circuits, touches nothing.
    const second = await backfillSkillMetadata({ repo, listSkills: liveSet() });
    expect(second.alreadyDone).toBe(true);
    expect(second.publishedReconciled).toBe(0);
    expect(second.draftCarriedOver).toBe(0);
    expect(reloadSkills).not.toHaveBeenCalled();

    const stateAfterSecond = repo
      .list()
      .map((s) => ({ id: s.id, status: s.status, version: s.version }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(stateAfterSecond).toEqual(stateAfterFirst);

    // The run-once marker is recorded.
    const marker = db
      .prepare(`SELECT key FROM schema_meta WHERE key = ?`)
      .get(BACKFILL_MARKER);
    expect(marker).toBeDefined();
  });

  it('no row is deleted and agent_skill_versions history is preserved', async () => {
    const managed = repo.create({
      title: 'Managed Thing',
      body: '# v1',
      status: 'published',
      source: 'agent-stack-seed',
      confidence: 1,
    });
    // Give it a revision so there is real version history to preserve.
    repo.reviseInPlace(managed.id, { body: '# v2' }, 'teacher-refined');
    const historyBefore = repo.listVersions(managed.id).length;
    expect(historyBefore).toBeGreaterThan(0);

    await backfillSkillMetadata({ repo, listSkills: liveSet('Managed Thing') });

    // Row still present (not deleted), and its version history is intact.
    expect(repo.getById(managed.id)).not.toBeNull();
    expect(repo.listVersions(managed.id).length).toBe(historyBefore);
  });

  it('lifecycle-only rows (active/measuring/reverted) are left untouched', async () => {
    repo.create({ title: 'Already Active', body: '# a', status: 'active', confidence: 0.8 });
    repo.create({ title: 'Measuring', body: '# m', status: 'measuring', confidence: 0.8 });
    repo.create({ title: 'Reverted', body: '# r', status: 'reverted', confidence: 0.8 });

    const r = await backfillSkillMetadata({ repo, listSkills: liveSet() });

    expect(r.skipped).toBe(3);
    expect(r.publishedReconciled).toBe(0);
    expect(r.draftCarriedOver).toBe(0);
    const statuses = repo.list().map((s) => s.status).sort();
    expect(statuses).toEqual(['active', 'measuring', 'reverted']);
  });
});
