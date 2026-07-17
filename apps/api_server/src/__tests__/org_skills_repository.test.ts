/**
 * #1053 (OCU-12) — OrgSkillsRepository unit tests.
 *
 * Covers the SQLite path directly (Postgres path is exercised by the live
 * RHYTHM_LIVE_E2E Postgres run — see docs/ai/runs/ for that evidence; a real
 * Postgres connection isn't available in the unit-test sandbox).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { OrgSkillsRepository } from '../repositories/org_skills_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('OrgSkillsRepository', () => {
  let repo: OrgSkillsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new OrgSkillsRepository();
  });

  it('upsertAsync creates a new skill retrievable by findByNameAsync', async () => {
    const created = await repo.upsertAsync('foo', {
      description: 'A test skill',
      content: '# Foo\n\nDoes foo things.',
    });

    expect(created.name).toBe('foo');
    expect(created.description).toBe('A test skill');
    expect(created.content).toBe('# Foo\n\nDoes foo things.');
    expect(created.published).toBe(true);

    const found = await repo.findByNameAsync('foo');
    expect(found).not.toBeNull();
    expect(found?.content).toBe('# Foo\n\nDoes foo things.');
  });

  it('findByNameAsync returns null for a name that does not exist', async () => {
    const found = await repo.findByNameAsync('does-not-exist');
    expect(found).toBeNull();
  });

  it('upsertAsync on an existing name updates in place rather than duplicating', async () => {
    await repo.upsertAsync('foo', { content: 'v1' });
    const updated = await repo.upsertAsync('foo', { content: 'v2', description: 'updated' });

    expect(updated.content).toBe('v2');
    expect(updated.description).toBe('updated');

    const all = await repo.listPublishedAsync();
    expect(all.filter((s) => s.name === 'foo')).toHaveLength(1);
  });

  it('upsertAsync defaults published to true when omitted, honors an explicit false', async () => {
    const defaulted = await repo.upsertAsync('published-default', { content: 'x' });
    expect(defaulted.published).toBe(true);

    const draft = await repo.upsertAsync('published-false', { content: 'x', published: false });
    expect(draft.published).toBe(false);
  });

  it('listPublishedAsync excludes published:false rows', async () => {
    await repo.upsertAsync('visible', { content: 'x', published: true });
    await repo.upsertAsync('hidden', { content: 'x', published: false });

    const listed = await repo.listPublishedAsync();
    const names = listed.map((s) => s.name);
    expect(names).toContain('visible');
    expect(names).not.toContain('hidden');
  });

  it('findPublishedByNameAsync returns null for an unpublished skill (present via findByNameAsync)', async () => {
    await repo.upsertAsync('hidden', { content: 'x', published: false });

    expect(await repo.findPublishedByNameAsync('hidden')).toBeNull();
    expect(await repo.findByNameAsync('hidden')).not.toBeNull();
  });

  it('deleteAsync removes a row and reports whether one was actually deleted', async () => {
    await repo.upsertAsync('to-delete', { content: 'x' });

    expect(await repo.deleteAsync('to-delete')).toBe(true);
    expect(await repo.findByNameAsync('to-delete')).toBeNull();
    // Second delete of the same (now-gone) name reports no row deleted.
    expect(await repo.deleteAsync('to-delete')).toBe(false);
  });
});
