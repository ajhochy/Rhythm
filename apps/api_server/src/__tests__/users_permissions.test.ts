import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { UsersController } from '../controllers/users_controller';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('UsersController permissions', () => {
  let controller: UsersController;
  let usersRepo: UsersRepository;

  beforeEach(() => {
    setDb(makeDb());
    controller = new UsersController();
    usersRepo = new UsersRepository();
  });

  it('prevents non-admins from updating another user permissions', () => {
    const member = usersRepo.create({
      name: 'Member',
      email: 'member@example.com',
    });
    const target = usersRepo.create({
      name: 'Target',
      email: 'target@example.com',
    });
    let forwardedError: unknown;

    controller.update(
      {
        params: { id: String(target.id) },
        body: { isFacilitiesManager: true },
        auth: { user: member },
      } as never,
      {} as never,
      (error?: unknown) => {
        forwardedError = error;
      },
    );

    expect(forwardedError).toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
    expect(usersRepo.findById(target.id).isFacilitiesManager).toBe(false);
  });

  it('allows admins to update user permissions', () => {
    const admin = usersRepo.create({
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
    });
    const target = usersRepo.create({
      name: 'Target',
      email: 'target@example.com',
    });
    let payload: unknown;
    let forwardedError: unknown;

    controller.update(
      {
        params: { id: String(target.id) },
        body: { role: 'admin', isFacilitiesManager: true },
        auth: { user: admin },
      } as never,
      {
        json(value: unknown) {
          payload = value;
          return this;
        },
      } as never,
      (error?: unknown) => {
        forwardedError = error;
      },
    );

    expect(forwardedError).toBeUndefined();
    expect(payload).toMatchObject({
      id: target.id,
      role: 'admin',
      isFacilitiesManager: true,
    });
  });
});
