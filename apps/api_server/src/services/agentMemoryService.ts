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
import { logger } from '../utils/logger';
import {
  rememberToVault,
  forgetFromVault,
  type RememberInput,
  type RememberResult,
  type MemoryVaultWriteOptions,
} from './memoryVaultWriteService';

const memRepo = new AgentMemoryRepository();
const schedRepo = new AgentScheduledTasksRepository();

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
   */
  async forget(id: string, options?: MemoryVaultWriteOptions) {
    const row = await memRepo.findByIdAsync(id);
    if (!row) return false;
    // Vault-sourced rows carry source='obsidian-memory' and source_id=<vault
    // path>. Delete the note file first (confined to the memory dir), then the
    // derived row. Legacy rows from other sources (no vault file) just drop.
    if (row.source === 'obsidian-memory' && row.sourceId) {
      await forgetFromVault(row.sourceId, options);
    }
    return memRepo.deleteAsync(id);
  },

  /**
   * Seed the memory consolidation scheduled task on first startup.
   * Creates a daily cron task that prompts the agent to review recent
   * session history and extract durable facts into agent_memory.
   *
   * Safe to call on every startup — idempotent (checks before inserting).
   */
  async seedConsolidationTask() {
    const existing = await schedRepo.listAllAsync();
    const alreadySeeded = existing.some((t) => t.name === 'Memory Consolidation');
    if (alreadySeeded) return;

    await schedRepo.createAsync({
      name: 'Memory Consolidation',
      description: 'Scan recent agent session messages and extract durable facts into the memory store.',
      scheduleType: 'daily',
      scheduledTime: '02:00',
      timezone: 'America/Los_Angeles',
      prompt: `You are the Memory Consolidation agent for Rhythm.

Your job:
1. Use rhythm_list_sessions (or the agent_session_messages table) to read recent session messages from the past 24 hours.
2. Identify facts, preferences, and important context worth remembering long-term.
3. For each item, call rhythm_remember_memory with kind='fact' or kind='preference' and the extracted content.
4. Skip information that is transient, task-specific, or already stored.
5. Deduplicate: before storing, search rhythm_search_memory for similar entries.

Keep entries concise (< 200 chars each). Aim for 3–10 high-value memories per run.
Report how many memories were added.`,
      agentKind: 'opencode',
      allowedMcpsJson: JSON.stringify(['rhythm']),
      allowedSkillsJson: JSON.stringify(['anthropic-skills:consolidate-memory']),
    });

    logger.info('[AgentMemory] Seeded memory consolidation scheduled task');
  },
};
