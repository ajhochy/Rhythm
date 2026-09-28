/**
 * Agent Memory page showed only deprecated daily synthesis rows: the startup
 * rebuild stamped every row's created_at with the rebuild time and the list
 * sorted by created_at, so the last-scanned folder filled the first page.
 *
 * Proves (real in-memory SQLite + temp vault + real Express app):
 *   • rebuild/sync keep note dates (frontmatter, else file mtime), not now
 *   • GET /agent-memory hides deprecated by default; ?includeDeprecated=true shows it
 *   • order = non-deprecated first, updated_at DESC, id
 *   • offset paging; ?withCounts=true → {items, counts, total}
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const VAULT_DIR = mkdtempSync(path.join(tmpdir(), 'memlist-route-'));
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
import { MemoryIndexService } from '../services/memory_index_service';
import { syncMemoryVault } from '../services/memoryVaultSyncService';

type Row = { kind: string; content: string; status: string; createdAt: string; updatedAt: string };

let baseUrl: string;
let closeServer: () => Promise<void>;
let authHeaders: Record<string, string>;
const MTIME = new Date('2025-03-04T05:06:07.000Z');

function note(rel: string, frontmatter: string[], body: string) {
  const full = path.join(VAULT_DIR, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, ['---', ...frontmatter, '---', body].join('\n'), 'utf8');
}

async function get(query: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(`${baseUrl}/agent-memory${query}`, { headers: authHeaders });
  expect(res.status).toBe(200);
  return res.json();
}

beforeAll(async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  const user = new UsersRepository().create({ name: 'T', email: 'memlist@example.com' });
  const session = await new SessionsRepository().createAsync(user.id);
  authHeaders = { Authorization: `Bearer ${session.token}` };

  note('fact/old.md', ['kind: fact', 'created: 2026-01-01', 'updated: 2026-01-02'], 'old fact');
  note('fact/new.md', ['kind: fact', 'created: 2026-05-01', 'updated: 2026-05-10'], 'new fact');
  note('preference/p.md', ['kind: preference', 'created: 2026-03-01', 'updated: 2026-03-01'], 'pref');
  // No dates in frontmatter → file mtime.
  note('project/nodate.md', ['kind: project'], 'no date project');
  utimesSync(path.join(VAULT_DIR, 'project/nodate.md'), MTIME, MTIME);
  // Deprecated synthesis with the newest date: must not float to the top.
  note('synthesis/2026-09-01.md', ['kind: fact', 'created: 2026-09-01', 'updated: 2026-09-01', 'status: deprecated'], 'old summary');
  note('synthesis/2026-09-02.md', ['kind: fact', 'created: 2026-09-02', 'updated: 2026-09-02'], 'live summary');

  await new MemoryIndexService(new AgentMemoryRepository()).rebuildIndexFromVault(VAULT_DIR);

  const server = createApp().listen(0, '127.0.0.1');
  server.maxRequestsPerSocket = 1;
  await new Promise<void>((r) => server.once('listening', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () => new Promise<void>((res, rej) => {
    server.closeAllConnections();
    server.close((e) => (e ? rej(e) : res()));
  });
});

afterAll(async () => {
  await closeServer();
  rmSync(VAULT_DIR, { recursive: true, force: true });
});

describe('agent memory index dates', () => {
  it('takes created/updated from frontmatter, else file mtime — never rebuild time', async () => {
    const rows = (await get('?includeDeprecated=true')) as Row[];
    const by = (c: string) => rows.find((r) => r.content === c)!;
    expect(by('old fact').createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(by('old fact').updatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(by('no date project').updatedAt).toBe(MTIME.toISOString());
    expect(new Date(by('no date project').createdAt).getTime()).toBeLessThan(Date.now() - 60_000);
  });

  it('mirror-sync re-upsert keeps note dates instead of stamping now', async () => {
    await syncMemoryVault({ vaultPath: VAULT_DIR });
    const rows = (await get('')) as Row[];
    expect(rows.find((r) => r.content === 'new fact')!.updatedAt).toBe('2026-05-10T00:00:00.000Z');
    expect(rows.find((r) => r.content === 'old fact')!.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('GET /agent-memory list', () => {
  it('hides deprecated by default and orders by updated desc', async () => {
    const rows = (await get('')) as Row[];
    expect(rows.map((r) => r.content)).toEqual([
      'live summary', 'new fact', 'pref', 'old fact', 'no date project',
    ]);
  });

  it('includeDeprecated=true appends deprecated rows after live ones', async () => {
    const rows = (await get('?includeDeprecated=true')) as Row[];
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)!.content).toBe('old summary');
  });

  it('pages with offset and keeps the kind filter', async () => {
    const page1 = (await get('?limit=2')) as Row[];
    const page2 = (await get('?limit=2&offset=2')) as Row[];
    expect(page1.map((r) => r.content)).toEqual(['live summary', 'new fact']);
    expect(page2.map((r) => r.content)).toEqual(['pref', 'old fact']);
    const facts = (await get('?kind=fact')) as Row[];
    expect(facts.map((r) => r.content)).toEqual(['new fact', 'old fact']);
  });

  it('withCounts=true returns {items, counts, total}', async () => {
    const body = await get('?withCounts=true&kind=fact&limit=1');
    expect(body.items).toHaveLength(1);
    expect(body.counts).toEqual({ fact: 2, preference: 1, project: 1, synthesis: 1 });
    expect(body.total).toBe(2);
    const withDep = await get('?withCounts=true&includeDeprecated=true');
    expect(withDep.counts.synthesis).toBe(2);
    expect(withDep.total).toBe(6);
  });
});
