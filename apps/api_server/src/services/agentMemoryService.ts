/**
 * Agent Memory Service
 *
 * Persistent, searchable agent memory store.
 * Translates Odysseus's `src/memory.py` memory patterns to Node/TS + Postgres.
 *
 * Features:
 *  • Store facts, preferences, and context extracted from agent sessions
 *  • Full-text search (Postgres tsvector / SQLite FTS5)
 *  • Memory consolidation: periodic scan of agent session messages,
 *    extract durable facts, deduplicate, store
 *
 * The consolidation loop runs as a scheduled `agent_scheduled_tasks` row
 * (seeded on first startup) rather than an always-on background loop,
 * so it benefits from the same blast-radius isolation.
 */

import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { recordSeedMarker, seedMarkerExists } from './seed_once';
import { logger } from '../utils/logger';
import { resolveMemoryDirPath } from '../config/env';
import { vaultKeyToMemoryDirRelative } from './memoryVaultSyncService';
import {
  rememberToVault,
  verifyMemory,
  deprecateMemory,
  forgetFromVault,
  findMemoryRowByRememberId,
  updateMemoryInVault,
  readNoteFull,
  resolveWithinMemoryDir,
  type RememberInput,
  type RememberResult,
  type MemoryVaultWriteOptions,
  type UpdateMemoryPatch,
  type VerifyMemoryOptions,
} from './memoryVaultWriteService';
import {
  MEMORY_CONSOLIDATION_ALLOWED_MCPS_JSON,
  MEMORY_CONSOLIDATION_ALLOWED_SKILLS_JSON,
  MEMORY_CONSOLIDATION_PROMPT,
  MEMORY_CONSOLIDATION_SEED_NAME,
} from './memory_consolidation_seed';

const memRepo = new AgentMemoryRepository();
const schedRepo = new AgentScheduledTasksRepository();

async function resolveLifecycleSourceId(
  id: string,
  ownerUserId: number | undefined,
  options?: MemoryVaultWriteOptions,
): Promise<string | null> {
  let row = await memRepo.findByIdAsync(id);
  if (!row) {
    row = await findMemoryRowByRememberId(id, memRepo, options);
  }
  if (!row || row.source !== 'obsidian-memory' || !row.sourceId) return null;
  if (row.ownerUserId !== null && row.ownerUserId !== ownerUserId) return null;
  return row.sourceId;
}

