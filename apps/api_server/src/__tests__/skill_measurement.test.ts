/**
 * #795 — skill_measurement tests (injected scorer + injected repo + injected
 * file IO, no real model / no real fork).
 *
 * Covers:
 *   - post > baseline on a managed target → KEPT, status='active', scores persisted.
 *   - post <= baseline on a managed target → REVERTED, rollback to base_version,
 *     live body byte-identical to prior, status='reverted'.
 *   - regression on an external fork → deleteManagedSkill called, shadow gone,
 *     origin_location bytes UNCHANGED before apply → after revert, status='reverted'.
 *   - scorer throws / unparseable → no-improvement → revert (fail-closed).
 *   - row stuck `measuring` at startup → reverted defensively.
 *   - a reverted revision carries the duplicate-guard marker (not re-applied).
 *   - parseScoreResponse fail-closed parsing.
 *   - under VITEST with no injected deps, crash recovery does zero work.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  measureAppliedSkill,
  recoverStuckMeasurements,
  candidateHash,
  revertedMarker,
} from '../services/skill_measurement';
import { parseScoreResponse, type ScoreCall } from '../services/skill_refiner';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Scorer that returns a fixed score per body string, looked up by exact match. */
const scorerFor = (byBody: Record<string, number>): ScoreCall => async (_purpose, body) => ({
  score: byBody[body] ?? 0,
  reason: `scored '${body.slice(0, 12)}'`,
});

/**
 * Create a managed measuring row: seed at base body (v1), revise in place to the
 * candidate body (snapshots v1 into history, bumps to v2), then attach the #794
 * sidecar fields (status='measuring', appliedForName, baseVersion=1, isExternal=0).
 */
function seedManagedMeasuring(
  repo: AgentSkillsRepository,
  opts: { name: string; baseBody: string; revisedBody: string; originLocation: string },
) {
  const created = repo.create({
    title: opts.name,
    description: `desc for ${opts.name}`,
    whenToUse: `use ${opts.name}`,
    body: opts.baseBody,
    confidence: 0.7,
    status: 'active',
  });
  // #794 apply: revise in place (v1 → v2), snapshotting the prior (v1) body.
  repo.reviseInPlace(created.id, { body: opts.revisedBody }, 'auto-applied');
  repo.update(created.id, {
    status: 'measuring',
    appliedForName: opts.name,
    baseVersion: 1,
    originLocation: opts.originLocation,
    isExternal: 0,
    measureReason: `hash:${candidateHash(opts.revisedBody)}`,
  });
  return repo.getById(created.id)!;
}

describe('skill_measurement.parseScoreResponse (fail-closed)', () => {
  it('parses a leading integer + reason', () => {
    expect(parseScoreResponse('82 clear and complete')).toEqual({ score: 82, reason: 'clear and complete' });
  });
  it('clamps to 0..100', () => {
    expect(parseScoreResponse('150 too high').score).toBe(100);
    expect(parseScoreResponse('-5 too low').score).toBe(0);
  });
  it('unparseable → 0 (fail-closed)', () => {
    expect(parseScoreResponse('no number here').score).toBe(0);
    expect(parseScoreResponse('').score).toBe(0);
  });
});

