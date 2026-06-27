/**
 * MCP tools for Persistent Agent Memory (Feature C).
 *
 * rhythm_remember_memory  — Store a fact, note, or preference in agent memory
 * rhythm_search_memory    — Full-text search over stored memories
 * rhythm_forget_memory    — Delete a memory entry by ID
 * rhythm_list_memories    — List recent memories (optional kind filter)
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiDelete, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerAgentMemoryTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_remember_memory',
    `Store a piece of information in persistent agent memory. Use this to preserve facts, user preferences, decisions, or any information that should survive across agent sessions.

kind: "fact" | "preference" | "decision" | "note" | "contact" | "project" (default: "fact")
source: where this came from, e.g. "conversation", "research", "task:<id>" (default: "conversation")
tags: optional array of string tags for later filtering`,
    {
      content: z.string().describe('The information to remember.'),
      kind: z.string().optional().describe('Category: fact, preference, decision, note, contact, project.'),
      source: z.string().optional().describe('Where this came from.'),
      sourceId: z.string().optional().describe('ID of the source object if applicable.'),
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
}
