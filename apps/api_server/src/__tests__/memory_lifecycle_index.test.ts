import Database from 'better-sqlite3';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { trustTier } from '../services/memory_note_format';
import {
  parseNote,
  syncMemoryVault,
} from '../services/memoryVaultSyncService';

function migratedDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let db: Database.Database;
let vaultDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;

beforeEach(() => {
  db = migratedDb();
  setDb(db);
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultDir = mkdtempSync(path.join(tmpdir(), 'mem-okf-index-'));
});

afterEach(() => {
  db.close();
  rmSync(vaultDir, { recursive: true, force: true });
});

function writeNote(name: string, raw: string): void {
  const full = path.join(vaultDir, name);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, raw, 'utf8');
}

function lifecycleShape(row: Awaited<ReturnType<AgentMemoryRepository['listAsync']>>[number]) {
  return {
    status: row.status,
    staleAfter: row.staleAfter,
    verifiedJson: row.verifiedJson,
    generatedBy: row.generatedBy,
    generatedAt: row.generatedAt,
    trustTier: row.trustTier,
  };
}

describe('MEM-OKF #1189 lifecycle index projection', () => {
  it('upgrades a populated legacy table idempotently without changing FTS schema', () => {
    const legacy = new Database(':memory:');
    legacy.exec(`
      CREATE TABLE agent_memory (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'fact',
        content TEXT NOT NULL,
        source TEXT,
        source_id TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        owner_user_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO agent_memory
        (id, kind, content, tags_json, created_at, updated_at)
      VALUES ('legacy', 'fact', 'Preserve me.', '[]', '2026-01-01', '2026-01-01');
    `);

    runMigrations(legacy);
    runMigrations(legacy);

    expect(legacy.prepare(`
      SELECT content, status, stale_after, verified_json,
             generated_by, generated_at, trust_tier
      FROM agent_memory WHERE id = 'legacy'
    `).get()).toEqual({
      content: 'Preserve me.',
      status: 'stable',
      stale_after: null,
      verified_json: '[]',
      generated_by: null,
      generated_at: null,
      trust_tier: 'unverified',
    });
    const indexes = legacy.pragma('index_list(agent_memory)') as { name: string }[];
    expect(indexes.map((entry) => entry.name))
      .toContain('idx_agent_memory_active');
    const ftsColumns = legacy.pragma('table_info(agent_memory_fts)') as { name: string }[];
    expect(ftsColumns.map((entry) => entry.name))
      .toEqual(['content', 'kind', 'tags_json']);
    legacy.close();
  });

  it('round-trips every lifecycle column through upsert, FTS search, and source-id lookup', async () => {
    const parsed = parseNote([
      '---',
      'kind: context',
      'status: draft',
      'stale_after: 2026-09-01',
      'generated: { by: "agent:rhythm/1", at: 2026-07-26T10:00:00Z }',
      'verified:',
      '  - { by: "human:ajh", at: 2026-07-26T11:00:00Z }',
      '---',
      'Seasonal welcome desk schedule.',
    ].join('\n'));
    await index.upsertNote({ sourceId: 'context/seasonal.md', parsed });

    const [listed] = await repo.listAsync(undefined, undefined, 10);
    expect(lifecycleShape(listed)).toEqual({
      status: 'draft',
      staleAfter: '2026-09-01',
      verifiedJson: JSON.stringify(parsed.verified),
      generatedBy: 'agent:rhythm/1',
      generatedAt: '2026-07-26T10:00:00.000Z',
      trustTier: 'human',
    });
    expect(lifecycleShape((await repo.searchAsync('Seasonal'))[0]))
      .toEqual(lifecycleShape(listed));
    expect(lifecycleShape((
      await repo.findBySourceIdsAsync(
        'obsidian-memory',
        ['context/seasonal.md'],
      )
    )[0])).toEqual(lifecycleShape(listed));
  });

  it('derives unverified, machine, and human trust tiers through the shared helper', async () => {
    const fixtures = [
      { sourceId: 'unverified.md', verified: [] },
      {
        sourceId: 'machine.md',
        verified: [
          { by: 'process:import', at: '2026-07-26T10:00:00Z' },
        ],
      },
      {
        sourceId: 'human.md',
        verified: [
          { by: 'agent:reviewer/2', at: '2026-07-26T10:00:00Z' },
          { by: 'human:ajh', at: '2026-07-26T11:00:00Z' },
        ],
      },
    ];
    for (const fixture of fixtures) {
      const frontmatter = { verified: fixture.verified };
      await repo.upsertBySourceAsync({
        kind: 'fact',
        content: fixture.sourceId,
        source: 'obsidian-memory',
        sourceId: fixture.sourceId,
        tagsJson: '[]',
        verifiedJson: JSON.stringify(fixture.verified),
        trustTier: trustTier(frontmatter),
      });
    }

    const rows = await repo.listAsync(undefined, undefined, 10);
    expect(Object.fromEntries(rows.map((row) => [row.sourceId, row.trustTier])))
      .toEqual({
        'unverified.md': 'unverified',
        'machine.md': 'machine',
        'human.md': 'human',
      });
  });

  it('projects legacy defaults and converges incremental sync with a full rebuild', async () => {
    writeNote(
      'legacy.md',
      '---\nkind: fact\ntags: []\n---\nLegacy schedule remains searchable.\n',
    );
    writeNote(
      'seasonal.md',
      [
        '---',
        'kind: context',
        'status: stable',
        'stale_after: 2026-09-01',
        'generated: { by: "agent:rhythm/1", at: 2026-07-26T10:00:00Z }',
        'verified:',
        '  - { by: "agent:reviewer/2", at: 2026-07-26T11:00:00Z }',
        '---',
        'Seasonal schedule.',
      ].join('\n'),
    );

    await syncMemoryVault({ vaultPath: vaultDir });
    const incremental = Object.fromEntries(
      (await repo.listAsync(undefined, undefined, 10))
        .map((row) => [row.sourceId, lifecycleShape(row)]),
    );
    expect(incremental['legacy.md']).toEqual({
      status: 'stable',
      staleAfter: null,
      verifiedJson: '[]',
      generatedBy: null,
      generatedAt: null,
      trustTier: 'unverified',
    });

    await index.rebuildIndexFromVault(vaultDir);
    const rebuilt = Object.fromEntries(
      (await repo.listAsync(undefined, undefined, 10))
        .map((row) => [row.sourceId, lifecycleShape(row)]),
    );
    expect(rebuilt).toEqual(incremental);

    // The vault stays the only durable source; rebuild never rewrites notes.
    expect(readFileSync(path.join(vaultDir, 'legacy.md'), 'utf8'))
      .not.toContain('status:');
  });
});
