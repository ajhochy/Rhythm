import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MEMORY_DIR = mkdtempSync(path.join(tmpdir(), 'memory-ambient-route-'));
process.env.MEMORY_VAULT_PATH = MEMORY_DIR;
process.env.MEMORY_VAULT_SUBDIR = '';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';

let baseUrl: string;
let closeServer: () => Promise<void>;
let authHeaders: Record<string, string>;
let localSessionId: string;

beforeAll(async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);

  const user = new UsersRepository().create({
    name: 'Ambient Test',
    email: 'ambient-memory@example.com',
  });
  const auth = await new SessionsRepository().createAsync(user.id);
  authHeaders = {
    Authorization: `Bearer ${auth.token}`,
    'Content-Type': 'application/json',
  };
  const sessions = new AgentSessionsRepository();
  const local = sessions.insert({
    taskId: null,
    agentKind: 'codex',
    cwd: '/tmp/ambient-memory-test',
    name: 'Ambient memory source',
  });
  localSessionId = local.id;
  sessions.setSdkSessionId(local.id, 'sdk-authoritative-session');

  const server = createApp().listen(0);
  server.maxRequestsPerSocket = 1;
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    });
});

afterAll(async () => {
  await closeServer();
  rmSync(MEMORY_DIR, { recursive: true, force: true });
});

describe('POST /agent-memory ambient session provenance (#1192)', () => {
  it('maps reserved SDK context to local session and ignores direct local-id spoofing', async () => {
    const response = await fetch(`${baseUrl}/agent-memory`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        kind: 'fact',
        content: 'Ambient and historical provenance are both retained.',
        sdkSessionId: 'sdk-authoritative-session',
        sessionId: 'historical-source-session',
        contextSessionId: 'forged-local-session',
      }),
    });

    expect(response.status).toBe(201);
    const [row] = await new AgentMemoryRepository().listAsync(
      undefined,
      undefined,
      10,
    );
    const sources = JSON.parse(row.sourcesJson) as Array<{
      id: string;
      resource: string;
    }>;
    expect(sources).toEqual([
      {
        id: `sess-${localSessionId}`,
        resource: `rhythm://agent-session/${localSessionId}`,
      },
      {
        id: 'sess-historical-source-session',
        resource: 'rhythm://agent-session/historical-source-session',
      },
    ]);
    expect(
      sources.some(({ resource }) => resource.includes('forged-local-session')),
    ).toBe(false);
  });
});
