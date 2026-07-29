import Database from 'better-sqlite3';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { parseMemoryNote } from '../services/memory_note_format';
import {
  deprecateMemory,
  rememberToVault,
  verifyMemory,
} from '../services/memoryVaultWriteService';
import { syncMemoryVault } from '../services/memoryVaultSyncService';

let db: Database.Database;
let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'issue-1219-memory-'));
  memoryDir = path.join(vaultRoot, 'memory');
  mkdirSync(memoryDir, { recursive: true });
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
});

afterEach(() => {
  db.close();
  rmSync(vaultRoot, { recursive: true, force: true });
});

describe('issue #1219 memory provenance and lifecycle contract', () => {
  it('issue-1219-c1: migration backfills legacy rows without inventing actor or sources', () => {
    const legacy = new Database(':memory:');
    legacy.exec(`
      CREATE TABLE agent_memory (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT,
        source_id TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        owner_user_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO agent_memory
        (id, kind, content, source, source_id, created_at, updated_at)
      VALUES
        ('legacy', 'fact', 'Legacy memory.', 'manual', 'legacy-source',
         '2025-01-01', '2025-01-01');
    `);

    runMigrations(legacy);

    expect(legacy.prepare(`
      SELECT generated_by, generated_at, sources_json, verified_json, trust_tier
      FROM agent_memory WHERE id = 'legacy'
    `).get()).toEqual({
      generated_by: null,
      generated_at: null,
      sources_json: '[]',
      verified_json: '[]',
      trust_tier: 'unverified',
    });
    expect(legacy.pragma('table_info(agent_memory_changes)')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'prior_state_json' }),
        expect.objectContaining({ name: 'rollback_target' }),
        expect.objectContaining({ name: 'source_context_json' }),
      ]),
    );
    legacy.close();
  });

  it('issue-1219-c2: repository round-trips canonical provenance and effective lifecycle', async () => {
    await repo.upsertBySourceAsync({
      kind: 'fact',
      content: 'The deployment checklist has provenance.',
      source: 'obsidian-memory',
      sourceId: 'memory/fact/deployment.md',
      tagsJson: '["deployment"]',
      staleAfter: '2020-01-01',
      sourcesJson: JSON.stringify([
        { id: 'runbook', type: 'document', ref: 'rhythm://runbook/1' },
      ]),
      generatedBy: 'agent:rhythm/1',
      generatedAt: '2026-07-28T12:00:00.000Z',
      trustTier: 'unverified',
    });

    const [listed] = await repo.listAsync();
    const fetched = await repo.findByIdAsync(listed.id);
    const searched = await repo.searchAsync('deployment');

    for (const row of [fetched, searched[0]]) {
      expect(row).toMatchObject({
        generatedBy: 'agent:rhythm/1',
        generatedAt: '2026-07-28T12:00:00.000Z',
        trustTier: 'unverified',
        lifecycleState: 'stale',
        unverifiable: false,
      });
      expect(JSON.parse(row!.sourcesJson)).toEqual([
        { id: 'runbook', type: 'document', ref: 'rhythm://runbook/1' },
      ]);
    }
  });

  it('issue-1219-c3: vault write, update-style replay, and reindex preserve immutable provenance', async () => {
    const created = await rememberToVault({
      kind: 'fact',
      content: 'The blue deployment checklist is canonical.',
      sources: [
        { id: 'runbook', type: 'document', ref: 'rhythm://runbook/1' },
      ],
    }, { memoryDir, index });

    await rememberToVault({
      id: created.id,
      kind: 'fact',
      content: 'The blue deployment checklist remains canonical.',
      sources: [
        { id: 'conversation', type: 'session', ref: 'rhythm://session/2' },
      ],
    }, { memoryDir, index });
    await syncMemoryVault({ vaultPath: vaultRoot });

    const [row] = await repo.findBySourceIdsAsync(
      'obsidian-memory',
      [created.path],
    );
    expect(JSON.parse(row.sourcesJson)).toEqual([
      { id: 'runbook', type: 'document', ref: 'rhythm://runbook/1' },
      { id: 'conversation', type: 'session', ref: 'rhythm://session/2' },
    ]);
    expect(row.generatedBy).toBe('agent:rhythm/1');

    const note = parseMemoryNote(
      readFileSync(path.join(vaultRoot, created.path), 'utf8'),
    );
    expect(note.sources).toEqual(JSON.parse(row.sourcesJson));
    expect(note.generated?.by).toBe(row.generatedBy);
  });

  it('issue-1219-c4: verify and deprecate retain the note and append rollback-linked audit history', async () => {
    const created = await rememberToVault({
      kind: 'fact',
      content: 'Keep this memory while changing its lifecycle.',
      sources: [
        { id: 'source', type: 'document', ref: 'rhythm://source/1' },
      ],
    }, { memoryDir, index });

    await verifyMemory(created.path, 'human:reviewer', {
      memoryDir,
      index,
      at: '2026-07-28T12:00:00.000Z',
      staleAfter: '2026-12-31',
    });
    await deprecateMemory(created.path, 'agent:rhythm-mcp/1', {
      memoryDir,
      index,
      at: '2026-07-28T13:00:00.000Z',
    });

    const [row] = await repo.findBySourceIdsAsync(
      'obsidian-memory',
      [created.path],
    );
    const changes = await repo.listChangesAsync(row.id);
    expect(row.lifecycleState).toBe('deprecated');
    expect(changes.map((change) => change.action)).toEqual([
      'verified',
      'deprecated',
    ]);
    expect(changes[0]).toMatchObject({
      actor: 'human:reviewer',
      rollbackTarget: null,
      sourceContext: expect.objectContaining({ sourceId: created.path }),
      priorState: expect.objectContaining({ status: 'stable' }),
    });
    expect(changes[1].rollbackTarget).toBe(changes[0].id);
    expect(readFileSync(path.join(vaultRoot, created.path), 'utf8'))
      .toContain('status: deprecated');

    await index.rebuildIndexFromVault(vaultRoot);
    const [rebuilt] = await repo.findBySourceIdsAsync(
      'obsidian-memory',
      [created.path],
    );
    expect(await repo.listChangesAsync(rebuilt.id)).toHaveLength(2);
  });

  it('keeps lifecycle ledger rows append-only under direct database writes', async () => {
    const created = await rememberToVault({
      kind: 'fact',
      content: 'Protect this lifecycle history.',
    }, { memoryDir, index });
    await verifyMemory(created.path, 'human:reviewer', {
      memoryDir,
      index,
      at: '2026-07-28T14:00:00.000Z',
    });
    const [memory] = await repo.findBySourceIdsAsync(
      'obsidian-memory',
      [created.path],
    );
    const [change] = await repo.listChangesAsync(memory.id);

    expect(() => db.prepare(
      `UPDATE agent_memory_changes SET actor = 'attacker' WHERE id = ?`,
    ).run(change.id)).toThrow(/append-only/i);
    expect(() => db.prepare(
      'DELETE FROM agent_memory_changes WHERE id = ?',
    ).run(change.id)).toThrow(/append-only/i);
  });

  it('rejects rollback targets belonging to a different memory source', () => {
    db.prepare(
      `INSERT INTO agent_memory_changes
         (id, memory_id, memory_source_id, action, actor, changed_at,
          prior_state_json, rollback_target, source_context_json)
       VALUES ('change-a', 'memory-a', 'source-a', 'verified', 'human:a',
               '2026-07-28T15:00:00.000Z', '{}', NULL, '{}')`,
    ).run();
    expect(() => db.prepare(
      `INSERT INTO agent_memory_changes
         (id, memory_id, memory_source_id, action, actor, changed_at,
          prior_state_json, rollback_target, source_context_json)
       VALUES ('change-b', 'memory-b', 'source-b', 'rollback', 'human:b',
               '2026-07-28T16:00:00.000Z', '{}', 'change-a', '{}')`,
    ).run()).toThrow(/same memory_source_id/i);
  });
});
