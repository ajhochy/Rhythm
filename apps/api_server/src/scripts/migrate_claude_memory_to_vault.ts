/**
 * migrate_claude_memory_to_vault.ts — Issue #860 (memory epic #801/#859/#860)
 *
 * One-time (but IDEMPOTENT — safe to re-run) migration of the standalone
 * `memory` knowledge-graph MCP's store
 * (~/Documents/Claude-Memory/memory.jsonl, written by
 * @modelcontextprotocol/server-memory) into the Obsidian AGENT-MEMORY vault —
 * the single source of truth per
 * docs/ai/decisions/2026-07-02-agent-memory-in-obsidian-vault.md.
 *
 * Source format: newline-delimited JSON, two record shapes:
 *   {"type":"entity","name":<string>,"entityType":<string>,"observations":[<string>,...]}
 *   {"type":"relation","from":<string>,"to":<string>,"relationType":<string>}
 *
 * Migration strategy:
 *   1. Each ENTITY becomes ONE memory note. `kind` is mapped from
 *      `entityType` (person/project map directly; everything else — workflow,
 *      service, task, standing_instruction, or any unrecognized type — maps
 *      to `fact`, since those aren't part of the vault's fixed kind set
 *      `fact|person|project|preference|context`). The note body is the
 *      entity's `observations` joined as a bullet list.
 *   2. Each RELATION is folded into its `from` entity's note body as a
 *      `[[wikilink]]` line under a "## Relations" section — Obsidian's
 *      native way to express structure between notes (there is no
 *      first-class edge/relation concept, so a separate relation note would
 *      be indexed as a spurious extra memory). A relation whose `from` entity
 *      isn't in this migration batch is still recorded (as a note titled
 *      after `from`, containing just the relation) rather than silently
 *      dropped — every relation in the source file is accounted for.
 *   3. Writes go through the SAME vault-first `rememberToVault` path
 *      (`memoryVaultWriteService.ts`) that `POST /agent-memory` uses, so
 *      migrated notes get merge-on-capture (#859a) and land in the derived
 *      index exactly like any other memory. Idempotent: re-running with the
 *      same content resolves to the same note (content-key dedup).
 *
 * Usage (from apps/api_server):
 *   npx tsx src/scripts/migrate_claude_memory_to_vault.ts [path/to/memory.jsonl]
 * Defaults to ~/Documents/Claude-Memory/memory.jsonl when no path is given.
 *
 * SAFETY: never deletes the source file — this is additive-only. A missing
 * source file is a safe no-op (nothing to migrate), never a crash.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { rememberToVault, type MemoryKind, type MemoryVaultWriteOptions } from '../services/memoryVaultWriteService';
import { logger } from '../utils/logger';

export interface KnowledgeGraphEntity {
  name: string;
  entityType: string;
  observations: string[];
}

export interface KnowledgeGraphRelation {
  from: string;
  to: string;
  relationType: string;
}

export interface ParsedKnowledgeGraph {
  entities: KnowledgeGraphEntity[];
  relations: KnowledgeGraphRelation[];
}

/**
 * Parse the knowledge-graph MCP's newline-delimited JSON store into entities
 * + relations. Never throws: a blank line or a line that isn't valid JSON
 * (or doesn't match either known shape) is skipped, not fatal — the rest of
 * the file still parses.
 */
export function parseKnowledgeGraphJsonl(raw: string): ParsedKnowledgeGraph {
  const entities: KnowledgeGraphEntity[] = [];
  const relations: KnowledgeGraphRelation[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const record = parsed as Record<string, unknown>;

    if (record.type === 'entity' && typeof record.name === 'string') {
      entities.push({
        name: record.name,
        entityType: typeof record.entityType === 'string' ? record.entityType : 'fact',
        observations: Array.isArray(record.observations)
          ? record.observations.filter((o): o is string => typeof o === 'string')
          : [],
      });
    } else if (
      record.type === 'relation' &&
      typeof record.from === 'string' &&
      typeof record.to === 'string'
    ) {
      relations.push({
        from: record.from,
        to: record.to,
        relationType: typeof record.relationType === 'string' ? record.relationType : 'relates to',
      });
    }
  }

  return { entities, relations };
}

/**
 * Map a knowledge-graph `entityType` to one of the vault's fixed memory
 * kinds (`fact | person | project | preference | context`). `person` and
 * `project` map directly (they exist in both vocabularies); every other
 * entityType (workflow, service, task, standing_instruction, or anything
 * unrecognized) maps to `fact` — the vault has no equivalent slot for those,
 * and `fact` is the safe, information-preserving default (never `preference`
 * or `context`, which carry a more specific meaning the source data doesn't
 * assert).
 */
export function mapEntityTypeToMemoryKind(entityType: string): MemoryKind {
  const normalized = entityType.trim().toLowerCase();
  if (normalized === 'person') return 'person';
  if (normalized === 'project') return 'project';
  return 'fact';
}

