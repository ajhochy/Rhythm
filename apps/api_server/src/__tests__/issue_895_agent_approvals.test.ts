/**
 * #895 — /agent-approvals CRUD + auto-approve behavior
 *
 * Criteria covered:
 *   - POST /agent-approvals creates a pending approval
 *   - GET /agent-approvals defaults to pending only
 *   - GET /agent-approvals?status=all returns every status
 *   - PATCH /agent-approvals/:id approves with an actor + decidedAt
 *   - PATCH /agent-approvals/:id rejects
 *   - PATCH on an already-decided approval 404s (no double-decide)
 *   - a profile with auto_approve_actions=1 creates an already-approved row
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { startTestServer } from './helpers/real_server';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('#895 — /agent-approvals', () => {
  let baseUrl: string;
  let authHeader: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());

    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Test', email: 'test@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeader = { Authorization: `Bearer ${session.token}` };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('creates a pending approval and requires action', async () => {
    const missing = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const res = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Schedule Jane Doe', preview: 'Add to Worship Leader slot' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('pending');
    expect(body.action).toBe('Schedule Jane Doe');
    expect(body.decidedAt).toBeNull();
  });

  it('GET defaults to pending only; ?status=all returns every row', async () => {
    const created = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Send reminder email' }),
    }).then((r) => r.json()) as { id: string };

    await fetch(`${baseUrl}/agent-approvals/${created.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', actor: 'aj@example.com' }),
    });

    const pendingOnly = await fetch(`${baseUrl}/agent-approvals`, { headers: authHeader });
    expect(await pendingOnly.json()).toEqual([]);

    const all = await fetch(`${baseUrl}/agent-approvals?status=all`, { headers: authHeader });
    const allBody = (await all.json()) as Record<string, unknown>[];
    expect(allBody).toHaveLength(1);
    expect(allBody[0].status).toBe('approved');
    expect(allBody[0].actor).toBe('aj@example.com');
    expect(typeof allBody[0].decidedAt).toBe('string');
  });

  it('rejects an approval and logs the actor', async () => {
    const created = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Update PCO plan item' }),
    }).then((r) => r.json()) as { id: string };

    const res = await fetch(`${baseUrl}/agent-approvals/${created.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected', actor: 'aj@example.com' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('rejected');
  });

  it('404s when deciding an approval that is already decided', async () => {
    const created = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Send email' }),
    }).then((r) => r.json()) as { id: string };

    await fetch(`${baseUrl}/agent-approvals/${created.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });

    const second = await fetch(`${baseUrl}/agent-approvals/${created.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    expect(second.status).toBe(404);
  });

  it('auto-approves for a profile with auto_approve_actions=1', async () => {
    getDb()
      .prepare(
        `INSERT INTO agent_configs (id, label, icon, command, is_agent, enabled, auto_approve_actions) VALUES (?, ?, ?, ?, 1, 1, 1)`,
      )
      .run('dev-profile', 'Dev Profile', 'terminal', '');

    const res = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Send test email', agentConfigId: 'dev-profile' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('approved');
    expect(body.actor).toBe('auto-approved');
  });
});