export const agentMemoryService = {
  /**
   * Issue #803 — vault-first `remember`: write the markdown note to the
   * Memory-Vault FIRST, then upsert the derived SQLite index. The vault is the
   * source of truth; the index is a derivation. Returns the note id + path.
   * Throws {@link MemoryWriteError} on a bad kind / path escape (nothing written).
   */
  async remember(input: RememberInput, options?: MemoryVaultWriteOptions): Promise<RememberResult> {
    return rememberToVault(input, options);
  },

  /** Search memories by text query. */
  async search(query: string, ownerUserId?: number, limit = 20) {
    return memRepo.searchAsync(query, ownerUserId, limit);
  },

  /** List memories, optionally filtered by kind. */
  async list(ownerUserId?: number, kind?: string, limit = 50) {
    return memRepo.listAsync(ownerUserId, kind, limit);
  },

  /**
   * Issue #803 — vault-first `forget`: look up the index row by id to find its
   * vault-relative note path, delete the note FILE (confined to the memory
   * dir), then remove the derived index row. Returns false when no row exists
   * for `id` (caller maps that to 404). The vault file is the source of truth,
   * so it is removed before the derived row.
   *
   * Issue #859d (forget-404 bug fix): `id` here historically had to be the
   * DERIVED INDEX row's own `agent_memory.id` (a randomUUID minted by
   * `AgentMemoryRepository.upsertBySourceAsync`, unrelated to the note's
   * frontmatter). But `POST /agent-memory` (rememberToVault) returns the
   * frontmatter ULID as its `id` — a DIFFERENT string — so a caller (e.g. the
   * `rhythm_forget_memory` MCP tool) that naturally reuses the id `remember`
   * just handed it always 404'd. `id` is now resolved through BOTH id spaces:
   * first the direct DB-row lookup (back-compat), then — if that misses — a
   * scan for a vault note whose frontmatter `id` matches (the id `remember`
   * returns), falling back to the row indexed under that note's path.
   */
  async forget(id: string, options?: MemoryVaultWriteOptions) {
    let row = await memRepo.findByIdAsync(id);
    if (!row) {
      row = await findMemoryRowByRememberId(id, memRepo, options);
    }
    if (!row) return false;
    // Vault-sourced rows carry source='obsidian-memory' and source_id=<vault
    // path>. Delete the note file first (confined to the memory dir), then the
    // derived row. Legacy rows from other sources (no vault file) just drop.
    if (row.source === 'obsidian-memory' && row.sourceId) {
      await forgetFromVault(row.sourceId, options);
    }
    return memRepo.deleteAsync(row.id);
  },

  /**
   * Issue #862 — edit-in-place: update an existing memory's content/kind/tags,
   * writing through to BOTH the vault note file AND the derived index — no
   * divergence between the two. `id` is resolved the SAME way `forget` (#859d)
   * resolves it: first as a DB row id (its `sourceId` is mapped to the note's
   * frontmatter id), then as the frontmatter ULID directly — so a caller only
   * holding the id `remember()` returned can still edit successfully.
   *
   * Returns null when no memory exists for `id` (caller maps that to 404).
   * Throws {@link MemoryWriteError} for an invalid `kind` or content that
   * would end up empty — nothing is written in either case.
   */
  async update(id: string, patch: UpdateMemoryPatch, options?: MemoryVaultWriteOptions): Promise<RememberResult | null> {
    let rememberId = id;
    let relPathFallback: string | undefined;
    const row = await memRepo.findByIdAsync(id);
    if (row && row.source === 'obsidian-memory' && row.sourceId) {
      // `id` was a DB row id — resolve it to the note's frontmatter id by
      // reading the note at its indexed vault path (updateMemoryInVault only
      // understands the frontmatter id space). #886: also carry the relPath
      // as a fallback so notes WITHOUT a frontmatter `id` (pre-#803 sync'd
      // notes) are still editable — the rewrite backfills a ULID.
      const memoryDir = options?.memoryDir ?? resolveMemoryDirPath();
      const relPath = vaultKeyToMemoryDirRelative(memoryDir, row.sourceId);
      try {
        const abs = resolveWithinMemoryDir(memoryDir, relPath);
        const full = await readNoteFull(abs);
        if (full.id) rememberId = full.id;
        relPathFallback = relPath;
      } catch {
        // fall through — updateMemoryInVault will report not-found
      }
    }
    return updateMemoryInVault(rememberId, patch, { ...options, relPathFallback });
  },

  /**
   * Resolve either index-row or frontmatter id with owner defense-in-depth,
   * then append a vault-first verification event. Null-owner vault rows retain
   * the established local-instance behavior used by update routes.
   */
  async verify(
    id: string,
    actor: string,
    ownerUserId?: number,
    options?: VerifyMemoryOptions,
  ): Promise<RememberResult | null> {
    const sourceId = await resolveLifecycleSourceId(id, ownerUserId, options);
    if (!sourceId) return null;
    return verifyMemory(sourceId, actor, options);
  },

  /** Non-destructive lifecycle retirement with the same ownership rules. */
  async deprecate(
    id: string,
    actor: string,
    ownerUserId?: number,
    options?: Omit<VerifyMemoryOptions, 'staleAfter'>,
  ): Promise<RememberResult | null> {
    const sourceId = await resolveLifecycleSourceId(id, ownerUserId, options);
    if (!sourceId) return null;
    return deprecateMemory(sourceId, actor, options);
  },

  /**
   * Seed the memory consolidation scheduled task on first startup.
   * Creates a daily cron task that prompts the agent to review recent
   * session history and extract durable facts into agent_memory.
   *
   * Safe to call on every startup — idempotent (checks before inserting).
   */
  async seedConsolidationTask() {
    const marker = `seeded_task:${MEMORY_CONSOLIDATION_SEED_NAME}`;
    const existing = await schedRepo.listAllAsync();
    const alreadySeeded = existing.some((t) => t.name === MEMORY_CONSOLIDATION_SEED_NAME);
    if (alreadySeeded) {
      recordSeedMarker(marker); // adopt pre-marker installs
      return;
    }
    // Durable tombstone: the user deleted the seeded task — never resurrect it.
    if (seedMarkerExists(marker)) return;

    await schedRepo.createAsync({
      name: MEMORY_CONSOLIDATION_SEED_NAME,
      description: 'Scan recent agent session messages and extract durable facts into the memory store.',
      scheduleType: 'daily',
      scheduledTime: '02:00',
      timezone: 'America/Los_Angeles',
      prompt: MEMORY_CONSOLIDATION_PROMPT,
      agentKind: 'opencode',
      allowedMcpsJson: MEMORY_CONSOLIDATION_ALLOWED_MCPS_JSON,
      allowedSkillsJson: MEMORY_CONSOLIDATION_ALLOWED_SKILLS_JSON,
    });

    recordSeedMarker(marker);
    logger.info('[AgentMemory] Seeded memory consolidation scheduled task');
  },

  /**
   * Issue #859c — seed the "Memory Interview" task: a supported way to
   * bootstrap/refresh agent memory by INTERVIEW rather than passive session
   * scanning (`seedConsolidationTask` above). The prompt drives a
   * conversational pass — the agent asks the user targeted questions across
   * the memory kinds (fact/person/project/preference/context) — and
   * explicitly instructs the agent to search for an existing memory on the
   * SAME theme before writing (rhythm_search_memory) so repeated or restated
   * answers land on ONE canonical memory per theme via merge-on-capture
   * (#859a), never a pile of raw, one-per-sentence restatements.
   *
   * Seeded weekly (a light-touch periodic refresh) rather than daily — an
   * interview is a deliberate, occasional bootstrap/refresh action, not a
   * background scan. Idempotent — safe to call on every startup.
   */
  async seedMemoryInterviewTask() {
    const marker = 'seeded_task:Memory Interview';
    const existing = await schedRepo.listAllAsync();
    const alreadySeeded = existing.some((t) => t.name === 'Memory Interview');
    if (alreadySeeded) {
      recordSeedMarker(marker); // adopt pre-marker installs
      return;
    }
    // Durable tombstone: the user deleted the seeded task — never resurrect it.
    if (seedMarkerExists(marker)) return;

    await schedRepo.createAsync({
      name: 'Memory Interview',
      description: 'Ask targeted questions to bootstrap or refresh agent memory with a clean, deduplicated set of canonical memories.',
      scheduleType: 'weekly',
      scheduledTime: '09:00',
      timezone: 'America/Los_Angeles',
      prompt: `You are conducting a Memory Interview for Rhythm.

Your job is to bootstrap or refresh agent memory by ASKING the user a small
number of targeted questions — one THEME at a time (e.g. dev preferences,
current projects, operating-mode preferences, key facts about people/roles) —
and distilling each answer into a memory. This is an INTERVIEW, not a
transcript dump: never restate every sentence the user says verbatim.

For each theme:
1. Ask one focused question.
2. Before writing anything, call rhythm_search_memory for that theme to check
   whether a canonical memory already exists.
3. If a related memory exists, call rhythm_remember_memory with the SAME kind
   and let merge-on-capture fold the new detail into the existing note rather
   than creating a near-duplicate.
4. If nothing related exists, call rhythm_remember_memory with kind='fact',
   'preference', 'person', 'project', or 'context' as appropriate.
5. Move to the next theme only after the current one is settled.

Goal: end the interview with ONE canonical memory per theme, not one per raw
sentence. Use rhythm_list_memories at the end to confirm the resulting set is
clean (no near-duplicates) and report a short summary of what was captured.`,
      agentKind: 'opencode',
      allowedMcpsJson: JSON.stringify(['rhythm']),
      allowedSkillsJson: JSON.stringify(['anthropic-skills:consolidate-memory']),
    });

    recordSeedMarker(marker);
    logger.info('[AgentMemory] Seeded memory interview scheduled task');
  },
};
