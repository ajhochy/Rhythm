import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { originalAgentLocal } = vi.hoisted(() => {
  const originalAgentLocal = process.env.AGENT_LOCAL;
  process.env.AGENT_LOCAL = 'true';
  return { originalAgentLocal };
});

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

describe('#1491-W1a — local webhook trigger delivery', () => {
  let db: Database.Database;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterAll(async () => {
    await close();
    if (originalAgentLocal === undefined) delete process.env.AGENT_LOCAL;
    else process.env.AGENT_LOCAL = originalAgentLocal;
  });

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    env.agentLocal = true;
  });

  async function createLocalWebhookTrigger() {
    const task = await new AgentScheduledTasksRepository().createAsync({
      name: 'Local webhook target',
      scheduleType: 'manual',
      prompt: 'Handle the local event',
      agentConfigId: 'local-profile-1491',
    });
    const created = await fetch(`${baseUrl}/agent-webhooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Local webhook endpoint',
        targetScheduledTaskId: task.id,
        targetPrompt: 'Summarize the local webhook',
      }),
    });
    expect(created.status).toBe(201);
    const endpoint = await created.json() as { id: string; name: string; secret: string };
    const body = JSON.stringify({ event: 'updated', summary: 'Local plan changed' });
    const signature = crypto.createHmac('sha256', endpoint.secret).update(body).digest('hex');
    const received = await fetch(`${baseUrl}/agent-webhooks/${endpoint.id}/receive`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature-sha256': `sha256=${signature}`,
      },
      body,
    });
    expect(received.status).toBe(200);
    expect(await received.json()).toEqual({ status: 'queued' });
    return { endpoint, task };
  }

  it('1491:W1a:1 lists and consumes only NULL-owner local triggers without auth', async () => {
    const { endpoint, task } = await createLocalWebhookTrigger();
    const user = new UsersRepository().create({
      name: 'Owned trigger user',
      email: 'owned-trigger-1491@example.test',
    });
    db.prepare(
      `INSERT INTO pending_claude_triggers(task_id, triggered_by_user_id, prompt)
       VALUES (NULL, ?, ?)`,
    ).run(user.id, 'Owned prompt must stay private');

    const listed = await fetch(`${baseUrl}/claude-triggers`);
    expect(listed.status).toBe(200);
    const rows = await listed.json() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskTitle: 'Local webhook target',
      profileId: 'local-profile-1491',
      webhookEndpointId: endpoint.id,
      webhookEndpointName: 'Local webhook endpoint',
      scheduledTaskId: task.id,
    });
    expect(rows[0].prompt).toContain('Summarize the local webhook');
    expect(rows[0].prompt).toContain('Local plan changed');

    const ownedId = db.prepare(
      'SELECT id FROM pending_claude_triggers WHERE triggered_by_user_id = ?',
    ).get(user.id) as { id: number };
    expect((await fetch(`${baseUrl}/claude-triggers/${ownedId.id}`, { method: 'DELETE' })).status)
      .toBe(404);

    expect((await fetch(`${baseUrl}/claude-triggers/${rows[0].id}`, { method: 'DELETE' })).status)
      .toBe(204);
    expect((await fetch(`${baseUrl}/claude-triggers/${rows[0].id}`, { method: 'DELETE' })).status)
      .toBe(404);
  });

  it('1491:W1a:2 rejects a present invalid Authorization header', async () => {
    await createLocalWebhookTrigger();
    const response = await fetch(`${baseUrl}/claude-triggers`, {
      headers: { Authorization: 'Bearer' },
    });
    expect(response.status).toBe(401);
  });

  it('1491:W1a:3 requires auth off AGENT_LOCAL and scopes authenticated reads', async () => {
    await createLocalWebhookTrigger();
    const users = new UsersRepository();
    const sessions = new SessionsRepository();
    const owner = users.create({ name: 'Owner', email: 'owner-1491@example.test' });
    const other = users.create({ name: 'Other', email: 'other-1491@example.test' });
    const auth = await sessions.createAsync(owner.id);
    db.prepare(
      `INSERT INTO pending_claude_triggers(task_id, triggered_by_user_id, prompt)
       VALUES (NULL, ?, ?), (NULL, ?, ?)`,
    ).run(owner.id, 'Owner prompt', other.id, 'Other prompt');
    env.agentLocal = false;

    expect((await fetch(`${baseUrl}/claude-triggers`)).status).toBe(401);
    const response = await fetch(`${baseUrl}/claude-triggers`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(response.status).toBe(200);
    const rows = await response.json() as Array<{ prompt: string; triggeredByUserId: number }>;
    expect(rows).toEqual([
      expect.objectContaining({ prompt: 'Owner prompt', triggeredByUserId: owner.id }),
    ]);
  });
});
