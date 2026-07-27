/**
 * memory_consolidation_drafter.ts — Issue #859b (memory epic #801/#859).
 *
 * Mirrors `skill_consolidation_drafter.ts` (#852) for the memory store: a
 * scheduled/on-demand PASS (not the per-write merge-on-capture in
 * `memoryVaultWriteService.rememberToVault`, #859a) that scans every note
 * currently in the vault, clusters memories that overlap above a similarity
 * threshold WITHIN THE SAME KIND, merges each cluster into ONE canonical note
 * (the oldest member survives; every other member's unique content is folded
 * in via `mergeMemoryContent`, nothing dropped), retires the redundant notes
 * (vault file deleted + index row removed), and returns a before-snapshot so
 * the whole pass can be undone with {@link revertMemoryConsolidation}.
 *
 * This exists because merge-on-capture only catches redundancy AT WRITE TIME
 * — two memories written before that feature existed, or written far enough
 * apart that a caller didn't re-check the same theme, can still accumulate as
 * separate notes. The consolidation pass is the periodic cleanup that catches
 * what merge-on-capture missed.
 *
 * MERGE STRATEGY (deliberately mechanical, no LLM call — same posture as
 * skill_consolidation_drafter.ts):
 *   1. Group all vault-sourced index rows by `kind`.
 *   2. Within each kind, greedily cluster notes whose Jaccard token overlap
 *      clears `MEMORY_MERGE_THRESHOLD` (the same bar #859a uses, so the two
 *      features agree on what counts as "the same theme").
 *   3. For each cluster of size >= 2: the OLDEST note (by `created`) survives;
 *      every other member's body is folded into the survivor via
 *      `mergeMemoryContent` (duplicate-content-aware append), then the
 *      member's vault file + index row are retired.
 *   4. Clusters of size 1 (nothing to merge) are left untouched.
 *
 * Operational envelope (mirrors org-optimizer services):
 *   • NEVER throws on a well-formed vault — a single unreadable note is
 *     skipped (logged), not fatal to the rest of the pass.
 *   • Reversible: `beforeSnapshot` captures every note's exact vault-relative
 *     path + full content BEFORE any mutation, so `revertMemoryConsolidation`
 *     can restore the pre-pass state byte-for-byte.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveMemoryDirPath } from '../config/env';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from './memory_index_service';
import { toVaultRelativeKey, vaultKeyToMemoryDirRelative, MEMORY_VAULT_SOURCE } from './memoryVaultSyncService';
import {
  readNoteFull,
  renderMemoryNote,
  resolveWithinMemoryDir,
  isoDate,
  type NoteFrontmatter,
  type MemoryKind,
} from './memoryVaultWriteService';
import { MEMORY_MERGE_THRESHOLD, mergeMemoryContent, textSimilarity } from './memory_similarity';
import {
  CONSOLIDATION_MEMORY_ACTOR,
  mergeLifecycleMetadata,
} from './memory_note_format';
import { logger } from '../utils/logger';

export interface MemoryConsolidationOptions {
  /** Override the memory dir (tests point this at a temp fixture). */
  memoryDir?: string;
  /** Index service to keep the derived index in sync (defaults to a new one). */
  index?: MemoryIndexService;
  /** Repository for reading/writing the derived index (defaults to a new one). */
  repo?: AgentMemoryRepository;
  /** Override the similarity bar (defaults to MEMORY_MERGE_THRESHOLD). */
  threshold?: number;
}

/** One note's full pre-merge state, captured before any mutation for revert. */
export interface MemoryConsolidationSnapshotEntry {
  /** Vault-root-relative path (e.g. `memory/fact/abc.md`). */
  vaultRelKey: string;
  /** Full rendered file content (frontmatter + body) BEFORE the pass. */
  fileContent: string;
  kind: MemoryKind;
  tags: string[];
}

export interface MemoryConsolidationSnapshot {
  /** Every note that existed before the pass ran, keyed by vault-relative path. */
  entries: MemoryConsolidationSnapshotEntry[];
}

