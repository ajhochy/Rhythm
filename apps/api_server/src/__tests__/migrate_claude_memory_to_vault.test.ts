/**
 * CONTRACT TESTS — Issue #860: migrate ~/Documents/Claude-Memory/memory.jsonl
 * (the standalone knowledge-graph MCP's store) into the Obsidian AGENT-MEMORY
 * vault, so agents read/write memory from exactly ONE store.
 *
 * The knowledge-graph MCP's file is a JSONL stream of two record shapes:
 *   {"type":"entity","name":...,"entityType":...,"observations":[...]}
 *   {"type":"relation","from":...,"to":...,"relationType":...}
 *
 * Migration strategy: each ENTITY becomes one memory note (kind mapped from
 * entityType; observations joined as the note body), and each RELATION is
 * folded into its `from` entity's note body as a `[[wikilink]]` line so the
 * relation structure survives as Obsidian-native links (no separate relation
 * notes — Obsidian doesn't have a first-class edge concept, wikilinks are the
 * idiomatic representation). Migration must not lose any entity or relation.
 *
 * Real in-memory SQLite + real FS temp dir (the actual vault-first write
 * path — no mocks) so this proves entities really land in AGENT-MEMORY, not
 * just that a pure function produces the right shape.
 *
 * Acceptance criteria proven here:
 *   AC1: every entity in the jsonl produces exactly one vault note with a
 *        kind mapped from entityType, and its observations become the body.
 *   AC2: relations from an entity are rendered as [[wikilinks]] in that
 *        entity's note body — no entity or relation is dropped.
 *   AC3: idempotent — running the migration twice does not create duplicate
 *        notes (merge-on-capture / content-key dedup handles a second run).
 *   AC4: kind mapping: person→person, project→project, everything else
 *        (workflow/service/task/standing_instruction/unknown)→fact, since
 *        those aren't in the vault's fixed kind set.
 *   AC5: the migration report accounts for every entity (migrated count
 *        equals entity count) so nothing is silently skipped.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import {
  parseKnowledgeGraphJsonl,
  mapEntityTypeToMemoryKind,
  migrateClaudeMemoryToVault,
} from '../scripts/migrate_claude_memory_to_vault';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const SAMPLE_JSONL = [
  JSON.stringify({
    type: 'entity',
    name: 'AJ Hochhalter',
    entityType: 'person',
    observations: ['Email: ajh@example.com', 'Works at Example Church'],
  }),
  JSON.stringify({
    type: 'entity',
    name: 'Rhythm',
    entityType: 'project',
    observations: ['Flutter/Dart macOS desktop app'],
  }),
  JSON.stringify({
    type: 'entity',
    name: 'Sunday Service Prep',
    entityType: 'workflow',
    observations: ['Currently manual'],
  }),
  JSON.stringify({ type: 'relation', from: 'AJ Hochhalter', to: 'Rhythm', relationType: 'owns' }),
  JSON.stringify({
    type: 'relation',
    from: 'Sunday Service Prep',
    to: 'Rhythm',
    relationType: 'uses',
  }),
].join('\n');

let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;
let jsonlPath: string;

function allNoteFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith('.md')) out.push(full);
    }
  }
  walk(memoryDir);
  return out;
}

beforeEach(() => {
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memmigrate-test-'));
  memoryDir = path.join(vaultRoot, 'memory');
  jsonlPath = path.join(vaultRoot, 'source-memory.jsonl');
  writeFileSync(jsonlPath, SAMPLE_JSONL, 'utf8');
});

afterEach(() => {
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('parseKnowledgeGraphJsonl', () => {
  it('parses entities and relations, skipping blank lines', () => {
    const parsed = parseKnowledgeGraphJsonl(SAMPLE_JSONL + '\n\n');
    expect(parsed.entities).toHaveLength(3);
    expect(parsed.relations).toHaveLength(2);
    expect(parsed.entities.map((e) => e.name)).toEqual([
      'AJ Hochhalter',
      'Rhythm',
      'Sunday Service Prep',
    ]);
  });

  it('never throws on a malformed line — skips it and keeps parsing the rest', () => {
    const withGarbage = SAMPLE_JSONL + '\nnot valid json at all';
    const parsed = parseKnowledgeGraphJsonl(withGarbage);
    expect(parsed.entities).toHaveLength(3);
  });
});

describe('mapEntityTypeToMemoryKind (#860 AC4)', () => {
  it('maps person and project directly', () => {
    expect(mapEntityTypeToMemoryKind('person')).toBe('person');
    expect(mapEntityTypeToMemoryKind('project')).toBe('project');
  });

  it('maps everything else to fact', () => {
    expect(mapEntityTypeToMemoryKind('workflow')).toBe('fact');
    expect(mapEntityTypeToMemoryKind('service')).toBe('fact');
    expect(mapEntityTypeToMemoryKind('task')).toBe('fact');
    expect(mapEntityTypeToMemoryKind('standing_instruction')).toBe('fact');
    expect(mapEntityTypeToMemoryKind('something-unknown')).toBe('fact');
  });
});

describe('migrateClaudeMemoryToVault (#860)', () => {
  it('AC1+AC5: migrates every entity to exactly one vault note each', async () => {
    const result = await migrateClaudeMemoryToVault(jsonlPath, { memoryDir, index });

    expect(result.entityCount).toBe(3);
    expect(result.migratedCount).toBe(3);
    expect(result.skippedCount).toBe(0);
    expect(allNoteFiles()).toHaveLength(3);

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(3);
  });

  it('AC1: entity observations become the note body; kind is mapped from entityType', async () => {
    await migrateClaudeMemoryToVault(jsonlPath, { memoryDir, index });

    const rows = await repo.listAsync(undefined, undefined, 100);
    const person = rows.find((r) => r.content.includes('ajh@example.com'));
    expect(person).toBeDefined();
    expect(person!.kind).toBe('person');
    expect(person!.content).toContain('Works at Example Church');

    const project = rows.find((r) => r.content.includes('Flutter/Dart'));
    expect(project!.kind).toBe('project');
  });

  it('AC2: relations from an entity render as [[wikilinks]] in that entity note, nothing dropped', async () => {
    await migrateClaudeMemoryToVault(jsonlPath, { memoryDir, index });

    const files = allNoteFiles();
    const ajFile = files.find((f) => readFileSync(f, 'utf8').includes('ajh@example.com'))!;
    const ajContent = readFileSync(ajFile, 'utf8');
    // "AJ Hochhalter" --owns--> "Rhythm"
    expect(ajContent).toContain('[[Rhythm]]');
    expect(ajContent.toLowerCase()).toContain('owns');

    const workflowFile = files.find((f) => readFileSync(f, 'utf8').includes('Currently manual'))!;
    const workflowContent = readFileSync(workflowFile, 'utf8');
    // "Sunday Service Prep" --uses--> "Rhythm"
    expect(workflowContent).toContain('[[Rhythm]]');
    expect(workflowContent.toLowerCase()).toContain('uses');
  });

  it('AC3: running the migration twice does not create duplicate notes', async () => {
    await migrateClaudeMemoryToVault(jsonlPath, { memoryDir, index });
    expect(allNoteFiles()).toHaveLength(3);

    const second = await migrateClaudeMemoryToVault(jsonlPath, { memoryDir, index });
    expect(allNoteFiles()).toHaveLength(3);
    expect(second.migratedCount).toBe(3);

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(3);
  });

  it('a missing source file is a safe no-op, never throws', async () => {
    const result = await migrateClaudeMemoryToVault(
      path.join(vaultRoot, 'does-not-exist.jsonl'),
      { memoryDir, index },
    );
    expect(result.entityCount).toBe(0);
    expect(result.migratedCount).toBe(0);
    expect(allNoteFiles()).toHaveLength(0);
  });
});
