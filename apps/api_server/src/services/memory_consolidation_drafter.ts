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
import {
  resolveVaultRootForMemoryDir,
  scanVaultNotes,
  toVaultRelativeKey,
  vaultKeyToMemoryDirRelative,
  MEMORY_VAULT_SOURCE,
  parseNote,
} from './memoryVaultSyncService';
import {
  renderMemoryNote,
  resolveWithinMemoryDir,
  isoDate,
  absoluteMemoryLinkTarget,
  canonicalMemoryLinkSourceId,
  type NoteFrontmatter,
  type MemoryKind,
} from './memoryVaultWriteService';
import {
  MEMORY_MERGE_THRESHOLD,
  mergeAttributedMemoryContent,
  textSimilarity,
  type AttributedMemoryMergeResult,
} from './memory_similarity';
import {
  CONSOLIDATION_MEMORY_ACTOR,
  VALID_MEMORY_KINDS,
  frontmatterString,
  invalidMemorySourceIds,
  isReversedMemoryUsageWindow,
  memorySources,
  memoryUsageWindow,
  mergeLifecycleMetadata,
  parseMemoryNote,
  replaceMemoryNoteBody,
  rewriteMemoryBodyLinks,
  validateNoteSources,
} from './memory_note_format';
import { logger } from '../utils/logger';
import { regenerateMemoryVaultNavigation } from './memory_vault_index_writer';
import { enqueueMemoryVaultLog } from './memory_vault_log';

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
  fileContent: string;
}

interface BacklinkRewriteNote {
  vaultRelKey: string;
  abs: string;
  fileContent: string;
  kind: MemoryKind;
  tags: string[];
}

function isSafeBacklinkRewriteDocument(
  document: ReturnType<typeof parseMemoryNote>,
): boolean {
  return document.hasValidFrontmatter;
}