export interface MemoryConsolidationResult {
  /** Number of clusters that had >= 2 members and were merged. */
  mergedClusters: number;
  /** Number of redundant notes retired (vault file + index row removed). */
  retiredCount: number;
  /** Snapshot of the pre-pass state, for revertMemoryConsolidation. */
  beforeSnapshot: MemoryConsolidationSnapshot;
}

interface NoteRecord {
  vaultRelKey: string;
  abs: string;
  id: string;
  kind: MemoryKind;
  tags: string[];
  body: string;
  created: string;
  frontmatter: Record<string, unknown>;
}

/**
 * Run one consolidation pass over the vault's memory notes.
 *
 * Never throws — an unreadable individual note is skipped (logged) and the
 * rest of the pass proceeds. A vault with no redundancy is a safe no-op
 * (`mergedClusters: 0, retiredCount: 0`).
 */
export async function runMemoryConsolidation(
  options: MemoryConsolidationOptions = {},
): Promise<MemoryConsolidationResult> {
  const memoryDir = options.memoryDir ?? resolveMemoryDirPath();
  const repo = options.repo ?? new AgentMemoryRepository();
  const index = options.index ?? new MemoryIndexService(repo);
  const threshold = options.threshold ?? MEMORY_MERGE_THRESHOLD;

  const rows = await repo.listAsync(undefined, undefined, 10000);
  const vaultRows = rows.filter((r) => r.source === MEMORY_VAULT_SOURCE && r.sourceId);

  const records: NoteRecord[] = [];
  for (const row of vaultRows) {
    const sourceId = row.sourceId!;
    const relPath = vaultKeyToMemoryDirRelative(memoryDir, sourceId);
    let abs: string;
    try {
      abs = resolveWithinMemoryDir(memoryDir, relPath);
    } catch {
      continue; // a row pointing outside the memory dir is never touched
    }
    const full = await readNoteFull(abs);
    if (!full.id) continue; // unreadable / malformed note — skip, not fatal
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tagsJson);
      if (!Array.isArray(tags)) tags = [];
    } catch {
      tags = [];
    }
    records.push({
      vaultRelKey: sourceId,
      abs,
      id: full.id,
      kind: row.kind as MemoryKind,
      tags,
      body: full.body,
      created: full.created ?? isoDate(),
      frontmatter: full.frontmatter,
    });
  }

  // Before-snapshot: capture every candidate note's full file content BEFORE
  // any mutation, so a revert can restore it byte-for-byte.
  const beforeSnapshot: MemoryConsolidationSnapshot = { entries: [] };
  for (const r of records) {
    let fileContent: string;
    try {
      fileContent = await fs.readFile(r.abs, 'utf8');
    } catch {
      continue;
    }
    beforeSnapshot.entries.push({
      vaultRelKey: r.vaultRelKey,
      fileContent,
      kind: r.kind,
      tags: r.tags,
    });
  }

  // Group by kind — merging never crosses kind boundaries (#859 framing: a
  // dev-quality note and an operating-mode note must stay distinct even if
  // both happen to be 'preference'-adjacent in wording).
  const byKind = new Map<MemoryKind, NoteRecord[]>();
  for (const r of records) {
    const list = byKind.get(r.kind) ?? [];
    list.push(r);
    byKind.set(r.kind, list);
  }

  let mergedClusters = 0;
  let retiredCount = 0;

  for (const [, kindRecords] of byKind) {
    const clusters = clusterBySimilarity(kindRecords, threshold);
    for (const cluster of clusters) {
      if (cluster.length < 2) continue; // nothing to merge

      // The OLDEST note (by created date, ties broken by original order)
      // survives as the canonical note.
      const sorted = [...cluster].sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
      const survivor = sorted[0];
      const retirees = sorted.slice(1);

      let mergedBody = survivor.body;
      const mergedTags = new Set(survivor.tags);
      for (const retiree of retirees) {
        mergedBody = mergeMemoryContent(mergedBody, retiree.body);
        for (const t of retiree.tags) mergedTags.add(t);
      }
      const lifecycle = mergeLifecycleMetadata(
        sorted.map((record) => record.frontmatter),
      );

      // Write the merged survivor note (bump `updated`, preserve `created`+`id`).
      const fm: NoteFrontmatter = {
        ...survivor.frontmatter,
        id: survivor.id,
        kind: survivor.kind,
        tags: Array.from(mergedTags),
        created: survivor.created,
        updated: isoDate(),
        source: 'agent',
        ...lifecycle,
        generated: {
          by: CONSOLIDATION_MEMORY_ACTOR,
          at: new Date().toISOString(),
        },
      };
      await fs.writeFile(survivor.abs, renderMemoryNote(fm, mergedBody), 'utf8');
      await index.upsertNote({
        sourceId: survivor.vaultRelKey,
        parsed: { kind: survivor.kind, tags: Array.from(mergedTags), content: mergedBody.trim() },
      });

      // Retire every other member: delete the vault file + index row.
      for (const retiree of retirees) {
        try {
          await fs.unlink(retiree.abs);
        } catch {
          /* already gone — fine, still remove the index row */
        }
        await repo.deleteAsync(retiree.id);
        // The index row keyed on vaultRelKey may carry a DIFFERENT internal
        // row id than the note's frontmatter id (see #859d); clear both.
        await index.removeNote(retiree.vaultRelKey);
        retiredCount += 1;
      }

      mergedClusters += 1;
      logger.info(
        `[MemoryConsolidation] merged cluster of ${cluster.length} (kind=${survivor.kind}) into ${survivor.vaultRelKey}`,
      );
    }
  }

  return { mergedClusters, retiredCount, beforeSnapshot };
}

