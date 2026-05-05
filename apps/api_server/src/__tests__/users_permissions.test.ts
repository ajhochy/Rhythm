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

  it('prevents non-admins from updating another user permissions', async () => {
    const member = usersRepo.create({
      name: 'Member',
      email: 'member@example.com',
    });
    const target = usersRepo.create({
      name: 'Target',
      email: 'target@example.com',
    });
    let forwardedError: unknown;

    await controller.update(
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

  it('allows any authenticated user to update their own emailNotificationsEnabled', async () => {
    const member = usersRepo.create({
      name: 'Member',
      email: 'member@example.com',
    });
    let payload: unknown;
    let forwardedError: unknown;

    await controller.updateMyPreferences(
      {
        auth: { user: member },
        body: { emailNotificationsEnabled: false },
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
      id: member.id,
      emailNotificationsEnabled: false,
    });
  });

  it('rejects missing emailNotificationsEnabled with 400', async () => {
    const member = usersRepo.create({
      name: 'Member',
      email: 'member@example.com',
    });
    let forwardedError: unknown;

    await controller.updateMyPreferences(
      {
        auth: { user: member },
        body: {},
      } as never,
      {} as never,
      (error?: unknown) => {
        forwardedError = error;
      },
    );

    expect(forwardedError).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  });

  it('rejects non-boolean emailNotificationsEnabled with 400', async () => {
    const member = usersRepo.create({
      name: 'Member',
      email: 'member@example.com',
    });
    let forwardedError: unknown;

    await controller.updateMyPreferences(
      {
        auth: { user: member },
        body: { emailNotificationsEnabled: 'yes' },
      } as never,
      {} as never,
      (error?: unknown) => {
        forwardedError = error;
      },
    );

    expect(forwardedError).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  });

  it('only updates the requesting user, not another user', async () => {
    const member = usersRepo.create({
      name: 'Member',
      email: 'member@example.com',
    });
    const other = usersRepo.create({
      name: 'Other',
      email: 'other@example.com',
    });
    let payload: unknown;
    let forwardedError: unknown;

    await controller.updateMyPreferences(
      {
        auth: { user: member },
        body: { emailNotificationsEnabled: false },
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
    expect((payload as { id: number }).id).toBe(member.id);
    // Other user is unchanged
    expect(usersRepo.findById(other.id).emailNotificationsEnabled).toBe(true);
  });

  it('allows admins to update user permissions', async () => {
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

    await controller.update(
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
