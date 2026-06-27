/**
 * P5-1 — version history + in-place revision tests for AgentSkillsRepository.
 *
 * Covers reviseInPlace / listVersions / rollback over an in-memory SQLite DB:
 *  - revise snapshots the CURRENT row into agent_skill_versions, then UPDATEs
 *    the live row with new content and version+1.
 *  - listVersions returns the recorded snapshots (newest first).
 *  - rollback snapshots current, restores a chosen prior version as the new
 *    current (version bumped again), and is itself recorded as a version.
 *  - nothing is ever hard-deleted from agent_skill_versions.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('AgentSkillsRepository — version history (P5-1)', () => {
  let repo: AgentSkillsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
  });

  it('new skills start at version 1', () => {
    const s = repo.create({ title: 'Compose weekly email', confidence: 0.5 });
    expect(s.version).toBe(1);
  });

  it('reviseInPlace bumps version, writes history, and applies new content', () => {
    const original = repo.create({
      title: 'Compose weekly email',
      description: 'old description',
      confidence: 0.5,
      status: 'published',
      source: 'agent-stack-seed',
    });

    const revised = repo.reviseInPlace(
      original.id,
      { title: 'Compose weekly email', description: 'better description', confidence: 0.8 },
      'auto-refined',
    );

    expect(revised).not.toBeNull();
    expect(revised!.version).toBe(2);
    expect(revised!.description).toBe('better description');
    expect(revised!.confidence).toBe(0.8);
    // status is preserved (revision only changes content, not lifecycle).
    expect(revised!.status).toBe('published');
    expect(revised!.source).toBe('auto-refined');

    // History has exactly one snapshot — the ORIGINAL (version 1) content.
    const versions = repo.listVersions(original.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNo).toBe(1);
    expect(versions[0].description).toBe('old description');
    expect(versions[0].source).toBe('agent-stack-seed');
  });

  it('two revisions accumulate two history rows', () => {
    const s = repo.create({ title: 'T', description: 'v1', confidence: 0.5 });
    repo.reviseInPlace(s.id, { description: 'v2', confidence: 0.6 }, 'auto-refined');
    const r3 = repo.reviseInPlace(s.id, { description: 'v3', confidence: 0.7 }, 'auto-refined');

    expect(r3!.version).toBe(3);
    expect(r3!.description).toBe('v3');

    const versions = repo.listVersions(s.id);
    expect(versions.map((v) => v.versionNo)).toEqual([2, 1]); // newest first
    expect(versions.find((v) => v.versionNo === 1)!.description).toBe('v1');
    expect(versions.find((v) => v.versionNo === 2)!.description).toBe('v2');
  });

  it('reviseInPlace returns null for an unknown id and writes nothing', () => {
    const result = repo.reviseInPlace('does-not-exist', { description: 'x' }, 'auto-refined');
    expect(result).toBeNull();
    expect(repo.listVersions('does-not-exist')).toEqual([]);
  });

  it('rollback restores a prior version as the new current and is itself versioned', () => {
    const s = repo.create({ title: 'T', description: 'v1', confidence: 0.5 });
    repo.reviseInPlace(s.id, { description: 'v2', confidence: 0.8 }, 'auto-refined'); // version 2

    // Roll back to version 1 content.
    const rolled = repo.rollback(s.id, 1);
    expect(rolled).not.toBeNull();
    // version keeps climbing — rollback is non-destructive.
    expect(rolled!.version).toBe(3);
    expect(rolled!.description).toBe('v1');
    expect(rolled!.confidence).toBe(0.5);

    // History now has BOTH the original v1 snapshot AND the v2 snapshot taken
    // when rollback ran (nothing deleted).
    const versions = repo.listVersions(s.id);
    expect(versions.map((v) => v.versionNo).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(versions.find((v) => v.versionNo === 2)!.description).toBe('v2');
  });

  it('rollback to an unknown version number returns null and changes nothing', () => {
    const s = repo.create({ title: 'T', description: 'v1', confidence: 0.5 });
    const before = repo.getById(s.id)!;
    const result = repo.rollback(s.id, 99);
    expect(result).toBeNull();
    const after = repo.getById(s.id)!;
    expect(after.version).toBe(before.version);
    expect(after.description).toBe('v1');
  });

  it('listVersions returns [] for a skill with no history', () => {
    const s = repo.create({ title: 'T', confidence: 0.5 });
    expect(repo.listVersions(s.id)).toEqual([]);
  });

  it('round-trips steps/tags JSON arrays through history snapshots', () => {
    const s = repo.create({
      title: 'T',
      steps: ['a', 'b'],
      tags: ['x'],
      confidence: 0.5,
    });
    repo.reviseInPlace(s.id, { steps: ['c'], tags: ['y', 'z'] }, 'auto-refined');

    const v1 = repo.listVersions(s.id)[0];
    expect(v1.steps).toEqual(['a', 'b']);
    expect(v1.tags).toEqual(['x']);

    const current = repo.getById(s.id)!;
    expect(current.steps).toEqual(['c']);
    expect(current.tags).toEqual(['y', 'z']);
  });
});
