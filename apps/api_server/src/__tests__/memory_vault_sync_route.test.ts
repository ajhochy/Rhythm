/**
 * ROUTE CONTRACT TEST — Issue #770 WI6: POST /agent-memory/sync.
 *
 * Proves the manual mirror-sync endpoint is wired through the real Express app
 * and returns a {scanned, upserted, deleted} summary. MEMORY_VAULT_PATH is set
 * to a temp fixture vault BEFORE any module import so env.memoryVaultPath (read
 * once at module load) resolves to the fixture — NEVER the real
 * ~/Documents/Memory-Vault.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Must be set before importing app/env (env reads process.env at module load).
const VAULT_DIR = mkdtempSync(path.join(tmpdir(), 'memvault-route-'));
process.env.MEMORY_VAULT_PATH = VAULT_DIR;

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';

let baseUrl: string;
let closeServer: () => Promise<void>;
let authHeaders: Record<string, string>;

beforeAll(async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);

  const user = new UsersRepository().create({ name: 'Test', email: 'wi6@example.com' });
  const session = await new SessionsRepository().createAsync(user.id);
  authHeaders = { Authorization: `Bearer ${session.token}` };

  writeFileSync(
    path.join(VAULT_DIR, 'hello.md'),
    ['---', 'kind: fact', '---', 'Hello from the vault.'].join('\n'),
    'utf8',
  );

  const server = createApp().listen(0, '127.0.0.1');
  server.maxRequestsPerSocket = 1;
  await new Promise<void>((r) => server.once('listening', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () =>
    new Promise<void>((res, rej) => {
      server.closeAllConnections();
      server.close((e) => (e ? rej(e) : res()));
    });
});

afterAll(async () => {
  await closeServer();
  try {
    rmSync(VAULT_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('POST /agent-memory/sync (WI6)', () => {
  it('runs the mirror-sync and returns a summary', async () => {
    const res = await fetch(`${baseUrl}/agent-memory/sync`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scanned: number;
      upserted: number;
      deleted: number;
    };
    expect(body.scanned).toBe(1);
    expect(body.upserted).toBe(1);
    expect(body.deleted).toBe(0);
  });

  it('populates agent_memory with an instance-global obsidian-memory row', async () => {
    // The mirror stamps vault rows with ownerUserId = null (instance-global),
    // matching how the consolidation loop seeds shared memory. The REAL Brain
    // panel reads GET /agent-memory from the LOCAL agent server (localhost:4001,
    // AGENT_LOCAL=true → auth bypassed → no owner filter), so null-owner rows
    // are returned. We assert the populated row at the repository layer here
    // (the owner-scoped HTTP list with a bearer token intentionally excludes
    // instance-global rows; that read path is unchanged by WI6).
    const rows = await new AgentMemoryRepository().listAsync(undefined, undefined, 50);
    const vaultRow = rows.find((r) => r.source === 'obsidian-memory');
    expect(vaultRow).toBeDefined();
    expect(vaultRow?.content).toBe('Hello from the vault.');
    expect(vaultRow?.ownerUserId).toBeNull();
  });
});
