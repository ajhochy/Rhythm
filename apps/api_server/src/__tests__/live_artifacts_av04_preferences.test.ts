import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

describe('AV-04 authenticated artifact-tab preferences', () => {
  let db: Database.Database;
  let users: UsersRepository;
  let sessions: SessionsRepository;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    users = new UsersRepository();
    sessions = new SessionsRepository();
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
    db.close();
  });

  async function headers(userId: number) {
    const session = await sessions.createAsync(userId);
    return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
  }

  it('round-trips each signed-in user ordered artifact tabs without overwriting other preferences', async () => {
    // Regression: a preference PATCH drops artifact tabs, leaks another user's tabs,
    // or resets an unrelated preference.
    const first = users.create({ name: 'First', email: 'av04-first@example.com' });
    const second = users.create({ name: 'Second', email: 'av04-second@example.com' });
    const firstTabs = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
    const secondTabs = ['00000000-0000-4000-8000-000000000003'];

    const firstResponse = await fetch(`${baseUrl}/users/me/preferences`, {
      method: 'PATCH', headers: await headers(first.id),
      body: JSON.stringify({ artifactTabIds: firstTabs, emailNotificationsEnabled: false }),
    });
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toMatchObject({
      id: first.id,
      artifactTabIds: firstTabs,
      emailNotificationsEnabled: false,
    });

    const secondResponse = await fetch(`${baseUrl}/users/me/preferences`, {
      method: 'PATCH', headers: await headers(second.id),
      body: JSON.stringify({ artifactTabIds: secondTabs }),
    });
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toMatchObject({ id: second.id, artifactTabIds: secondTabs });
    expect(users.findById(first.id)).toMatchObject({ artifactTabIds: firstTabs, emailNotificationsEnabled: false });
    expect(users.findById(second.id)).toMatchObject({ artifactTabIds: secondTabs });
  });

  it('rejects malformed, duplicate, and excessive artifact tab preference IDs', async () => {
    const user = users.create({ name: 'Validation', email: 'av04-validation@example.com' });
    const auth = await headers(user.id);
    const invalid = [
      { artifactTabIds: 'not-an-array' },
      { artifactTabIds: [123] },
      { artifactTabIds: ['not-a-uuid'] },
      { artifactTabIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'] },
      { artifactTabIds: Array.from({ length: 51 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`) },
    ];
    for (const body of invalid) {
      const response = await fetch(`${baseUrl}/users/me/preferences`, {
        method: 'PATCH', headers: auth, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });
});
