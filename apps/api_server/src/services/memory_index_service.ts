/**
 * MemoryIndexService — owns the DERIVED, DISPOSABLE agent-memory index (Issue #802,
 * memory epic #801).
 *
 * Per docs/ai/decisions/2026-06-28-memory-vault-as-source-of-truth.md, the
 * Obsidian Memory-Vault is the single SOURCE OF TRUTH for agent memory. The
 * local SQLite `agent_memory` + `agent_memory_fts` store is re-cast as a
 * disposable cache: a fast, searchable INDEX derived entirely from the vault
 * and fully rebuildable from a full vault scan. Nothing durable lives here that
 * isn't also in the vault.
 *
 * This service is the single owner of that derived index. It wraps
 * {@link AgentMemoryRepository} and offers:
 *   • rebuildIndexFromVault() — clear the index and repopulate it from a full
 *     recursive vault scan (idempotent; the canonical "rebuild from truth" op).
 *   • upsertNote() / removeNote() — incremental index maintenance, for the
 *     vault-first write path that #803 builds on top of this foundation.
 *
 * Storage source: every indexed row is stamped source='obsidian-memory'
 * (MEMORY_VAULT_SOURCE) keyed on the vault-relative note path, matching the
 * mirror-sync convention so existing readers (AgentMemoryView) and search
 * semantics are unchanged.
 *
 * PRIVACY: never log note bodies. Logs here carry counts and paths only.
 *
 * SCOPE (#802): no write/injection change yet; this lays the rebuild foundation.
 * The SQLite path is the disposable index. #807 removed the prod/Postgres
 * `agent_memory` store — agent memory is local-vault/SQLite-only now, so this
 * service operates purely over the local SQLite index.
 */

import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { resolveMemoryVaultPath } from '../config/env';
import { logger } from '../utils/logger';
import {
  MEMORY_VAULT_SOURCE,
  scanVaultNotes,
  type ParsedNote,
} from './memoryVaultSyncService';
import {
  navigationMemoryDirForVaultRoot,
  regenerateMemoryVaultNavigation,
} from './memory_vault_index_writer';

export interface MemoryIndexRebuildSummary {
  /** Number of `.md` notes scanned from the vault and indexed. */
  indexed: number;
}

/**
 * A parsed note plus the vault-relative path that is its stable identity key.
 * Mirrors {@link ScannedNote} from the sync service.
 */
export interface IndexedNote {
  /** Vault-relative note path — the stable idempotency key (source_id). */
  sourceId: string;
  parsed: ParsedNote;
}

export class MemoryIndexService {
  constructor(
    private readonly repo: AgentMemoryRepository = new AgentMemoryRepository(),
    private readonly ownerUserId: number | null = null,
  ) {}

  /**
   * Rebuild the entire derived index from the vault: clear every indexed row,
   * then re-populate from a full recursive scan of `vaultPath` (defaults to the
   * configured Memory-Vault). This is the canonical "the vault is truth"
   * operation.
   *
   * Properties:
   *   • Idempotent — running twice yields identical rows (clear + repopulate).
   *   • Rebuildable — after a clear the same scan reproduces the same index, so
   *     `searchAsync` results are reproduced exactly.
   *   • Boundary-safe — a missing / empty vault path produces zero notes, so the
   *     index ends up empty; it is not an error.
   */
  async rebuildIndexFromVault(vaultPath?: string): Promise<MemoryIndexRebuildSummary> {
    const path = vaultPath ?? resolveMemoryVaultPath();

    // scanVaultNotes treats a missing / non-directory path as zero notes.
    const notes = await scanVaultNotes(path);

    // Clear first so the index is a pure function of the current vault — no
    // stale rows survive a rebuild.
    const cleared = await this.repo.clearAllAsync();

    for (const { sourceId, parsed } of notes) {
      await this.upsertNote({ sourceId, parsed });
    }

    await regenerateMemoryVaultNavigation(
      navigationMemoryDirForVaultRoot(path),
      { createIfMissing: false },
    );

    logger.info(
      `[MemoryIndex] rebuild: cleared=${cleared} indexed=${notes.length} (vault=${path})`,
    );

    return { indexed: notes.length };
  }

  /**
   * Insert-or-update a single note in the derived index, keyed on its
   * vault-relative path (source_id). Incremental op the vault-first write path
   * (#803) builds on. Idempotent for an unchanged note.
   */
  async upsertNote(note: IndexedNote): Promise<void> {
    await this.repo.upsertBySourceAsync({
      kind: note.parsed.kind,
      content: note.parsed.content,
      source: MEMORY_VAULT_SOURCE,
      sourceId: note.sourceId,
      tagsJson: JSON.stringify(note.parsed.tags),
      status: note.parsed.status ?? 'stable',
      staleAfter: note.parsed.staleAfter ?? null,
      verifiedJson: JSON.stringify(note.parsed.verified ?? []),
      sourcesJson: JSON.stringify(note.parsed.sources ?? []),
      generatedBy: note.parsed.generated?.by ?? null,
      generatedAt: note.parsed.generated?.at ?? null,
      trustTier: note.parsed.trustTier ?? 'unverified',
      ownerUserId: this.ownerUserId,
    });
  }

  /**
   * Remove a single note from the derived index by its vault-relative path
   * (source_id). No-op if the note isn't indexed. Returns the number of index
   * rows removed.
   */
  async removeNote(sourceId: string): Promise<number> {
    return this.repo.deleteBySourceAndSourceIdsAsync(MEMORY_VAULT_SOURCE, [sourceId]);
  }
}