describe('skill_measurement.measureAppliedSkill', () => {
  let repo: AgentSkillsRepository;
  let managedDir: string;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
    managedDir = mkdtempSync(join(tmpdir(), 'rhythm-managed-'));
  });

  afterEach(() => {
    rmSync(managedDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('post > baseline (managed) → KEPT, active, scores persisted, no file/reload', async () => {
    const skill = seedManagedMeasuring(repo, {
      name: 'send-email',
      baseBody: 'BASE body',
      revisedBody: 'REVISED body',
      originLocation: join(managedDir, 'SKILL.md'),
    });
    const reload = vi.fn().mockResolvedValue([]);
    const write = vi.fn();
    const remove = vi.fn();

    const outcome = await measureAppliedSkill(skill, {
      repo,
      scorer: scorerFor({ 'BASE body': 40, 'REVISED body': 75 }),
      reload,
      write,
      remove,
    });

    expect(outcome).toBe('kept');
    const after = repo.getById(skill.id)!;
    expect(after.status).toBe('active');
    expect(after.baselineScore).toBe(40);
    expect(after.postScore).toBe(75);
    expect(after.version).toBe(2); // revision stays live
    expect(after.body).toBe('REVISED body');
    expect(reload).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('post <= baseline (managed) → REVERTED, rollback to base, live body == prior byte-identical', async () => {
    const skill = seedManagedMeasuring(repo, {
      name: 'send-email',
      baseBody: 'BASE body exact bytes',
      revisedBody: 'REVISED worse body',
      originLocation: join(managedDir, 'SKILL.md'),
    });
    let writtenBody: string | null = null;
    const write = vi.fn((s: { name: string; body: string }) => {
      writtenBody = s.body;
      return join(managedDir, 'send-email', 'SKILL.md');
    });
    const reload = vi.fn().mockResolvedValue([]);

    const outcome = await measureAppliedSkill(skill, {
      repo,
      scorer: scorerFor({ 'BASE body exact bytes': 70, 'REVISED worse body': 55 }),
      reload,
      write,
      remove: vi.fn(),
    });

    expect(outcome).toBe('reverted');
    const after = repo.getById(skill.id)!;
    expect(after.status).toBe('reverted');
    expect(after.baselineScore).toBe(70);
    expect(after.postScore).toBe(55);
    // rollback restored the prior (base_version=1) body byte-identical.
    expect(after.body).toBe('BASE body exact bytes');
    // live file rewritten to the prior body (byte-identical).
    expect(writtenBody).toBe('BASE body exact bytes');
    expect(reload).toHaveBeenCalledTimes(1);
    // reverted-marker keyed on the losing candidate hash → duplicate guard.
    expect(after.measureReason).toBe(revertedMarker(candidateHash('REVISED worse body')));
  });

  it('regression on external fork → deleteManagedSkill called, shadow gone, origin bytes UNCHANGED', async () => {
    // The external original file — written ONCE, must never be touched by revert.
    const originDir = mkdtempSync(join(tmpdir(), 'rhythm-external-'));
    const originLocation = join(originDir, 'SKILL.md');
    const ORIGINAL_BYTES = '---\nname: ext-skill\n---\nORIGINAL external body\n';
    writeFileSync(originLocation, ORIGINAL_BYTES, 'utf8');
    const before = readFileSync(originLocation);

    // External measuring row: a managed SHADOW was created by #794 (is_external=1).
    const created = repo.create({
      title: 'ext-skill',
      description: 'external skill',
      whenToUse: 'use ext',
      body: 'ORIGINAL external body',
      confidence: 0.7,
      status: 'active',
    });
    repo.reviseInPlace(created.id, { body: 'SHADOW revised body' }, 'auto-applied');
    repo.update(created.id, {
      status: 'measuring',
      appliedForName: 'ext-skill',
      baseVersion: 1,
      originLocation,
      isExternal: 1,
      measureReason: `hash:${candidateHash('SHADOW revised body')}`,
    });
    const skill = repo.getById(created.id)!;

    // Simulate the shadow existing in the managed dir; remove() deletes it.
    const shadowDir = join(managedDir, 'ext-skill');
    mkdirSync(shadowDir, { recursive: true });
    writeFileSync(join(shadowDir, 'SKILL.md'), 'SHADOW revised body', 'utf8');
    const remove = vi.fn((_name: string) => {
      rmSync(shadowDir, { recursive: true, force: true });
      return true;
    });
    const write = vi.fn();
    const reload = vi.fn().mockResolvedValue([]);

    const outcome = await measureAppliedSkill(skill, {
      repo,
      scorer: scorerFor({ 'ORIGINAL external body': 80, 'SHADOW revised body': 50 }),
      reload,
      write,
      remove,
    });

    expect(outcome).toBe('reverted');
    expect(remove).toHaveBeenCalledWith('ext-skill');
    expect(existsSync(shadowDir)).toBe(false); // shadow gone
    expect(write).not.toHaveBeenCalled(); // NEVER write on external revert
    expect(reload).toHaveBeenCalledTimes(1);
    // THE critical invariant: the external original file is byte-identical.
    const after = readFileSync(originLocation);
    expect(after.equals(before)).toBe(true);
    expect(readFileSync(originLocation, 'utf8')).toBe(ORIGINAL_BYTES);

    expect(repo.getById(skill.id)!.status).toBe('reverted');

    rmSync(originDir, { recursive: true, force: true });
  });

  it('scorer throws → fail-closed (post=0) → revert', async () => {
    const skill = seedManagedMeasuring(repo, {
      name: 'send-email',
      baseBody: 'BASE body',
      revisedBody: 'REVISED body',
      originLocation: join(managedDir, 'SKILL.md'),
    });
    const throwingScorer: ScoreCall = async () => {
      throw new Error('judge unavailable');
    };
    const outcome = await measureAppliedSkill(skill, {
      repo,
      scorer: throwingScorer,
      reload: vi.fn().mockResolvedValue([]),
      write: vi.fn(),
      remove: vi.fn(),
    });
    // both baseline and post are 0 → post (0) NOT > baseline (0) → revert.
    expect(outcome).toBe('reverted');
    const after = repo.getById(skill.id)!;
    expect(after.status).toBe('reverted');
    expect(after.baselineScore).toBe(0);
    expect(after.postScore).toBe(0);
    expect(after.body).toBe('BASE body'); // rolled back
  });

  it('unparseable scorer output → fail-closed revert', async () => {
    const skill = seedManagedMeasuring(repo, {
      name: 'send-email',
      baseBody: 'BASE body',
      revisedBody: 'REVISED body',
      originLocation: join(managedDir, 'SKILL.md'),
    });
    const garbageScorer: ScoreCall = async () => parseScoreResponse('totally not a number');
    const outcome = await measureAppliedSkill(skill, {
      repo,
      scorer: garbageScorer,
      reload: vi.fn().mockResolvedValue([]),
      write: vi.fn(),
      remove: vi.fn(),
    });
    expect(outcome).toBe('reverted');
    expect(repo.getById(skill.id)!.status).toBe('reverted');
  });
});

describe('skill_measurement.recoverStuckMeasurements (crash recovery, fail-closed)', () => {
  const REAL_VITEST = process.env.VITEST;
  const REAL_NODE = process.env.NODE_ENV;

  afterEach(() => {
    if (REAL_VITEST === undefined) delete process.env.VITEST;
    else process.env.VITEST = REAL_VITEST;
    if (REAL_NODE === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = REAL_NODE;
  });

  it('a row stuck measuring at startup is reverted defensively', async () => {
    setDb(makeDb());
    const repo = new AgentSkillsRepository();
    const managedDir = mkdtempSync(join(tmpdir(), 'rhythm-recover-'));
    const skill = seedManagedMeasuring(repo, {
      name: 'send-email',
      baseBody: 'BASE body',
      revisedBody: 'REVISED body',
      originLocation: join(managedDir, 'SKILL.md'),
    });
    // Lift the test guard so the real branch runs; injected IO → no side effects.
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';

    const reverted = await recoverStuckMeasurements({
      repo,
      reload: vi.fn().mockResolvedValue([]),
      write: vi.fn(),
      remove: vi.fn(),
    });

    expect(reverted).toBe(1);
    const after = repo.getById(skill.id)!;
    expect(after.status).toBe('reverted');
    expect(after.body).toBe('BASE body'); // rolled back to base_version
    expect(after.measureReason).toBe(revertedMarker(candidateHash('REVISED body')));

    rmSync(managedDir, { recursive: true, force: true });
  });

  it('under VITEST with no injected repo → zero work, no throw', async () => {
    // VITEST is set by the runner; do not inject deps → hard skip.
    const reverted = await recoverStuckMeasurements();
    expect(reverted).toBe(0);
  });
});

describe('skill_measurement — reverted duplicate-guard marker', () => {
  it('revertedMarker keys on applied_for_name + base_version + candidate hash', () => {
    // The marker itself is hash-keyed; combined with the row's applied_for_name
    // + base_version it uniquely identifies a losing revision so #794 skips it.
    const h = candidateHash('some losing body');
    expect(revertedMarker(h)).toBe(`reverted:hash:${h}`);
    expect(candidateHash('a')).not.toBe(candidateHash('b'));
  });
});