/** Build a vault note body for one entity: observations + any outgoing relations as wikilinks. */
function buildNoteBody(entity: KnowledgeGraphEntity, outgoing: KnowledgeGraphRelation[]): string {
  const lines: string[] = [];
  for (const obs of entity.observations) {
    lines.push(`- ${obs}`);
  }
  if (outgoing.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('## Relations');
    for (const rel of outgoing) {
      lines.push(`- ${rel.relationType} [[${rel.to}]]`);
    }
  }
  return lines.join('\n').trim() || `(migrated from Claude-Memory: ${entity.name})`;
}

export interface MigrateClaudeMemoryOptions extends MemoryVaultWriteOptions {}

export interface MigrateClaudeMemoryResult {
  /** Number of entities found in the source file. */
  entityCount: number;
  /** Number of entities successfully written (or merged) into the vault. */
  migratedCount: number;
  /** Number of entities that failed to write (logged, not fatal to the rest). */
  skippedCount: number;
  /** Number of relations whose `from` entity was not in the entity list — still migrated as a standalone note. */
  orphanRelationEntities: number;
}

/**
 * Migrate the knowledge-graph MCP's jsonl file into the AGENT-MEMORY vault.
 * Idempotent — safe to re-run (relies on `rememberToVault`'s content-key
 * dedup, same as every other memory write path). A missing source file is a
 * safe no-op (`entityCount: 0`), never throws.
 */
export async function migrateClaudeMemoryToVault(
  jsonlPath: string,
  options: MigrateClaudeMemoryOptions = {},
): Promise<MigrateClaudeMemoryResult> {
  let raw: string;
  try {
    raw = await fs.readFile(jsonlPath, 'utf8');
  } catch {
    logger.info(`[MigrateClaudeMemory] source not found, nothing to migrate: ${jsonlPath}`);
    return { entityCount: 0, migratedCount: 0, skippedCount: 0, orphanRelationEntities: 0 };
  }

  const { entities, relations } = parseKnowledgeGraphJsonl(raw);

  const relationsByFrom = new Map<string, KnowledgeGraphRelation[]>();
  for (const rel of relations) {
    const list = relationsByFrom.get(rel.from) ?? [];
    list.push(rel);
    relationsByFrom.set(rel.from, list);
  }

  const entityNames = new Set(entities.map((e) => e.name));
  let migratedCount = 0;
  let skippedCount = 0;
  let orphanRelationEntities = 0;

  for (const entity of entities) {
    const outgoing = relationsByFrom.get(entity.name) ?? [];
    const body = buildNoteBody(entity, outgoing);
    try {
      await rememberToVault(
        {
          kind: mapEntityTypeToMemoryKind(entity.entityType),
          content: body,
          source: 'claude-memory-migration',
          tags: ['migrated-from-claude-memory'],
        },
        options,
      );
      migratedCount += 1;
    } catch (err) {
      logger.warn(
        `[MigrateClaudeMemory] failed to migrate entity "${entity.name}" (non-fatal): ${String(err)}`,
      );
      skippedCount += 1;
    }
  }

  // A relation whose `from` isn't a known entity is still migrated — as a
  // minimal standalone note carrying just that relation — so no relation in
  // the source file is silently dropped.
  const handledOrphans = new Set<string>();
  for (const rel of relations) {
    if (entityNames.has(rel.from) || handledOrphans.has(rel.from)) continue;
    handledOrphans.add(rel.from);
    const orphanRelations = relationsByFrom.get(rel.from) ?? [];
    const body = buildNoteBody({ name: rel.from, entityType: 'fact', observations: [] }, orphanRelations);
    try {
      await rememberToVault(
        {
          kind: 'fact',
          content: body,
          source: 'claude-memory-migration',
          tags: ['migrated-from-claude-memory'],
        },
        options,
      );
      orphanRelationEntities += 1;
    } catch (err) {
      logger.warn(
        `[MigrateClaudeMemory] failed to migrate orphan-relation entity "${rel.from}" (non-fatal): ${String(err)}`,
      );
    }
  }

  logger.info(
    `[MigrateClaudeMemory] migrated ${migratedCount}/${entities.length} entities (${skippedCount} skipped, ${orphanRelationEntities} orphan-relation notes) from ${jsonlPath}`,
  );

  return { entityCount: entities.length, migratedCount, skippedCount, orphanRelationEntities };
}

/** CLI entry point — only runs when this file is executed directly (not imported by tests). */
async function main() {
  const argPath = process.argv[2];
  const jsonlPath =
    argPath && argPath.trim() !== ''
      ? path.resolve(argPath)
      : path.join(homedir(), 'Documents', 'Claude-Memory', 'memory.jsonl');

  // The CLI writes through the real derived index (same local SQLite DB the
  // running app uses), so `initDb()` must run before any rememberToVault
  // call touches getDb(). Tests inject their own DB via setDb() and never
  // hit this path.
  const { initDb } = await import('../database/db');
  await initDb();

  console.log(`[migrate-claude-memory] source: ${jsonlPath}`);
  const result = await migrateClaudeMemoryToVault(jsonlPath);
  console.log(
    `[migrate-claude-memory] done: entities=${result.entityCount} migrated=${result.migratedCount} skipped=${result.skippedCount} orphanRelationNotes=${result.orphanRelationEntities}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[migrate-claude-memory] fatal:', err);
    process.exitCode = 1;
  });
}
