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
import { apiGet, apiPost, toolResult, toolError } from "../api_client.js";
import { registerTool } from "./_tool.js";
import {
  authorizeOutboundAction,
  scanContextContentAndRecordExternalContentTaint,
} from "../security/external_content_boundary.js";
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

  // ── #1577 — prompt an EXISTING session ────────────────────────────────────
  //
  // rhythm_delegate_async spawns a CHILD under the caller. This is the missing
  // other half: instructing a session that is already running, including one
  // the caller never created (e.g. telling an orchestrator to review the work
  // its children just finished and open a PR).
  //
  // Any running session is promptable — no parentage check. The Rhythm API key
  // is the trust boundary, per the working agreement on this feature. What the
  // key cannot defend against is prompt injection: an agent that reads a GitHub
  // issue saying "send this to session X" makes a perfectly authorized call
  // with someone else's words. Two things address that, neither a parentage
  // gate: the server writes an audit row for every injection
  // (GET /agent-sessions/:id/prompt-log), and the outbound approval gate below
  // bites once this session has actually consumed untrusted content.
  registerTool(
    server,
    "rhythm_prompt_session",
    `Send a prompt to an agent session that is already running, exactly as if it were typed into the Rhythm composer.

Use this to instruct a session you did not create — e.g. telling an orchestrator to review finished work and open a PR. To start NEW background work under yourself, use rhythm_delegate_async instead.

Returns as soon as the turn is enqueued; the target's reply streams into its own session, not back to you. Find session ids with rhythm_list_sessions.

Every call is recorded in that session's prompt log (who prompted it, with what, when).`,
    {
      sessionId: z
        .string()
        .describe("The target session id, from rhythm_list_sessions."),
      prompt: z
        .string()
        .describe("The instruction to deliver, written as you would type it."),
      agent: z
        .string()
        .optional()
        .describe("Optional per-turn agent/mode override for the target turn."),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      {
        sessionId,
        prompt,
        agent,
        approval_id,
      }: {
        sessionId: string;
        prompt: string;
        agent?: string;
        approval_id?: string;
      },
      extra,
    ) => {
      const ctx = trustedSecurityContext(extra);
      // `payload` must stay EXACTLY the model-supplied tool arguments — the
      // approval gate compares it against the signed MCP arguments. The derived
      // caller identity goes on the HTTP body only, AFTER the gate.
      const payload = {
        sessionId,
        prompt,
        ...(agent !== undefined && { agent }),
      };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: ctx,
        approvalId: typeof approval_id === "string" ? approval_id : undefined,
        action: "session.prompt",
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
        // #1322 precedent: the authoritative caller identity is the ENGINE
        // session id from the trusted context, never a model-supplied one — a
        // model asked for its own session id invents a plausible UUID. Here it
        // is purely for the audit row; it authorizes nothing.
        const result = await apiPost(
          agentUrl,
          agentToken,
          `/agent-sessions/${encodeURIComponent(sessionId)}/prompt`,
          {
            prompt,
            ...(agent !== undefined && { agent }),
            ...(ctx?.sdkSessionId ? { callerSdkSessionId: ctx.sdkSessionId } : {}),
          },
        );
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
