import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  installHumanApprovalTestCredentials,
} from '../__tests__/helpers/human_approval_test_credentials';
import { startTestServer } from '../__tests__/helpers/real_server';

describe('#1281 mobile Memories contract', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let sandboxRoot: string;
  let humanCapabilityHeader: Record<string, string>;

  beforeEach(async () => {
    sandboxRoot = mkdtempSync(join(tmpdir(), 'rhythm-1281-memories-'));
    process.env.MEMORY_VAULT_PATH = join(sandboxRoot, 'memory');
    process.env.MEMORY_VAULT_SUBDIR = '';
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    humanCapabilityHeader =
      installHumanApprovalTestCredentials().capabilityHeader;
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
    rmSync(sandboxRoot, { recursive: true, force: true });
    delete process.env.MEMORY_VAULT_PATH;
    delete process.env.MEMORY_VAULT_SUBDIR;
  });

  async function pairAdmin(): Promise<string> {
    const user = new UsersRepository().create({
      name: 'Issue 1281 Admin',
      email: `issue-1281-${randomUUID()}@example.com`,
      role: 'admin',
    });
    const session = new SessionsRepository().create(user.id);
    const codeResponse = await fetch(
      `${baseUrl}/mobile-gateway/pairing-codes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
          ...humanCapabilityHeader,
        },
        body: '{}',
      },
    );
    expect(codeResponse.status).toBe(201);
    const code = (await codeResponse.json()) as {
      pairingCode: string;
      hostId: string;
    };
    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        hostId: code.hostId,
        deviceName: 'Issue 1281 iPhone',
      }),
    });
    expect(pairResponse.status).toBe(201);
    return ((await pairResponse.json()) as { deviceToken: string }).deviceToken;
  }

  it('issue-1281-c1: an admin-paired GET returns instance-global memories', async () => {
    // Regression caught: the controller passes the paired admin's user ID into
    // the list query, so owner-NULL vault memories become a false 200-empty.
    const foreignOwner = new UsersRepository().create({
      name: 'Issue 1281 Foreign Owner',
      email: `issue-1281-foreign-${randomUUID()}@example.com`,
    });
    await new AgentMemoryRepository().createAsync({
      content: 'Issue 1281 foreign private memory',
      ownerUserId: foreignOwner.id,
    });
    const globalMemory = await new AgentMemoryRepository().createAsync({
      content: 'Issue 1281 global memory visible on mobile',
      source: 'vault',
      sourceId: 'fact/issue-1281.md',
    });
    expect(globalMemory.ownerUserId).toBeNull();
    const deviceToken = await pairAdmin();

    const response = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-memory`,
      { headers: { Authorization: `Device ${deviceToken}` } },
    );
    const body = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        id: globalMemory.id,
        content: globalMemory.content,
        ownerUserId: null,
      }),
    ]);
  });
});
