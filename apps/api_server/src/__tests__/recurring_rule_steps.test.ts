import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

describe('POST /recurring-rules/:id/steps', () => {
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
    sessionsRepo = new SessionsRepository();

    const server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  afterEach(async () => {
    await closeServer();
  });

  async function authHeaderFor(userId: number) {
    const session = await sessionsRepo.createAsync(userId);
    return { Authorization: `Bearer ${session.token}` };
  }

  async function createWeeklyRule(headers: Record<string, string>) {
    const response = await fetch(`${baseUrl}/recurring-rules`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Weekly Rhythm',
        frequency: 'weekly',
        dayOfWeek: 0,
        steps: [],
      }),
    });
    expect(response.status).toBe(201);
    return (await readJson(response)) as { id: string };
  }

  it('creates a step with a string day_of_week (snake_case)', async () => {
    const owner = usersRepo.create({ name: 'Owner', email: 'owner1@example.com' });
    const headers = await authHeaderFor(owner.id);
    const rule = await createWeeklyRule(headers);

    const response = await fetch(`${baseUrl}/recurring-rules/${rule.id}/steps`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Plan upcoming Sunday',
        day_of_week: 'Monday',
        sort_order: 0,
      }),
    });
    expect(response.status).toBe(201);
    const step = (await readJson(response)) as { title: string; dayOfWeek: number };
    expect(step.title).toBe('Plan upcoming Sunday');
    expect(step.dayOfWeek).toBe(1);
  });

  it('creates a step with an integer dayOfWeek (camelCase)', async () => {
    const owner = usersRepo.create({ name: 'Owner', email: 'owner2@example.com' });
    const headers = await authHeaderFor(owner.id);
    const rule = await createWeeklyRule(headers);

    const response = await fetch(`${baseUrl}/recurring-rules/${rule.id}/steps`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Mid-week prep',
        dayOfWeek: 3,
      }),
    });
    expect(response.status).toBe(201);
    const step = (await readJson(response)) as { title: string; dayOfWeek: number };
    expect(step.title).toBe('Mid-week prep');
    expect(step.dayOfWeek).toBe(3);
  });

  it('returns 400 when day_of_week is missing on a weekly rhythm', async () => {
    const owner = usersRepo.create({ name: 'Owner', email: 'owner3@example.com' });
    const headers = await authHeaderFor(owner.id);
    const rule = await createWeeklyRule(headers);

    const response = await fetch(`${baseUrl}/recurring-rules/${rule.id}/steps`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No day' }),
    });
    expect(response.status).toBe(400);
    const body = (await readJson(response)) as { error?: { message?: string }; message?: string };
    const message = body?.error?.message ?? body?.message ?? '';
    expect(message.toLowerCase()).toContain('dayofweek');
  });

  it('returns 404 for an unknown rhythm id', async () => {
    const owner = usersRepo.create({ name: 'Owner', email: 'owner4@example.com' });
    const headers = await authHeaderFor(owner.id);

    const response = await fetch(`${baseUrl}/recurring-rules/does-not-exist/steps`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Plan', dayOfWeek: 1 }),
    });
    expect(response.status).toBe(404);
  });
});
