import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import { createApp } from '../app';
import { startTestServer } from './helpers/real_server';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentWebhookEndpointsRepository } from '../repositories/agent_webhook_endpoints_repository';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';

/**
 * MSP-007 parity-gate finding: research list/get matched the owner EXACTLY,
 * so unowned legacy rows (requested_by_user_id NULL — every job created by
 * the tokenless desktop) were invisible to authenticated callers such as the
 * mobile gateway. Locks in the shared owner-visibility rule used by agent
 * memory: unowned rows are visible to everyone; owned rows only to their
 * owner (plus tokenless local callers, which predate ownership stamping).
 */
describe('agent research owner visibility', () => {
  let db: Database.Database;
  let baseUrl: string;
  let close: () => Promise<void>;
  let authHeaders: Record<string, string>;
  let userId: number;
  let strangerHeaders: Record<string, string>;

  const insertJob = (owner: number | null): string => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO agent_research_jobs
         (id, query, research_type, status, requested_by_user_id, created_at, updated_at)
       VALUES (?, ?, 'generic', 'done', ?, datetime('now'), datetime('now'))`,
    ).run(id, `query ${id}`, owner);
    return id;
  };

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const users = new UsersRepository();
    const sessions = new SessionsRepository();
    const user = users.create({ name: 'Owner', email: 'owner@example.com' });
    userId = user.id;
    authHeaders = {
      Authorization: `Bearer ${(await sessions.createAsync(user.id)).token}`,
    };
    const stranger = users.create({ name: 'Other', email: 'other@example.com' });
    strangerHeaders = {
      Authorization: `Bearer ${(await sessions.createAsync(stranger.id)).token}`,
    };
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
  });

  const listIds = async (headers: Record<string, string>): Promise<string[]> => {
    const response = await fetch(`${baseUrl}/agent-research`, { headers });
    expect(response.status).toBe(200);
    const jobs = (await response.json()) as Array<{ id: string }>;
    return jobs.map((job) => job.id);
  };

  it('authenticated list includes unowned legacy rows plus own rows, never other users’ rows', async () => {
    const legacy = insertJob(null);
    const mine = insertJob(userId);
    const stranger = new UsersRepository().create({
      name: 'Third',
      email: 'third@example.com',
    });
    const notMine = insertJob(stranger.id);

    const ids = await listIds(authHeaders);
    expect(ids).toContain(legacy);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(notMine);
  });

  // Tokenless (AGENT_LOCAL) behavior is unchanged by the visibility rule —
  // a null caller can only ever match unowned rows — and isn't reachable
  // here: the route bakes in requireAuth at import when agentLocal is false.
  // The live parity gate exercises the tokenless desktop path end to end.

  it('authenticated get succeeds for unowned rows and 404s for another user’s row', async () => {
    const legacy = insertJob(null);
    const mine = insertJob(userId);

    const legacyGet = await fetch(`${baseUrl}/agent-research/${legacy}`, {
      headers: authHeaders,
    });
    expect(legacyGet.status).toBe(200);

    const foreignGet = await fetch(`${baseUrl}/agent-research/${mine}`, {
      headers: strangerHeaders,
    });
    expect(foreignGet.status).toBe(404);
  });
});
