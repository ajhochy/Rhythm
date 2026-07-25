import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  isMobileToolOperationAllowed,
} from '../routes/mobile_tools_routes';
import { startTestServer } from './helpers/real_server';

describe('#1173 mobile tools gateway', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
  });

  async function pair(email: string): Promise<{
    userId: number;
    deviceToken: string;
  }> {
    const user = new UsersRepository().create({
      name: email.split('@')[0],
      email,
    });
    const session = new SessionsRepository().create(user.id);
    const auth = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };
    const codeResponse = await fetch(
      `${baseUrl}/mobile-gateway/pairing-codes`,
      { method: 'POST', headers: auth, body: '{}' },
    );
    expect(codeResponse.status).toBe(201);
    const { pairingCode } = (await codeResponse.json()) as {
      pairingCode: string;
    };
    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        pairingCode,
        deviceName: `${email} iPhone`,
      }),
    });
    expect(pairResponse.status).toBe(201);
    const { deviceToken } = (await pairResponse.json()) as {
      deviceToken: string;
    };
    return { userId: user.id, deviceToken };
  }

  it('accepts only the explicit mobile operation matrix', () => {
    expect(isMobileToolOperationAllowed('agent-memory', 'GET', '/')).toBe(true);
    expect(isMobileToolOperationAllowed('agent-memory', 'POST', '/sync')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-webhooks', 'POST', '/hook/receive')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-configs', 'POST', '/export')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-configs', 'POST', '/profile/security-lock')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-org-proposals', 'POST', '/p/revert')).toBe(false);
    expect(isMobileToolOperationAllowed('agents/run-quality', 'POST', '/tool-events')).toBe(false);
    expect(isMobileToolOperationAllowed('opencode/skills', 'DELETE', '/external')).toBe(true);
    expect(isMobileToolOperationAllowed('opencode/commands', 'PUT', '/managed')).toBe(true);
    expect(isMobileToolOperationAllowed('unknown', 'GET', '/')).toBe(false);
  });

  it('binds research data to the paired Rhythm user and supports retry/delete', async () => {
    const first = await pair(`first-${randomUUID()}@example.com`);
    const second = await pair(`second-${randomUUID()}@example.com`);
    const firstHeaders = {
      Authorization: `Device ${first.deviceToken}`,
      'Content-Type': 'application/json',
    };
    const secondHeaders = {
      Authorization: `Device ${second.deviceToken}`,
      'Content-Type': 'application/json',
    };

    const createdResponse = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research`,
      {
        method: 'POST',
        headers: firstHeaders,
        body: JSON.stringify({ query: 'mobile owned research' }),
      },
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      requestedByUserId: number;
    };
    expect(created.requestedByUserId).toBe(first.userId);

    const firstList = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research`,
      { headers: firstHeaders },
    );
    expect(firstList.status).toBe(200);
    expect(await firstList.json()).toEqual([
      expect.objectContaining({ id: created.id }),
    ]);

    const secondList = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research`,
      { headers: secondHeaders },
    );
    expect(secondList.status).toBe(200);
    expect(await secondList.json()).toEqual([]);
    const crossAccountGet = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research/${created.id}`,
      { headers: secondHeaders },
    );
    expect(crossAccountGet.status).toBe(404);

    db.prepare(`
      UPDATE agent_research_jobs
      SET status = 'error', error = 'transient', report = 'stale'
      WHERE id = ?
    `).run(created.id);
    const retry = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research/${created.id}/retry`,
      { method: 'POST', headers: firstHeaders, body: '{}' },
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      id: created.id,
      status: 'pending',
      report: null,
      error: null,
      sourcesJson: '[]',
    });

    const remove = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research/${created.id}`,
      { method: 'DELETE', headers: firstHeaders },
    );
    expect(remove.status).toBe(204);
    expect(
      db.prepare('SELECT id FROM agent_research_jobs WHERE id = ?').get(created.id),
    ).toBeUndefined();
  });

  it('requires Device auth and keeps blocked administrative surfaces unreachable', async () => {
    const unauthenticated = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-memory`,
    );
    expect(unauthenticated.status).toBe(401);
    const { deviceToken } = await pair(`allowlist-${randomUUID()}@example.com`);
    const headers = {
      Authorization: `Device ${deviceToken}`,
      'Content-Type': 'application/json',
    };
    for (const [method, path] of [
      ['POST', '/agent-memory/sync'],
      ['POST', '/agent-webhooks/x/receive'],
      ['GET', '/agent-configs/export'],
      ['POST', '/agent-configs/x/security-lock'],
      ['POST', '/agent-org-proposals/x/revert'],
      ['POST', '/agents/run-quality/tool-events'],
    ]) {
      const response = await fetch(
        `${baseUrl}/mobile-gateway/tools${path}`,
        { method, headers, body: method === 'GET' ? undefined : '{}' },
      );
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });
});