async function scanSafeBacklinkRewriteNotes(
  memoryDir: string,
): Promise<BacklinkRewriteNote[]> {
  const vaultRoot = resolveVaultRootForMemoryDir(memoryDir);
  const notes = await scanVaultNotes(memoryDir);
  const safe: BacklinkRewriteNote[] = [];
  for (const note of notes) {
    if (!(VALID_MEMORY_KINDS as readonly string[]).includes(note.parsed.kind)) {
      continue;
    }
    let abs: string;
    try {
      abs = resolveWithinMemoryDir(memoryDir, note.sourceId);
    } catch {
      continue;
    }
    let fileContent: string;
    try {
      fileContent = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const document = parseMemoryNote(fileContent);
    if (!isSafeBacklinkRewriteDocument(document)) continue;
    safe.push({
      vaultRelKey: toVaultRelativeKey(vaultRoot, abs),
      abs,
      fileContent,
      kind: note.parsed.kind as MemoryKind,
      tags: note.parsed.tags,
    });
  }
  return safe;
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
    let fileContent: string;
    try {
      fileContent = await fs.readFile(abs, 'utf8');
    } catch {
      logger.warn(
        `[MemoryConsolidation] skipped unreadable or malformed note ${sourceId}`,
      );
      continue;
    }
    const document = parseMemoryNote(fileContent);
    const id = frontmatterString(document.frontmatter, 'id');
    if (!id || !document.hasValidFrontmatter) {
      logger.warn(
        `[MemoryConsolidation] skipped unreadable or malformed note ${sourceId}`,
      );
      continue;
    }
    const sourceValidation = validateNoteSources(document);
    if (
      invalidMemorySourceIds(document.frontmatter).length > 0 ||
      sourceValidation.danglingFootnoteReferences.length > 0 ||
      isReversedMemoryUsageWindow(document.usageWindow)
    ) {
      logger.warn(
        `[MemoryConsolidation] skipped attribution-unsafe note ${sourceId}`,
      );
      continue;
    }
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
      id,
      kind: row.kind as MemoryKind,
      tags,
      body: document.body,
      created: frontmatterString(document.frontmatter, 'created') ?? isoDate(),
      frontmatter: document.frontmatter,
      fileContent,
    });
  }

  // Backlink rewrites operate over every safe live vault note, independently
  // from the derived-index query, its 10k cap, and merge eligibility (an id is
  // required to merge/retire a note, but not to repair a link in one). Capture
  // these exact bytes before any mutation so revert remains byte-perfect.
  const backlinkRewriteNotes = await scanSafeBacklinkRewriteNotes(memoryDir);
  const snapshotEntries = new Map<string, MemoryConsolidationSnapshotEntry>();
  for (const record of records) {
    snapshotEntries.set(record.vaultRelKey, {
      vaultRelKey: record.vaultRelKey,
      fileContent: record.fileContent,
      kind: record.kind,
      tags: record.tags,
    });
  }
  for (const note of backlinkRewriteNotes) {
    snapshotEntries.set(note.vaultRelKey, {
      vaultRelKey: note.vaultRelKey,
      fileContent: note.fileContent,
      kind: note.kind,
      tags: note.tags,
    });
  }
  const beforeSnapshot: MemoryConsolidationSnapshot = {
    entries: [...snapshotEntries.values()],
  };

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
  const retiredToSurvivor = new Map<string, string>();

  for (const [, kindRecords] of byKind) {
    const clusters = clusterBySimilarity(kindRecords, threshold);
    for (const cluster of clusters) {
      if (cluster.length < 2) continue; // nothing to merge

      // The OLDEST note (by created date, ties broken by original order)
      // survives as the canonical note.
      const sorted = [...cluster].sort(
        (a, b) =>
          a.created.localeCompare(b.created) ||
          a.vaultRelKey.localeCompare(b.vaultRelKey) ||
          a.id.localeCompare(b.id),
      );
      const survivor = sorted[0];
      const retirees = sorted.slice(1);
      for (const retiree of retirees) {
        retiredToSurvivor.set(retiree.vaultRelKey, survivor.vaultRelKey);
      }

      let attributedMerge: AttributedMemoryMergeResult = {
        body: survivor.body,
        sources: memorySources(survivor.frontmatter),
        usageWindow: memoryUsageWindow(survivor.frontmatter),
      };
      const mergedTags = new Set(survivor.tags);
      for (const retiree of retirees) {
        attributedMerge = mergeAttributedMemoryContent(
          attributedMerge,
          {
            body: retiree.body,
            sources: memorySources(retiree.frontmatter),
            usageWindow: memoryUsageWindow(retiree.frontmatter),
          },
        );
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
        sources: attributedMerge.sources.length > 0
          ? attributedMerge.sources
          : undefined,
        usage_window: attributedMerge.usageWindow,
        generated: {
          by: CONSOLIDATION_MEMORY_ACTOR,
          at: new Date().toISOString(),
        },
      };
      const rendered = renderMemoryNote(fm, attributedMerge.body);
      await fs.writeFile(survivor.abs, rendered, 'utf8');
      await enqueueMemoryVaultLog(memoryDir, {
        reason: 'consolidation-merge',
        actor: CONSOLIDATION_MEMORY_ACTOR,
        noteSourceId: survivor.vaultRelKey,
        relatedSourceIds: retirees.map((retiree) => retiree.vaultRelKey),
      });
      await index.upsertNote({
        sourceId: survivor.vaultRelKey,
        parsed: parseNote(rendered),
      });

      // Retire every other member: delete the vault file + index row.
      for (const retiree of retirees) {
        let removed = false;
        try {
          await fs.unlink(retiree.abs);
          removed = true;
        } catch {
          /* already gone — fine, still remove the index row */
        }
        if (removed) {
          await enqueueMemoryVaultLog(memoryDir, {
            reason: 'consolidation-retirement',
            actor: CONSOLIDATION_MEMORY_ACTOR,
            noteSourceId: retiree.vaultRelKey,
            relatedSourceIds: [survivor.vaultRelKey],
          });
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

  // Retired-note content moved into the survivor, so rewrite every live
  // backlink to that survivor. Unresolvable/dangling links are byte-preserved.
  if (retiredToSurvivor.size > 0) {
    for (const note of backlinkRewriteNotes) {
      if (retiredToSurvivor.has(note.vaultRelKey)) continue;
      let raw: string;
      try {
        raw = await fs.readFile(note.abs, 'utf8');
      } catch {
        continue;
      }
      const document = parseMemoryNote(raw);
      if (!isSafeBacklinkRewriteDocument(document)) continue;
      const body = rewriteMemoryBodyLinks(document.body, (link) => {
        const currentTarget = canonicalMemoryLinkSourceId(
          memoryDir,
          note.vaultRelKey,
          link.target,
        );
        const survivorTarget = currentTarget
          ? retiredToSurvivor.get(currentTarget)
          : undefined;
        return survivorTarget
          ? absoluteMemoryLinkTarget(memoryDir, survivorTarget)
          : null;
      });
      if (body === document.body) continue;
      const rendered = replaceMemoryNoteBody(document, body);
      await fs.writeFile(note.abs, rendered, 'utf8');
      await enqueueMemoryVaultLog(memoryDir, {
        reason: 'updated',
        actor: CONSOLIDATION_MEMORY_ACTOR,
        noteSourceId: note.vaultRelKey,
      });
      await index.upsertNote({
        sourceId: note.vaultRelKey,
        parsed: parseNote(rendered),
      });
    }
  }

  await regenerateMemoryVaultNavigation(memoryDir);
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
    let changed = true;
    try {
      changed = await fs.readFile(abs, 'utf8') !== entry.fileContent;
    } catch {
      // A missing/unreadable note needs restoration.
    }
    if (changed) {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, entry.fileContent, 'utf8');
      await enqueueMemoryVaultLog(memoryDir, {
        reason: 'consolidation-revert',
        actor: CONSOLIDATION_MEMORY_ACTOR,
        noteSourceId: entry.vaultRelKey,
      });
    }

    await index.upsertNote({
      sourceId: entry.vaultRelKey,
      parsed: parseNote(entry.fileContent),
    });
  }
  await regenerateMemoryVaultNavigation(memoryDir);
}