/**
 * Greedy single-link clustering: repeatedly pick an unclustered note, group
 * every other unclustered note whose similarity to it clears `threshold` into
 * the same cluster, and repeat until every note is assigned. Simple and
 * deterministic — good enough for the modest note counts a personal memory
 * vault holds (mirrors the pragmatic, non-optimal posture of
 * skill_consolidation_drafter.ts's mechanical merge).
 */
function clusterBySimilarity(records: NoteRecord[], threshold: number): NoteRecord[][] {
  const remaining = [...records];
  const clusters: NoteRecord[][] = [];

  while (remaining.length > 0) {
    const seed = remaining.shift()!;
    const cluster = [seed];
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (textSimilarity(seed.body, remaining[i].body) >= threshold) {
        cluster.push(remaining[i]);
        remaining.splice(i, 1);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/**
 * Undo a consolidation pass: restore every note captured in `snapshot` to its
 * EXACT pre-pass file content, and re-sync the derived index to match (any
 * note the pass retired is rewritten to disk, then re-indexed; the merged
 * survivor note is overwritten back to its pre-merge content).
 *
 * Safe to call even if some snapshot entries no longer resolve to a live
 * memory-dir path (skipped, not fatal) — the rest of the restore proceeds.
 */
export async function revertMemoryConsolidation(
  snapshot: MemoryConsolidationSnapshot,
  options: MemoryConsolidationOptions = {},
): Promise<void> {
  const memoryDir = options.memoryDir ?? resolveMemoryDirPath();
  const repo = options.repo ?? new AgentMemoryRepository();
  const index = options.index ?? new MemoryIndexService(repo);

  for (const entry of snapshot.entries) {
    const relPath = vaultKeyToMemoryDirRelative(memoryDir, entry.vaultRelKey);
    let abs: string;
    try {
      abs = resolveWithinMemoryDir(memoryDir, relPath);
    } catch {
      continue;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, entry.fileContent, 'utf8');

    const full = await readNoteFull(abs);
    await index.upsertNote({
      sourceId: entry.vaultRelKey,
      parsed: { kind: entry.kind, tags: entry.tags, content: full.body },
    });
  }
}
