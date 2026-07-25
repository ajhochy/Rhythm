/**
 * MCP tools for Persistent Agent Memory (Feature C).
 *
 * rhythm_remember_memory  — Store a fact, note, or preference in agent memory
 * rhythm_search_memory    — Full-text search over stored memories
 * rhythm_forget_memory    — Delete a memory entry by ID
 * rhythm_list_memories    — List recent memories (optional kind filter)
 * rhythm_update_memory    — Edit an existing memory's content/kind/tags (#862)
 *
 * #804 — these tools target the LOCAL agent server (RHYTHM_AGENT_URL, default
 * http://localhost:4001), NOT the prod Settings URL. Memory is vault-first with a
 * local SQLite-derived index on :4001 — the same store the Flutter memory UI
 * reads. They are registered with RHYTHM_AGENT_URL in index.ts; never couple
 * this base to serverConfig.url (dual-endpoint rule).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  toolResult,
  toolError,
} from "../api_client.js";
import { registerTool } from "./_tool.js";
import {
  authorizeOutboundAction,
  scanContextContentAndRecordExternalContentTaint,
} from "../security/external_content_boundary.js";
import { trustedSecurityContext } from "../security/security_context.js";

/** `apiUrl` is the local agent base (RHYTHM_AGENT_URL); see file header (#804). */
export function registerAgentMemoryTools(
  server: McpServer,
  apiUrl: string,
  apiToken: string,
) {
  registerTool(
    server,
    "rhythm_remember_memory",
    `Store a piece of information in persistent agent memory. Use this to preserve facts, user preferences, decisions, or any information that should survive across agent sessions.

kind: "fact" | "preference" | "decision" | "note" | "contact" | "project" (default: "fact")
source: where this came from, e.g. "conversation", "research", "task:<id>" (default: "conversation")
tags: optional array of string tags for later filtering`,
    {
      content: z.string().describe("The information to remember."),
      kind: z
        .string()
        .optional()
        .describe(
          "Category: fact, preference, decision, note, contact, project.",
        ),
      source: z.string().optional().describe("Where this came from."),
      sourceId: z
        .string()
        .optional()
        .describe("ID of the source object if applicable."),
      tags: z.array(z.string()).optional().describe("Tags for filtering."),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (args: Record<string, unknown>, extra) => {
      const { approval_id, ...payload } = args;
      const gate = await authorizeOutboundAction({
        agentUrl: apiUrl,
        context: trustedSecurityContext(extra),
        approvalId: typeof approval_id === "string" ? approval_id : undefined,
        action: "memory.remember",
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [
            { type: "text" as const, text: gate.refusalMessage as string },
          ],
          isError: true as const,
        };
      }
      try {
        const result = await apiPost(
          apiUrl,
          apiToken,
          "/agent-memory",
          payload,
        );
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_search_memory",
    "Search persistent agent memory using full-text search. Returns the most relevant stored facts/notes matching the query.",
    {
      q: z.string().describe("Search query."),
      limit: z.number().optional().describe("Max results (default 20)."),
    },
    async ({ q, limit }: { q: string; limit?: number }, extra) => {
      try {
        const params = new URLSearchParams({ q });
        if (limit) params.set("limit", String(limit));
        const results = await apiGet(
          apiUrl,
          apiToken,
          `/agent-memory/search?${params}`,
        );
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl: apiUrl,
          context: trustedSecurityContext(extra),
          source: "memory.search",
          label: "user-authored agent memory search results",
          rawContent: JSON.stringify(results, null, 2),
        });
        return ingress.blocked
          ? {
              content: [{ type: "text" as const, text: ingress.text }],
              isError: true as const,
            }
          : toolResult(ingress.text);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_list_memories",
    "List stored agent memories, optionally filtered by kind.",
    {
      kind: z
        .string()
        .optional()
        .describe(
          "Filter by kind: fact, preference, decision, note, contact, project.",
        ),
      limit: z.number().optional().describe("Max results (default 50)."),
    },
    async ({ kind, limit }: { kind?: string; limit?: number }, extra) => {
      try {
        const params = new URLSearchParams();
        if (kind) params.set("kind", kind);
        if (limit) params.set("limit", String(limit));
        const query = params.toString() ? `?${params}` : "";
        const results = await apiGet(apiUrl, apiToken, `/agent-memory${query}`);
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl: apiUrl,
          context: trustedSecurityContext(extra),
          source: "memory.list",
          label: "user-authored agent memories",
          rawContent: JSON.stringify(results, null, 2),
        });
        return ingress.blocked
          ? {
              content: [{ type: "text" as const, text: ingress.text }],
              isError: true as const,
            }
          : toolResult(ingress.text);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_forget_memory",
    "Delete a memory entry by its ID. Use when information is outdated or incorrect.",
    {
      id: z.string().describe("The memory entry UUID to delete."),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      { id, approval_id }: { id: string; approval_id?: string },
      extra,
    ) => {
      const gate = await authorizeOutboundAction({
        agentUrl: apiUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "memory.forget",
        payload: { id },
      });
      if (!gate.allowed) {
        return {
          content: [
            { type: "text" as const, text: gate.refusalMessage as string },
          ],
          isError: true as const,
        };
      }
      try {
        await apiDelete(apiUrl, apiToken, `/agent-memory/${id}`);
        return toolResult(`Memory ${id} deleted.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_update_memory",
    `Edit an existing memory entry's content, kind, or tags in place. Use when a stored memory is outdated, incomplete, or miscategorized rather than deleting and re-creating it.

At least one of content/kind/tags must be provided; omitted fields are left unchanged.`,
    {
      id: z.string().describe("The memory entry ID to update."),
      content: z
        .string()
        .optional()
        .describe("New content to replace the existing text."),
      kind: z
        .string()
        .optional()
        .describe(
          "New category: fact, preference, decision, note, contact, project.",
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe("New tags (replaces the existing tag list)."),
    },
    async ({
      id,
      ...patch
    }: {
      id: string;
      content?: string;
      kind?: string;
      tags?: string[];
    }) => {
      try {
        const result = await apiPatch(
          apiUrl,
          apiToken,
          `/agent-memory/${id}`,
          patch,
        );
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
