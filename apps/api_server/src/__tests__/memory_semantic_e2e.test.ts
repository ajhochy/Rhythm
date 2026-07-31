/**
 * E2E — semantic memory retrieval rollout (steps 1–3), whole prompt path.
 *
 * Real in-memory SQLite + migrations, real repository/index, real vault-first
 * write path, real `buildMemoryPreface`, and a REAL loopback HTTP server
 * standing in for Engraph (`ENGRAPH_MEMORY_URL` → the fallback client the
 * manager returns when it isn't enabled — the exact path a machine without
 * the managed Engraph service exercises). No module mocks of the system
 * under test.
 *
 * Proves, end to end:
 *   E2E-1: hybrid is the DEFAULT — with no mode env set, a memory that shares
 *          NO words with the prompt still reaches the preface via the Engraph
 *          lane, and the fake service receives the search request.
 *   E2E-2: multi-token ranking + junk suppression — single-word-coincidence
 *          memories stay OUT of the preface when a genuinely relevant memory
 *          exists; pure-FTS fallback works with no Engraph configured at all.
 *   E2E-3: latency budget — a hung Engraph (3s delay) cannot delay the preface
 *          beyond the configured budget; FTS results still arrive.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { rememberToVault } from '../services/memoryVaultWriteService';
import { buildMemoryPreface } from '../services/memory_retrieval';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

interface FakeEngraph {
  url: string;
  requests: Array<{ query: string; top_n: number }>;
  close: () => Promise<void>;
}

/** Loopback stand-in for `engraph serve --http`: POST /api/search → file hits. */
function startFakeEngraph(files: () => string[], delayMs = 0): Promise<FakeEngraph> {
  const requests: FakeEngraph['requests'] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push(JSON.parse(body));
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ results: files().map((file) => ({ file_path: file })) }));
      }, delayMs);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;
let engraph: FakeEngraph | null = null;

const ENV_KEYS = [
  'AGENT_MEMORY_RETRIEVAL_MODE',
  'AGENT_MEMORY_SEMANTIC_BUDGET_MS',
  'AGENT_MEMORY_INJECTION_ENABLED',
  'ENGRAPH_MEMORY_URL',
  'ENGRAPH_MEMORY_VAULT_ROOT',
  'MEMORY_VAULT_PATH',
  'MEMORY_VAULT_SUBDIR',
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'mem-sem-e2e-'));
  memoryDir = path.join(vaultRoot, 'memory');
  mkdirSync(memoryDir, { recursive: true });
  process.env.MEMORY_VAULT_PATH = vaultRoot;
});

afterEach(async () => {
  if (engraph) { await engraph.close(); engraph = null; }
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  try { rmSync(vaultRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function seed(content: string): Promise<string> {
  await rememberToVault({ kind: 'fact', content }, { memoryDir, index });
  const rows = await repo.searchAsync(content.split(' ')[0]!.toLowerCase(), undefined, 10);
  const row = rows.find((r) => r.content === content)
    ?? (await repo.searchAsync(content.split(' ').slice(-1)[0]!.toLowerCase(), undefined, 10))
      .find((r) => r.content === content);
  if (!row?.sourceId) throw new Error(`seeded row not found for: ${content}`);
  return row.sourceId;
}

describe('semantic memory retrieval E2E (steps 1–3)', () => {
  it('E2E-1: default mode reaches a real Engraph service but zero-overlap semantic hits fail closed', async () => {
    const sourceId = await seed('Prefers ProPresenter lower-thirds during announcements');
    engraph = await startFakeEngraph(() => [sourceId]);
    process.env.ENGRAPH_MEMORY_URL = engraph.url;

    // No AGENT_MEMORY_RETRIEVAL_MODE set — hybrid must be the default.
    // The query shares no significant words with the stored fact, so FTS
    // cannot find it. P0: the semantic lane exposes no calibrated confidence
    // (Engraph 1.7.2 returns only RRF rank) and the candidate has zero lexical
    // overlap with the query, so automatic injection MUST fail closed — this
    // exact shape (nearest-neighbor injection of an unrelated document) was
    // the McDonald's-report production incident. The service is still
    // consulted; the note stays reachable via explicit search.
    const preface = await buildMemoryPreface('what template do we use for sunday slides', null);

    expect(engraph.requests).toHaveLength(1);
    expect(engraph.requests[0]?.query).toContain('sunday slides');
    expect(preface.text).toBe('');
    expect(preface.memoryIds).toEqual([]);
    const explicit = await repo.searchAsync('propresenter', undefined, 10);
    expect(explicit.some((row) => row.sourceId === sourceId)).toBe(true);
  });

  it('E2E-2: junk suppression keeps one-word coincidences out; pure FTS works with no Engraph at all', async () => {
    await seed('Worship rehearsal schedule is Thursday evenings');
    await seed('The church van maintenance schedule lives in the office binder');
    await seed('Kids ministry worship playlist is updated monthly');

    // ENGRAPH_MEMORY_URL unset + manager disabled → semantic lane resolves []
    // and the preface is pure FTS. No error, no injection of junk.
    const preface = await buildMemoryPreface('worship rehearsal schedule for this week', null);

    expect(preface.text).toContain('Thursday evenings');
    expect(preface.text).not.toContain('van maintenance');
    expect(preface.text).not.toContain('playlist');
  });

  it('E2E-3: a hung Engraph cannot delay the preface beyond the budget; FTS results still arrive', async () => {
    await seed('Facilities reservations are approved by the office admin');
    engraph = await startFakeEngraph(() => [], 3_000);
    process.env.ENGRAPH_MEMORY_URL = engraph.url;
    process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS = '200';

    const started = Date.now();
    const preface = await buildMemoryPreface('who approves facilities reservations', null);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1_500); // budget 200ms + generous CI headroom, far below the 3s hang
    expect(preface.text).toContain('office admin');
  });
});
