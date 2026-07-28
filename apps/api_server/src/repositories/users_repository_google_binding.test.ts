import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { UsersRepository } from './users_repository';

describe('UsersRepository immutable Google bindings', () => {
  let db: Database.Database;
  let users: UsersRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    users = new UsersRepository();
  });

  it('atomically binds an invited email only while google_sub is NULL', async () => {
    const invited = users.create({ name: 'Invited', email: 'invite@example.com' });
    const bound = await users.bindGoogleIdentityByEmailAsync(
      'INVITE@example.com',
      'google-first',
    );
    expect(bound).toMatchObject({ id: invited.id, googleSub: 'google-first' });
  });

  it('rejects a different subject for an already-bound email', async () => {
    users.create({
      name: 'Bound',
      email: 'bound@example.com',
      googleSub: 'google-original',
    });
    await expect(
      users.upsertGoogleUserAsync({
        name: 'Attacker',
        email: 'bound@example.com',
        googleSub: 'google-other',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(users.findByEmail('bound@example.com')?.googleSub).toBe(
      'google-original',
    );
  });

  it('does not move an existing subject to a different email', async () => {
    users.create({
      name: 'Bound',
      email: 'original@example.com',
      googleSub: 'google-original',
    });
    await expect(
      users.upsertGoogleUserAsync({
        name: 'Changed',
        email: 'other@example.com',
        googleSub: 'google-original',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(users.findByGoogleSub('google-original')?.email).toBe(
      'original@example.com',
    );
  });

  it('allows only one winner when two subjects race to bind one email', async () => {
    users.create({ name: 'Invited', email: 'race@example.com' });
    const settled = await Promise.all([
      users.bindGoogleIdentityByEmailAsync('race@example.com', 'google-a'),
      users.bindGoogleIdentityByEmailAsync('race@example.com', 'google-b'),
    ]);
    expect(settled.filter(Boolean)).toHaveLength(1);
    expect(users.findByEmail('race@example.com')?.googleSub).toMatch(
      /^google-[ab]$/,
    );
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM users WHERE google_sub IS NOT NULL')
        .get(),
    ).toEqual({ count: 1 });
  });
});
