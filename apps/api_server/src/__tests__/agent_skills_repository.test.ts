/**
 * Unit tests for AgentSkillsRepository (SQLite).
 *
 * Each test uses an in-memory SQLite database so tests are fully isolated and
 * do not touch the filesystem. agent_skills is SHARED instance-wide — there is
 * no owner scoping to exercise here.
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

describe('AgentSkillsRepository', () => {
  let repo: AgentSkillsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
  });

  it('create → getById round-trip preserves steps/tags JSON arrays', () => {
    const created = repo.create({
      title: 'Draft a weekly email',
      whenToUse: 'When a recurring email rhythm fires',
      description: 'Compose and send the weekly staff update',
      steps: ['gather updates', 'draft email', 'send'],
      tags: ['email', 'weekly'],
      body: '# Draft a weekly email\n\nGather updates, then compose and send.',
      confidence: 0.5,
      status: 'active',
      source: 'session',
    });

    expect(created.id).toBeTruthy();
    expect(created.uses).toBe(0);

    const fetched = repo.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe('Draft a weekly email');
    expect(fetched?.whenToUse).toBe('When a recurring email rhythm fires');
    expect(fetched?.description).toBe('Compose and send the weekly staff update');
    expect(fetched?.steps).toEqual(['gather updates', 'draft email', 'send']);
    expect(fetched?.tags).toEqual(['email', 'weekly']);
    expect(fetched?.body).toBe(
      '# Draft a weekly email\n\nGather updates, then compose and send.',
    );
    expect(fetched?.confidence).toBe(0.5);
    expect(fetched?.status).toBe('active');
    expect(fetched?.source).toBe('session');
  });

  it('applies defaults when optional fields are omitted', () => {
    const created = repo.create({ title: 'Minimal skill' });
    expect(created.steps).toBeNull();
    expect(created.tags).toBeNull();
    expect(created.body).toBeNull();
    expect(created.confidence).toBe(0);
    expect(created.status).toBe('draft');
    expect(created.source).toBeNull();
    expect(created.uses).toBe(0);
  });

  it('getById returns null for an unknown id', () => {
    expect(repo.getById('does-not-exist')).toBeNull();
  });

  it('list returns [] on an empty DB', () => {
    expect(repo.list()).toEqual([]);
  });

  it('list returns all created skills', () => {
    repo.create({ title: 'Skill A' });
    repo.create({ title: 'Skill B' });
    const all = repo.list();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.title).sort()).toEqual(['Skill A', 'Skill B']);
  });

  it('update patches fields and re-serializes arrays', () => {
    const created = repo.create({ title: 'Old title', steps: ['a'] });
    const updated = repo.update(created.id, {
      title: 'New title',
      steps: ['x', 'y'],
      confidence: 0.9,
    });
    expect(updated?.title).toBe('New title');
    expect(updated?.steps).toEqual(['x', 'y']);
    expect(updated?.confidence).toBe(0.9);
  });

  it('update returns null for an unknown id', () => {
    expect(repo.update('nope', { title: 'X' })).toBeNull();
  });

  it('update can clear array fields back to null', () => {
    const created = repo.create({ title: 'Has steps', steps: ['a', 'b'] });
    const updated = repo.update(created.id, { steps: null });
    expect(updated?.steps).toBeNull();
  });

  it('update patches the body column and can clear it back to null', () => {
    const created = repo.create({ title: 'Has body', body: 'original body' });
    expect(created.body).toBe('original body');
    const patched = repo.update(created.id, { body: 'revised body' });
    expect(patched?.body).toBe('revised body');
    const cleared = repo.update(created.id, { body: null });
    expect(cleared?.body).toBeNull();
  });

  it('remove deletes a skill and returns true; false for unknown id', () => {
    const created = repo.create({ title: 'Disposable' });
    expect(repo.remove(created.id)).toBe(true);
    expect(repo.getById(created.id)).toBeNull();
    expect(repo.remove(created.id)).toBe(false);
  });

  it('incrementUses bumps the uses counter', () => {
    const created = repo.create({ title: 'Used skill' });
    expect(created.uses).toBe(0);
    repo.incrementUses(created.id);
    repo.incrementUses(created.id);
    expect(repo.getById(created.id)?.uses).toBe(2);
  });

  it('#929 — incrementUses(id) is visible via findByName(title), the Skills UI join key', () => {
    // retrieval/injection bumps uses by id (buildSkillsPreface returns AgentSkill.id);
    // the Skills UI (#792/#793) reads uses via findByName(title) joined onto the
    // live engine skill. These must be the SAME row so a harvested skill's usage
    // count actually surfaces in the UI after it is used.
    const created = repo.create({ title: 'Harvested Skill', status: 'draft', source: 'auto-extract' });
    repo.incrementUses(created.id);
    repo.incrementUses(created.id);
    expect(repo.findByName('Harvested Skill')?.uses).toBe(2);
  });

  it('findByTitle matches case-insensitively for dedup', () => {
    repo.create({ title: 'Send Weekly Report' });
    expect(repo.findByTitle('send weekly report')?.title).toBe('Send Weekly Report');
    expect(repo.findByTitle('SEND WEEKLY REPORT')?.title).toBe('Send Weekly Report');
    expect(repo.findByTitle('something else')).toBeNull();
  });

  // ── #792 sidecar metadata + measurement ledger ─────────────────────────────

  it('findByName matches on the SKILL.md frontmatter name (case-insensitive)', () => {
    repo.create({ title: 'commit-helper' });
    expect(repo.findByName('commit-helper')?.title).toBe('commit-helper');
    expect(repo.findByName('COMMIT-HELPER')?.title).toBe('commit-helper');
    expect(repo.findByName('unknown')).toBeNull();
  });

  it('defaults the #792 sidecar fields when omitted', () => {
    const created = repo.create({ title: 'Bare sidecar' });
    expect(created.appliedForName).toBeNull();
    expect(created.baseVersion).toBeNull();
    expect(created.originLocation).toBeNull();
    expect(created.isExternal).toBe(0);
    expect(created.baselineScore).toBeNull();
    expect(created.postScore).toBeNull();
    expect(created.measureReason).toBeNull();
  });

  it('round-trips the #792 sidecar metadata through create → getById', () => {
    const created = repo.create({
      title: 'auto-refined commit-helper',
      status: 'measuring',
      appliedForName: 'commit-helper',
      baseVersion: 3,
      originLocation: '/Users/x/.config/opencode/skills/commit-helper',
      isExternal: 1,
    });

    const fetched = repo.getById(created.id)!;
    expect(fetched.status).toBe('measuring');
    expect(fetched.appliedForName).toBe('commit-helper');
    expect(fetched.baseVersion).toBe(3);
    expect(fetched.originLocation).toBe(
      '/Users/x/.config/opencode/skills/commit-helper',
    );
    expect(fetched.isExternal).toBe(1);
  });

  it('records measurement scores via update and supports the reverted lifecycle', () => {
    const created = repo.create({
      title: 'measured skill',
      status: 'measuring',
      appliedForName: 'measured-skill',
      baseVersion: 1,
    });

    const measured = repo.update(created.id, {
      baselineScore: 62,
      postScore: 81,
      measureReason: 'Revised body adds explicit verification steps.',
    })!;
    expect(measured.baselineScore).toBe(62);
    expect(measured.postScore).toBe(81);
    expect(measured.measureReason).toBe(
      'Revised body adds explicit verification steps.',
    );
    expect(measured.status).toBe('measuring');

    // A regression → auto-revert flips status to 'reverted'.
    const reverted = repo.update(created.id, { status: 'reverted' })!;
    expect(reverted.status).toBe('reverted');
    // ...and the win-path flips to 'active'.
    const promoted = repo.update(created.id, { status: 'active' })!;
    expect(promoted.status).toBe('active');
  });
});
