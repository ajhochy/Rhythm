/**
 * MCP tool for reading the LOCAL agent server's session history.
 *
 * rhythm_list_sessions — list recent agent sessions, OR (given a sessionId)
 *                        return that session's messages.
 *
 * #806 (memory epic #801) — the seeded "Memory Consolidation" task tells the
 * agent to call `rhythm_list_sessions` to read the past day's session messages
 * and distill durable facts (via rhythm_remember_memory). That tool previously
 * did not exist; this file adds it.
 *
 * This tool targets the LOCAL agent server (RHYTHM_AGENT_URL, default
 * http://localhost:4001) — the same store that owns agent sessions — NOT the
 * prod Settings URL. It is registered with RHYTHM_AGENT_URL in index.ts; never
 * couple this base to serverConfig.url (dual-endpoint rule).
 *
 * SAFETY: session contents are private. This handler never logs message bodies
 * (or any session content); it only returns them in the tool result the calling
 * agent consumes.
 *
 * Response shapes mirror the local agent server (:4001):
 *   GET /agent-sessions              → { sessions, resumable }
 *   GET /agent-sessions/:id/messages → { messages }
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, toolResult, toolError } from "../api_client.js";
import { registerTool } from "./_tool.js";
import { scanContextContentAndRecordExternalContentTaint } from "../security/external_content_boundary.js";
import { trustedSecurityContext } from "../security/security_context.js";

/** Subset of the session row the consolidation read needs. */
interface AgentSessionLite {
  id: string;
  name: string;
  agentKind: string;
  lastActivityAt: string | null;
}

/** Subset of a session message the consolidation read needs (includes body). */
interface AgentSessionMessageLite {
  id: number;
  role: string;
  body: string;
  createdAt: string;
}

function pickSession(s: Record<string, unknown>): AgentSessionLite {
  return {
    id: String(s.id ?? ""),
    name: typeof s.name === "string" ? s.name : "",
    agentKind: typeof s.agentKind === "string" ? s.agentKind : "",
    lastActivityAt:
      typeof s.lastActivityAt === "string" ? s.lastActivityAt : null,
  };
}

function flattenSessions(sessions: unknown[]): Record<string, unknown>[] {
  return sessions.flatMap((value) => {
    const session = value as Record<string, unknown>;
    const children = Array.isArray(session.children) ? session.children : [];
    return [session, ...flattenSessions(children)];
  });
}

function pickMessage(m: Record<string, unknown>): AgentSessionMessageLite {
  // Prefer the stripped (display) text; fall back to the raw text.
  const body =
    typeof m.strippedText === "string" && m.strippedText.length > 0
      ? m.strippedText
      : typeof m.rawText === "string"
        ? m.rawText
        : "";
  return {
    id: typeof m.id === "number" ? m.id : Number(m.id ?? 0),
    role: typeof m.role === "string" ? m.role : "",
    body,
    createdAt: typeof m.createdAt === "string" ? m.createdAt : "",
  };
}

/** `agentUrl` is the local agent base (RHYTHM_AGENT_URL); see file header (#806). */
export function registerAgentSessionTools(
  server: McpServer,
  agentUrl: string,
  agentToken: string,
) {
  registerTool(
    server,
    "rhythm_list_sessions",
    `List recent agent sessions, or read one session's messages.

Without arguments: returns recent agent sessions (id, name, agentKind, lastActivityAt) so you can find the ones worth reviewing.
With sessionId: returns that session's messages (id, role, body, createdAt) so you can read what happened and distill durable facts.

Used by the Memory Consolidation task to review the past day's sessions before calling rhythm_remember_memory.`,
    {
      sessionId: z
        .string()
        .optional()
        .describe(
          "When set, return this session's messages instead of the session list.",
        ),
      limit: z
        .number()
        .optional()
        .describe("Max items to return (default: server default)."),
    },
    async (
      { sessionId, limit }: { sessionId?: string; limit?: number },
      extra,
    ) => {
      try {
        let result: unknown;
        if (sessionId && sessionId.trim() !== "") {
          const params = new URLSearchParams();
          if (limit) params.set("limit", String(limit));
          const query = params.toString() ? `?${params}` : "";
          const res = await apiGet<{ messages?: unknown[] }>(
            agentUrl,
            agentToken,
            `/agent-sessions/${encodeURIComponent(sessionId)}/messages${query}`,
          );
          const messages = Array.isArray(res?.messages)
            ? res.messages.map((m) => pickMessage(m as Record<string, unknown>))
            : [];
          // SAFETY: do not log message bodies — return them only in the result.
          result = { sessionId, messages };
        } else {
          const res = await apiGet<{ sessions?: unknown[] }>(
            agentUrl,
            agentToken,
            "/agent-sessions",
          );
          const sessions = Array.isArray(res?.sessions)
            ? flattenSessions(res.sessions).map(pickSession)
            : [];
          result = { sessions };
        }
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl,
          context: trustedSecurityContext(extra),
          source: "agent-session.list",
          label: "user-authored agent sessions and messages",
          rawContent: JSON.stringify(result, null, 2),
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
}
