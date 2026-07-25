import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

describe('#1172 agent activity HTTP routes', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let bearer: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    const user = new UsersRepository().create({
      name: 'Activity User',
      email: `activity-${randomUUID()}@example.com`,
    });
    const session = await new SessionsRepository().createAsync(user.id);
    bearer = session.token;
    db.prepare(`
      INSERT INTO agent_research_jobs
        (id, query, status, sources_json, report, error,
         requested_by_user_id, created_at, updated_at)
      VALUES (?, ?, 'done', '[]', ?, NULL, ?, ?, ?)
    `).run(
      'route-research',
      'Route behavior',
      'Verified through HTTP',
      user.id,
      '2026-07-25T09:00:00.000Z',
      '2026-07-25T09:01:00.000Z',
    );
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
  });

  it('returns canonical pages and rejects malformed filters', async () => {
    const response = await fetch(`${baseUrl}/agent-activity?limit=1`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [
        {
          id: 'research:route-research',
          source: 'research',
          status: 'completed',
        },
      ],
      nextCursor: null,
    });

    const invalid = await fetch(
      `${baseUrl}/agent-activity?source=not-a-source`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('requires a live paired-device credential on the mobile gateway route', async () => {
    const unauthenticated = await fetch(
      `${baseUrl}/mobile-gateway/agent-activity`,
    );
    expect(unauthenticated.status).toBe(401);

    const code = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(code.status).toBe(201);
    const { pairingCode } = (await code.json()) as { pairingCode: string };
    const paired = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pairingCode,
        deviceName: 'Activity iPhone',
      }),
    });
    expect(paired.status).toBe(201);
    const { deviceToken } = (await paired.json()) as { deviceToken: string };

    const activity = await fetch(
      `${baseUrl}/mobile-gateway/agent-activity?source=research`,
      { headers: { Authorization: `Device ${deviceToken}` } },
    );
    expect(activity.status).toBe(200);
    expect(await activity.json()).toMatchObject({
      items: [{ id: 'research:route-research' }],
    });
  });
});
