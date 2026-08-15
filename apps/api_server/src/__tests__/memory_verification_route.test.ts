import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MEMORY_DIR = mkdtempSync(path.join(tmpdir(), 'mem-verify-route-'));
process.env.MEMORY_VAULT_PATH = MEMORY_DIR;
process.env.MEMORY_VAULT_SUBDIR = '';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { parseMemoryNote } from '../services/memory_note_format';

let db: Database.Database;
let baseUrl: string;
let closeServer: () => Promise<void>;
let authHeaders: Record<string, string>;
let ownerId: number;
let otherOwnerId: number;

beforeAll(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);

  const users = new UsersRepository();
  const owner = users.create({
    name: 'Owner',
    email: 'memory-owner@example.com',
  });
  const other = users.create({
    name: 'Other',
    email: 'memory-other@example.com',
  });
  ownerId = owner.id;
  otherOwnerId = other.id;
  const session = await new SessionsRepository().createAsync(owner.id);
  authHeaders = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  };

  const server = createApp().listen(0, '127.0.0.1');
  server.maxRequestsPerSocket = 1;
  await new Promise<void>((resolve) =>
    server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  });
});

afterAll(async () => {
  await closeServer();
  db.close();
  rmSync(MEMORY_DIR, { recursive: true, force: true });
});

async function createMemory(content: string): Promise<{
  id: string;
  path: string;
}> {
  const response = await fetch(`${baseUrl}/agent-memory`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ kind: 'fact', content }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ id: string; path: string }>;
}

function noteAt(sourceId: string) {
  return parseMemoryNote(
    readFileSync(path.join(MEMORY_DIR, sourceId), 'utf8'),
  );
}

describe('MEM-OKF #1190 verification routes', () => {
  it('uses authenticated human identity and ignores a forged request actor', async () => {
    const memory = await createMemory(
      'The baptismal preparation checklist lives in the worship office.',
    );
    const response = await fetch(
      `${baseUrl}/agent-memory/${memory.id}/verify`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          by: 'human:forged@example.com',
          staleAfter: '2026-10-01',
        }),
      },
    );

    expect(response.status).toBe(200);
    const row = await response.json() as {
      trustTier: string;
      staleAfter: string;
    };
    expect(row).toMatchObject({
      trustTier: 'human',
      staleAfter: '2026-10-01',
    });
    const note = noteAt(memory.path);
    expect(note.verified).toHaveLength(1);
    expect(note.verified[0].by).toBe('human:memory-owner@example.com');
    expect(note.verified[0].by).not.toContain('forged');
  });

  it('returns 404 for another owner and leaves the vault bytes unchanged', async () => {
    const memory = await createMemory(
      'Budget approvals require two elder signatures before payment.',
    );
    const repo = new AgentMemoryRepository();
    const row = (await repo.listAsync(undefined, undefined, 100))
      .find((candidate) => candidate.sourceId === memory.path);
    expect(row).toBeDefined();
    db.prepare(
      `UPDATE agent_memory SET owner_user_id = ? WHERE id = ?`,
    ).run(otherOwnerId, row!.id);
    const before = readFileSync(path.join(MEMORY_DIR, memory.path), 'utf8');

    const response = await fetch(
      `${baseUrl}/agent-memory/${row!.id}/verify`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      },
    );

    expect(ownerId).not.toBe(otherOwnerId);
    expect(response.status).toBe(404);
    expect(readFileSync(path.join(MEMORY_DIR, memory.path), 'utf8'))
      .toBe(before);
  });

  it('deprecates without deleting the global note or index row', async () => {
    const memory = await createMemory(
      'The former choir rehearsal began at six on Thursday.',
    );
    const response = await fetch(
      `${baseUrl}/agent-memory/${memory.id}/deprecate`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ by: 'human:forged@example.com' }),
      },
    );

    expect(response.status).toBe(200);
    expect(noteAt(memory.path).status).toBe('deprecated');
    const row = (await new AgentMemoryRepository()
      .listAsync(undefined, undefined, 100))
      .find((candidate) => candidate.sourceId === memory.path);
    expect(row?.status).toBe('deprecated');
  });

  it('keeps MCP verification machine-only even when body attempts human forgery', async () => {
    const memory = await createMemory(
      'Overflow parking uses the north gravel lot during holidays.',
    );
    const response = await fetch(
      `${baseUrl}/agent-memory/${memory.id}/agent-lifecycle`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          action: 'verify',
          by: 'human:forged@example.com',
        }),
      },
    );

    expect(response.status).toBe(200);
    const note = noteAt(memory.path);
    expect(note.verified[0].by).toBe('agent:rhythm-mcp/1');
    expect((await response.json() as { trustTier: string }).trustTier)
      .toBe('machine');
  });
});
