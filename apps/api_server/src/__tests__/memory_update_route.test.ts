/**
 * ROUTE CONTRACT TEST — Issue #862: PATCH /agent-memory/:id.
 *
 * Proves the edit-in-place endpoint is wired through the real Express app:
 * a successful edit returns 200 with the updated {id, path, kind}; an unknown
 * id returns 404; an invalid kind returns 400 (nothing written). MEMORY_DIR is
 * set to a temp fixture BEFORE any module import so env.memoryDirPath (read
 * once at module load) resolves to the fixture — NEVER the real vault.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MEMORY_DIR = mkdtempSync(path.join(tmpdir(), 'memupdate-route-'));
process.env.MEMORY_VAULT_PATH = MEMORY_DIR;
process.env.MEMORY_VAULT_SUBDIR = '';

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

  const user = new UsersRepository().create({ name: 'Test', email: 'update-route@example.com' });
  const session = await new SessionsRepository().createAsync(user.id);
  authHeaders = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

  const server = createApp().listen(0);
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
    rmSync(MEMORY_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('GET /agent-memory/:id', () => {
  it('resolves the frontmatter id returned by POST /agent-memory', async () => {
    const createRes = await fetch(`${baseUrl}/agent-memory`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        kind: 'fact',
        content: 'Create-to-get dual-id regression marker.',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const getRes = await fetch(`${baseUrl}/agent-memory/${created.id}`, {
      headers: authHeaders,
    });
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as { content: string };
    expect(fetched.content).toBe('Create-to-get dual-id regression marker.');
  });
});

describe('PATCH /agent-memory/:id (#862)', () => {
  it('edits content in place and returns the full updated entry', async () => {
    const createRes = await fetch(`${baseUrl}/agent-memory`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ kind: 'fact', content: 'Route test original content.' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; path: string; kind: string };

    const updateRes = await fetch(`${baseUrl}/agent-memory/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ content: 'Route test edited content.' }),
    });
    expect(updateRes.status).toBe(200);
    // The response is the full updated AgentMemory row (DB row id, content,
    // kind, tags, timestamps) — NOT the vault {id, path, kind} triple — so the
    // desktop app can refresh its view without a second round-trip.
    const updated = (await updateRes.json()) as { id: string; content: string; kind: string };
    expect(updated.content).toBe('Route test edited content.');
    expect(updated.kind).toBe('fact');

    // Vault-sourced rows are stamped ownerUserId=null (instance-global) — the
    // owner-scoped HTTP search with a bearer token intentionally excludes
    // them (same established pattern as memory_vault_sync_route.test.ts), so
    // we assert the edit landed at the repository layer instead.
    const rows = await new AgentMemoryRepository().listAsync(undefined, undefined, 100);
    const editedRow = rows.find((r) => r.content.includes('Route test edited content'));
    expect(editedRow).toBeDefined();
    expect(rows.some((r) => r.content.includes('Route test original content'))).toBe(false);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-memory/totally-unknown-id`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ content: 'should not matter' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid kind and writes nothing', async () => {
    const createRes = await fetch(`${baseUrl}/agent-memory`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ kind: 'fact', content: 'Route test kind-guard marker.' }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await fetch(`${baseUrl}/agent-memory/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ kind: 'not-a-real-kind' }),
    });
    expect(res.status).toBe(400);
  });
});
