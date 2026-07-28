/**
 * Managed Memory Consolidation seed content.
 *
 * Keep the legacy prompt byte-for-byte stable: the migration uses it as the
 * fingerprint that distinguishes Rhythm's shipped row from a user-authored
 * schedule that happens to have the same display name.
 */
export const MEMORY_CONSOLIDATION_SEED_NAME = 'Memory Consolidation';
export const MEMORY_CONSOLIDATION_SEED_VERSION = 2;
export const MEMORY_CONSOLIDATION_REPAIR_KEY = 'memory_consolidation_prompt_v2';

export const LEGACY_MEMORY_CONSOLIDATION_PROMPT_V1 = `You are the Memory Consolidation agent for Rhythm.

Your job:
1. Use rhythm_list_sessions (or the agent_session_messages table) to read recent session messages from the past 24 hours.
2. Identify facts, preferences, and important context worth remembering long-term.
3. For each item, call rhythm_remember_memory with kind='fact' or
   kind='preference', the extracted content, and sessionId set to the EXACT
   source-session id returned by rhythm_list_sessions for the message. Never
   invent or omit that sessionId when the source session is known.
4. Skip information that is transient, task-specific, or already stored.
5. Deduplicate: before storing, search rhythm_search_memory for similar entries.

Keep entries concise (< 200 chars each). Aim for 3–10 high-value memories per run.
Report how many memories were added.`;

export const MEMORY_CONSOLIDATION_PROMPT = `You are the Memory Consolidation agent for Rhythm.

Review recent Rhythm agent sessions and capture only durable, high-value
memories through the registered Rhythm MCP tools.

Workflow:
1. Call rhythm_list_sessions without arguments to list recent sessions.
2. For each relevant session, call rhythm_list_sessions with its sessionId to
   read the messages.
3. Identify concise facts, preferences, people, projects, or context worth
   remembering beyond the current task.
4. Before writing, call rhythm_search_memory with q set to the core topic and
   skip information that is already represented.
5. Call rhythm_remember_memory with content, an appropriate kind, and the
   EXACT source sessionId returned by rhythm_list_sessions. Use only arguments
   exposed by that tool.

Keep each memory under 200 characters. Prefer 3–10 durable memories over a
session summary. Report the number added; do not edit Memory Vault files
directly.`;

export const MEMORY_CONSOLIDATION_ALLOWED_MCPS_JSON = JSON.stringify(['rhythm']);
export const MEMORY_CONSOLIDATION_ALLOWED_SKILLS_JSON = JSON.stringify([]);
