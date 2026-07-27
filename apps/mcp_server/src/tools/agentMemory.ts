/**
 * MCP tools for Persistent Agent Memory (Feature C).
 *
 * rhythm_remember_memory  — Store a fact, note, or preference in agent memory
 * rhythm_search_memory    — Full-text search over stored memories
 * rhythm_forget_memory    — Delete a memory entry by ID
 * rhythm_list_memories    — List recent memories (optional kind filter)
 * rhythm_update_memory    — Edit an existing memory's content/kind/tags (#862)
 * rhythm_verify_memory    — Verify or non-destructively deprecate a memory
 *
 * #804 — these tools target the LOCAL agent server (RHYTHM_AGENT_URL, default
 * http://localhost:4001), NOT the prod Settings URL. Memory is vault-first with a
 * local SQLite-derived index on :4001 — the same store the Flutter memory UI
 * reads. They are registered with RHYTHM_AGENT_URL in index.ts; never couple
 * this base to serverConfig.url (dual-endpoint rule).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, apiDelete, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

/** `apiUrl` is the local agent base (RHYTHM_AGENT_URL); see file header (#804). */
export function registerAgentMemoryTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_remember_memory',
    `Store a piece of information in persistent agent memory. Use this to preserve facts, user preferences, decisions, or any information that should survive across agent sessions.

kind: "fact" | "preference" | "decision" | "note" | "contact" | "project" (default: "fact")
source: where this came from, e.g. "conversation", "research", "task:<id>" (default: "conversation")
sessionId: when the fact came from an agent session, stamps a stable rhythm://agent-session source
tags: optional array of string tags for later filtering`,
    {
      content: z.string().describe('The information to remember.'),
      kind: z.string().optional().describe('Category: fact, preference, decision, note, contact, project.'),
      source: z.string().optional().describe('Where this came from.'),
      sourceId: z.string().optional().describe('ID of the source object if applicable.'),
      sessionId: z.string().optional().describe(
        'Originating agent-session ID; automatically recorded as an OKF source.',
      ),
      sources: z.array(z.object({
        id: z.string(),
        resource: z.string().optional(),
        title: z.string().optional(),
        author: z.string().optional(),
        usage_count: z.number().optional(),
        last_modified: z.string().optional(),
      }).passthrough()).optional().describe(
        'Optional per-claim OKF sources. Each entry requires a unique id.',
      ),
      usageWindow: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
      }).passthrough().optional().describe(
        'Optional OKF usage window with YYYY-MM-DD from/to fields.',
      ),
      tags: z.array(z.string()).optional().describe('Tags for filtering.'),
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await apiPost(apiUrl, apiToken, '/agent-memory', args);
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_search_memory',
    'Search persistent agent memory using full-text search. Returns the most relevant stored facts/notes matching the query.',
    {
      q: z.string().describe('Search query.'),
      limit: z.number().optional().describe('Max results (default 20).'),
    },
    async ({ q, limit }: { q: string; limit?: number }) => {
      try {
        const params = new URLSearchParams({ q });
        if (limit) params.set('limit', String(limit));
        const results = await apiGet(apiUrl, apiToken, `/agent-memory/search?${params}`);
        return toolResult(JSON.stringify(results, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_list_memories',
    'List stored agent memories, optionally filtered by kind.',
    {
      kind: z.string().optional().describe('Filter by kind: fact, preference, decision, note, contact, project.'),
      limit: z.number().optional().describe('Max results (default 50).'),
    },
    async ({ kind, limit }: { kind?: string; limit?: number }) => {
      try {
        const params = new URLSearchParams();
        if (kind) params.set('kind', kind);
        if (limit) params.set('limit', String(limit));
        const query = params.toString() ? `?${params}` : '';
        const results = await apiGet(apiUrl, apiToken, `/agent-memory${query}`);
        return toolResult(JSON.stringify(results, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_forget_memory',
    'Delete a memory entry by its ID. Use when information is outdated or incorrect.',
    { id: z.string().describe('The memory entry UUID to delete.') },
    async ({ id }: { id: string }) => {
      try {
        await apiDelete(apiUrl, apiToken, `/agent-memory/${id}`);
        return toolResult(`Memory ${id} deleted.`);
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_update_memory',
    `Edit an existing memory entry's content, kind, or tags in place. Use when a stored memory is outdated, incomplete, or miscategorized rather than deleting and re-creating it.

At least one of content/kind/tags must be provided; omitted fields are left unchanged.`,
    {
      id: z.string().describe('The memory entry ID to update.'),
      content: z.string().optional().describe('New content to replace the existing text.'),
      kind: z.string().optional().describe('New category: fact, preference, decision, note, contact, project.'),
      tags: z.array(z.string()).optional().describe('New tags (replaces the existing tag list).'),
    },
    async ({ id, ...patch }: { id: string; content?: string; kind?: string; tags?: string[] }) => {
      try {
        const result = await apiPatch(apiUrl, apiToken, `/agent-memory/${id}`, patch);
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_verify_memory',
    `Record a machine confirmation for a memory, or non-destructively deprecate it.

The server assigns the fixed agent identity; callers cannot supply or forge a human actor. Use action="verify" after confirming a fact in conversation, or action="deprecate" when the fact should remain auditable but stop being active.`,
    {
      id: z.string().describe('The memory entry ID to verify or deprecate.'),
      action: z.enum(['verify', 'deprecate']).describe('Lifecycle action to record.'),
      staleAfter: z.string().optional().describe(
        'For verify only: replacement shelf-life boundary in YYYY-MM-DD form.',
      ),
    },
    async ({
      id,
      action,
      staleAfter,
    }: {
      id: string;
      action: 'verify' | 'deprecate';
      staleAfter?: string;
    }) => {
      try {
        const result = await apiPost(
          apiUrl,
          apiToken,
          `/agent-memory/${id}/agent-lifecycle`,
          { action, staleAfter },
        );
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) { return toolError(err); }
    },
  );
}
