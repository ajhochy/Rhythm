/**
 * CONTRACT TESTS — Issue #808 (memory epic #801, 7/7, FINAL): the guards that
 * make the vault-authority model machine-checkable so it cannot silently
 * regress. Two promises from
 * docs/ai/decisions/2026-06-28-memory-vault-as-source-of-truth.md plus the
 * corrected #807 prod-removal constraint:
 *
 *   (a) SOLE AUTHORITY — the on-disk vault note is the only authority. Editing a
 *       note on disk + re-indexing changes recall; deleting a note on disk +
 *       re-indexing removes it from injection. No stale DB row survives a vault
 *       deletion after a re-index.
 *   (b) PROD STORE REMOVED (corrected per #807 start-fresh) — postgres_bootstrap
 *       creates NO agent_memory table and NO idx_agent_memory_* index; the
 *       /agent-memory route is LOCAL-ONLY (mounted only inside the
 *       env.agentExecutionEnabled gate); the LOCAL store (SQLite agent_memory /
 *       agent_memory_fts in migrations.ts + the route on :4001) is intact; and
 *       the SQLite migrations remain additive.
 *   (c) NO DIVERGENCE — there is exactly one programmatic writer (the local
 *       agent server). The memory MCP tools and the Flutter memory data source
 *       both resolve to localhost:4001 — no prod coupling.
 *
 * Behavioural guards (a) use real in-memory SQLite + real repository + real
 * index/sync services + real FS temp dirs (no module mocks of the SUT). A TEMP
 * FIXTURE vault is created per-test — NEVER the real ~/Documents/Memory-Vault.
 *
 * Source guards (b)/(c) are source-inspection contracts (same style as the #755
 * postgres_bootstrap / app.ts contracts and the #804 base-URL test): a live
 * Postgres is not available in CI, and the Flutter/MCP wiring is a static
 * topology invariant. The corresponding prod-removal seed assertion also lives
 * in issue_755_role_separation.test.ts (#807); this file restates the #808
 * promise directly so the guard is discoverable from the memory suite.
 *
 * PRIVACY: no note bodies are logged.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { rememberToVault } from '../services/memoryVaultWriteService';
import { syncMemoryVault, MEMORY_VAULT_SOURCE } from '../services/memoryVaultSyncService';
import { getRelevantMemories } from '../services/memory_retrieval';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;

beforeEach(() => {
  delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memauth-'));
  // The write path owns `<vault>/memory`; syncMemoryVault scans the vault root.
  memoryDir = path.join(vaultRoot, 'memory');
  mkdirSync(memoryDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ───────────────────── (a) vault is the SOLE authority ─────────────────────

describe('vault note is the sole authority (#808 AC2)', () => {
  it('editing a note on disk + re-index changes recall (disk wins, not the DB)', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'The fellowship hall capacity is 80 people.' },
      { memoryDir, index },
    );

    // Index reflects the original write.
    let hits = await getRelevantMemories('fellowship hall capacity', null);
    expect(hits.map((m) => m.content).join(' ')).toContain('80');

    // Edit the note body directly on disk (Obsidian/Finder), same frontmatter id.
    const abs = path.join(vaultRoot, result.path);
    writeFileSync(
      abs,
      [
        '---',
        `id: ${result.id}`,
        'kind: fact',
        'tags: []',
        'created: 2026-06-28',
        'updated: 2026-06-28',
        '---',
        '',
        'The fellowship hall capacity is 240 people.',
        '',
      ].join('\n'),
      'utf8',
    );

    // Re-index pass (the cron worker) → the EDITED disk content wins.
    await syncMemoryVault({ vaultPath: vaultRoot });

    hits = await getRelevantMemories('fellowship hall capacity', null);
    const joined = hits.map((m) => m.content).join(' ');
    expect(joined).toContain('240');
    expect(joined).not.toContain('capacity is 80');
  });

  it('deleting a note on disk + re-index removes it from injection — no stale DB row survives', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'Choir practice is on Wednesday evenings.' },
      { memoryDir, index },
    );
    expect((await getRelevantMemories('choir practice wednesday', null)).length).toBeGreaterThanOrEqual(1);

    // Delete the note from disk (as a user would).
    rmSync(path.join(vaultRoot, result.path));

    // Re-index pass → the row is tombstoned. NOT recalled, AND not in the table.
    await syncMemoryVault({ vaultPath: vaultRoot });

    const after = await getRelevantMemories('choir practice wednesday', null);
    expect(after.some((m) => m.content.includes('Choir practice'))).toBe(false);

    // Defense-in-depth: assert NO row from the vault source survives the delete.
    const all = await repo.listAsync(undefined, undefined, 100);
    expect(all.filter((r) => r.source === MEMORY_VAULT_SOURCE)).toHaveLength(0);
  });

  it('FALSIFY: WITHOUT a re-index pass the deleted note is still recalled (stale row) — proving the re-index is what enforces authority', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'Stale authority marker qzzx.' },
      { memoryDir, index },
    );
    rmSync(path.join(vaultRoot, result.path));

    // No re-index yet → the index still has the row (this is exactly the stale
    // state the re-index removes; asserting it keeps the guard above honest).
    const stale = await getRelevantMemories('qzzx', null);
    expect(stale.some((m) => m.content.includes('qzzx'))).toBe(true);

    await syncMemoryVault({ vaultPath: vaultRoot });
    const gone = await getRelevantMemories('qzzx', null);
    expect(gone.some((m) => m.content.includes('qzzx'))).toBe(false);
  });
});

// ─────────────── (b) prod store REMOVED; local store intact ────────────────

describe('prod agent_memory store removed; local store + local-only route intact (#808 AC3, corrected per #807)', () => {
  const SRC = path.join(__dirname, '..');
  const bootstrap = readFileSync(path.join(SRC, 'database', 'postgres_bootstrap.ts'), 'utf8');
  const appTs = readFileSync(path.join(SRC, 'app.ts'), 'utf8');
  const migrations = readFileSync(path.join(SRC, 'database', 'migrations.ts'), 'utf8');

  it('postgres_bootstrap creates NO agent_memory table', () => {
    expect(
      bootstrap.includes('CREATE TABLE IF NOT EXISTS agent_memory'),
      'postgres_bootstrap must NOT create a Postgres agent_memory table (#807 removed it)',
    ).toBe(false);
  });

  it('postgres_bootstrap creates NO idx_agent_memory_* index', () => {
    expect(
      bootstrap.includes('idx_agent_memory_fts'),
      'postgres_bootstrap must NOT create idx_agent_memory_fts',
    ).toBe(false);
    expect(
      bootstrap.includes('idx_agent_memory_owner'),
      'postgres_bootstrap must NOT create idx_agent_memory_owner',
    ).toBe(false);
    // No agent_memory index of any name (catch a renamed re-add too).
    expect(
      /CREATE\s+INDEX[^;]*\bON\s+agent_memory\b/i.test(bootstrap),
      'postgres_bootstrap must NOT create any index ON agent_memory',
    ).toBe(false);
  });

  it('the /agent-memory route is LOCAL-ONLY (mounted only inside the agentExecutionEnabled gate)', () => {
    const mountIdx = appTs.indexOf("app.use('/agent-memory', agentMemoryRouter)");
    expect(mountIdx, '/agent-memory must be mounted').toBeGreaterThan(-1);
    // The gate must open before the mount, and the mount must sit inside it (the
    // gate block contains the other agent-execution mounts; agent-sessions is the
    // last mount in the same block).
    const gateIdx = appTs.indexOf('if (env.agentExecutionEnabled)');
    expect(gateIdx, 'agentExecutionEnabled gate must exist').toBeGreaterThan(-1);
    expect(gateIdx, 'the gate must precede the /agent-memory mount').toBeLessThan(mountIdx);
    const sessionsIdx = appTs.indexOf("app.use('/agent-sessions', agentSessionsRouter)");
    expect(
      mountIdx,
      '/agent-memory must be mounted inside the agent-execution gate block (before /agent-sessions, the last gated mount)',
    ).toBeLessThan(sessionsIdx);
  });

  it('the LOCAL SQLite store is intact: migrations create agent_memory + agent_memory_fts', () => {
    expect(
      migrations.includes('CREATE TABLE IF NOT EXISTS agent_memory'),
      'migrations.ts must still create the local SQLite agent_memory table',
    ).toBe(true);
    expect(
      migrations.includes('CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts'),
      'migrations.ts must still create the agent_memory_fts FTS5 index',
    ).toBe(true);
  });

  it('the local store actually works end-to-end (in-memory SQLite migrations gave us a usable agent_memory)', async () => {
    // Behavioural backstop for the source contract: the SAME migrations.ts that
    // is asserted above produced a queryable local store in beforeEach.
    await index.upsertNote({ sourceId: 'x.md', parsed: { kind: 'fact', tags: [], content: 'local store works' } });
    const hits = await repo.searchAsync('local', undefined, 5);
    expect(hits.some((m) => m.content.includes('local store works'))).toBe(true);
  });

  it('SQLite migrations remain ADDITIVE for agent_memory (no DROP / no destructive ALTER of the table)', () => {
    // Scope to the agent_memory region of migrations.ts so an unrelated DROP
    // elsewhere can't trip this.
    const start = migrations.indexOf('CREATE TABLE IF NOT EXISTS agent_memory');
    expect(start, 'agent_memory CREATE must exist in migrations').toBeGreaterThan(-1);
    // Look at a generous window covering the table + its FTS + triggers.
    const region = migrations.slice(start, start + 4000);
    expect(/DROP\s+TABLE[^;]*\bagent_memory\b/i.test(region), 'no DROP TABLE agent_memory').toBe(false);
    expect(/ALTER\s+TABLE\s+agent_memory[^;]*\bDROP\s+COLUMN\b/i.test(region), 'no ALTER ... DROP COLUMN on agent_memory').toBe(false);
    // The whole file must not drop the FTS index either.
    expect(/DROP\s+TABLE[^;]*\bagent_memory_fts\b/i.test(migrations), 'no DROP TABLE agent_memory_fts').toBe(false);
  });
});

// ──────────────── (c) no divergence — one writer, both on :4001 ─────────────

describe('no divergence — memory MCP tools + Flutter data source both target :4001 (#808 AC6)', () => {
  // Repo root from apps/api_server/src/__tests__.
  const REPO = path.join(__dirname, '..', '..', '..', '..');

  it('the MCP server wires the memory tools at RHYTHM_AGENT_URL (default localhost:4001), NOT the prod API URL', () => {
    const indexTs = readFileSync(path.join(REPO, 'apps', 'mcp_server', 'src', 'index.ts'), 'utf8');
    expect(
      /const\s+RHYTHM_AGENT_URL\s*=\s*process\.env\.RHYTHM_AGENT_URL\s*\?\?\s*['"]http:\/\/localhost:4001['"]/.test(indexTs),
      'index.ts must default RHYTHM_AGENT_URL to http://localhost:4001',
    ).toBe(true);
    expect(
      /registerAgentMemoryTools\(\s*server\s*,\s*RHYTHM_AGENT_URL/.test(indexTs),
      'registerAgentMemoryTools must be wired with RHYTHM_AGENT_URL (the local agent base), not RHYTHM_API_URL (prod)',
    ).toBe(true);
    expect(
      /registerAgentMemoryTools\(\s*server\s*,\s*RHYTHM_API_URL/.test(indexTs),
      'registerAgentMemoryTools must NOT be wired with RHYTHM_API_URL (would couple memory to the prod Settings URL)',
    ).toBe(false);
  });

  it('the Flutter memory data source resolves to AppConstants.agentLocalBaseUrl (= localhost:4001), never serverConfig.url', () => {
    const ds = readFileSync(
      path.join(REPO, 'apps', 'desktop_flutter', 'lib', 'features', 'agent_memory', 'data', 'agent_memory_data_source.dart'),
      'utf8',
    );
    expect(
      /_baseUrl\s*=\s*AppConstants\.agentLocalBaseUrl/.test(ds),
      'AgentMemoryDataSource must base on AppConstants.agentLocalBaseUrl',
    ).toBe(true);
    // It must NOT be coupled to the production Settings URL.
    expect(ds.includes('serverConfig'), 'Flutter memory data source must not read serverConfig.url').toBe(false);

    const consts = readFileSync(
      path.join(REPO, 'apps', 'desktop_flutter', 'lib', 'app', 'core', 'constants', 'app_constants.dart'),
      'utf8',
    );
    expect(
      /agentLocalBaseUrl\s*=\s*'http:\/\/localhost:4001'/.test(consts),
      'AppConstants.agentLocalBaseUrl must be http://localhost:4001',
    ).toBe(true);
  });
});
