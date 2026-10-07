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
import {
  currentTrustedSecurityCall,
  trustedSecurityContext,
} from "../security/security_context.js";

function boundedReferenceEnvelope(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const sourceReferences = record.references;
  if (!Array.isArray(sourceReferences)) return value;
  const references = [...sourceReferences];
  const envelope = () => ({
    ...record,
    references,
    returned: references.length,
    truncated: references.length < sourceReferences.length || record.truncated === true,
  });
  // Reserve room for ingress framing and fenced MCP output; never truncate JSON.
  while (references.length > 0 && JSON.stringify(envelope()).length > 3_800) references.pop();
  return envelope();
}

/** `apiUrl` is the local agent base (RHYTHM_AGENT_URL); see file header (#804). */
export function registerAgentMemoryTools(
  server: McpServer,
  apiUrl: string,
  apiToken: string,
  options: {
    /** Legacy test-only fixed managed path. Never enable this process-wide. */
    managedMemorySearch?: boolean;
    /** Shared-process per-call selector used by ordinary and managed sessions. */
    managedMemorySelector?: boolean;
  } = {},
) {
  registerTool(
    server,
    "rhythm_remember_memory",
    `Store a piece of information in persistent agent memory. Use this to preserve facts, user preferences, decisions, or any information that should survive across agent sessions.

kind: "fact" | "preference" | "decision" | "note" | "contact" | "project" (default: "fact")
source: where this came from, e.g. "conversation", "research", "task:<id>" (default: "conversation")
sessionId: when the fact came from an agent session, stamps a stable rhythm://agent-session source
links: optional links to related memory notes as { target, label? } objects
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
      sessionId: z
        .string()
        .optional()
        .describe(
          "Originating agent-session ID; automatically recorded as an OKF source.",
        ),
      sdkSessionId: z
        .string()
        .optional()
        .describe(
          "Reserved runtime field. Rhythm overwrites this from authoritative execution context.",
        ),
      sources: z
        .array(
          z
            .object({
              id: z.string(),
              resource: z.string().optional(),
              title: z.string().optional(),
              author: z.string().optional(),
              usage_count: z.number().optional(),
              last_modified: z.string().optional(),
            })
            .passthrough(),
        )
        .optional()
        .describe(
          "Optional per-claim OKF sources. Each entry requires a unique id.",
        ),
      usageWindow: z
        .object({
          from: z.string().optional(),
          to: z.string().optional(),
        })
        .passthrough()
        .optional()
        .describe(
          "Optional OKF usage window with YYYY-MM-DD from/to fields.",
        ),
      links: z
        .array(
          z.object({
            target: z.string(),
            label: z.string().optional(),
          }),
        )
        .optional()
        .describe(
          "Optional links to existing memory notes. Rhythm stores resolved links as absolute bundle-relative markdown.",
        ),
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
    "Search persistent agent memory for bounded native-ranked references. Results are uncertain evidence (confidence is not calibrated); request a full permitted note separately when needed.",
    {
      q: z.string().describe("Search query."),
      limit: z.number().int().min(0).max(5).optional().describe("Max references (default 3, maximum 5)."),
    },
    async ({ q, limit }: { q: string; limit?: number }, extra) => {
      try {
        const managedResponse = async (value: unknown): Promise<{
          schemaVersion: 1;
          blocked: boolean;
          text: string;
        }> => {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("managed memory-search response is invalid");
          }
          const response = value as Record<string, unknown>;
          if (
            Object.keys(response).length !== 3 ||
            response.schemaVersion !== 1 ||
            typeof response.blocked !== "boolean" ||
            typeof response.text !== "string" ||
            response.text.length === 0 ||
            Buffer.byteLength(response.text, "utf8") > 12_000
          ) throw new Error("managed memory-search response is invalid");
          return {
            schemaVersion: 1,
            blocked: response.blocked as boolean,
            text: response.text as string,
          };
        };
        if (options.managedMemorySelector === true) {
          const trustedCall = currentTrustedSecurityCall();
          // The selector needs the engine-signed ALS proof to decide whether
          // this exact call belongs to an enrolled managed dispatch.  A missing
          // proof is not a safe reason to take the legacy path.
          if (!trustedCall) throw new Error("trusted memory-search call is unavailable");
          const selected = await apiPost(
            apiUrl,
            apiToken,
            "/agent-memory/search-select",
            { trustedCall },
          );
          if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
            throw new Error("memory-search selector response is invalid");
          }
          const selection = selected as Record<string, unknown>;
          if (selection.schemaVersion !== 1 || typeof selection.mode !== "string") {
            throw new Error("memory-search selector response is invalid");
          }
          if (selection.mode === "managed") {
            if (Object.keys(selection).length !== 3) {
              throw new Error("memory-search selector response is invalid");
            }
            const response = await managedResponse(selection.response);
            return response.blocked
              ? {
                  content: [{ type: "text" as const, text: response.text }],
                  isError: true as const,
                }
              : toolResult(response.text);
          }
          if (selection.mode !== "ordinary" || Object.keys(selection).length !== 2) {
            throw new Error("memory-search selector response is invalid");
          }
        }
        if (options.managedMemorySearch === true) {
          const trustedCall = currentTrustedSecurityCall();
          if (!trustedCall) throw new Error("trusted managed memory-search call is unavailable");
          const response = await managedResponse(await apiPost(
            apiUrl,
            apiToken,
            "/agent-memory/search-managed",
            { trustedCall },
          ));
          return response.blocked
            ? {
                content: [{ type: "text" as const, text: response.text }],
                isError: true as const,
              }
            : toolResult(response.text);
        }
        const params = new URLSearchParams({ q, view: "references" });
        if (limit !== undefined) params.set("limit", String(limit));
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
          rawContent: JSON.stringify(boundedReferenceEnvelope(results)),
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
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      {
        id,
        approval_id,
        ...patch
      }: {
        id: string;
        content?: string;
        kind?: string;
        tags?: string[];
        approval_id?: string;
      },
      extra,
    ) => {
      const payload = { id, ...patch };
      const gate = await authorizeOutboundAction({
        agentUrl: apiUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "memory.update",
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

  registerTool(server, 'rhythm_verify_memory',
    `Record a machine confirmation for a memory, or non-destructively deprecate it.

The server assigns the fixed agent identity; callers cannot supply or forge a human actor. Each successful change appends actor, timestamp, prior state, source context, and rollback target to the memory audit history. Use action="verify" after confirming a fact in conversation, or action="deprecate" when the fact should remain auditable but stop being active.`,
    {
      id: z.string().describe('The memory entry ID to verify or deprecate.'),
      action: z.enum(['verify', 'deprecate']).describe('Lifecycle action to record.'),
      staleAfter: z.string().optional().describe(
        'For verify only: replacement shelf-life boundary in YYYY-MM-DD form.',
      ),
      approval_id: z.string().optional().describe(
        'Approval id returned by rhythm_request_approval — required after reading untrusted content.',
      ),
    },
    async (
      {
        id,
        action,
        staleAfter,
        approval_id,
      }: {
        id: string;
        action: 'verify' | 'deprecate';
        staleAfter?: string;
        approval_id?: string;
      },
      extra,
    ) => {
      const payload = { id, action, staleAfter };
      const gate = await authorizeOutboundAction({
        agentUrl: apiUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: 'memory.lifecycle',
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [
            { type: 'text' as const, text: gate.refusalMessage as string },
          ],
          isError: true as const,
        };
      }
      try {
        const result = await apiPost(
          apiUrl,
          apiToken,
          `/agent-memory/${id}/agent-lifecycle`,
          { action, staleAfter },
        );
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
