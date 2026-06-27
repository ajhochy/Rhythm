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

import { AgentMemoryRepository, type CreateAgentMemoryInput } from '../repositories/agent_memory_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { logger } from '../utils/logger';

const memRepo = new AgentMemoryRepository();
const schedRepo = new AgentScheduledTasksRepository();

export const agentMemoryService = {
  /** Store a new memory entry. */
  async remember(input: CreateAgentMemoryInput) {
    return memRepo.createAsync(input);
  },

  /** Search memories by text query. */
  async search(query: string, ownerUserId?: number, limit = 20) {
    return memRepo.searchAsync(query, ownerUserId, limit);
  },

  /** List memories, optionally filtered by kind. */
  async list(ownerUserId?: number, kind?: string, limit = 50) {
    return memRepo.listAsync(ownerUserId, kind, limit);
  },

  /** Delete a memory entry by ID. */
  async forget(id: string) {
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
