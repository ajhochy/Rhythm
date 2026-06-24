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
    expect(fetched?.confidence).toBe(0.5);
    expect(fetched?.status).toBe('active');
    expect(fetched?.source).toBe('session');
  });

  it('applies defaults when optional fields are omitted', () => {
    const created = repo.create({ title: 'Minimal skill' });
    expect(created.steps).toBeNull();
    expect(created.tags).toBeNull();
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

  it('findByTitle matches case-insensitively for dedup', () => {
    repo.create({ title: 'Send Weekly Report' });
    expect(repo.findByTitle('send weekly report')?.title).toBe('Send Weekly Report');
    expect(repo.findByTitle('SEND WEEKLY REPORT')?.title).toBe('Send Weekly Report');
    expect(repo.findByTitle('something else')).toBeNull();
  });
});
