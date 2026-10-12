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
import { currentTrustedSecurityCall, trustedSecurityContext } from "../security/security_context.js";

/** Subset of the session row the consolidation read needs. */
interface AgentSessionLite {
  id: string;
  name: string;
  agentKind: string;
  lastActivityAt: string | null;
  status?: string;
  parentSessionId?: string | null;
  sdkSessionId?: string;
  hasChildren?: boolean;
  childCount?: number;
  runningChildCount?: number;
}

/** Subset of a session message the consolidation read needs (includes body). */
interface AgentSessionMessageLite {
  id: number;
  role: string;
  body: string;
  createdAt: string;
}

function pickSession(
  s: Record<string, unknown>,
  options: { includeSdkSessionId?: boolean } = {},
): AgentSessionLite {
  return {
    id: String(s.id ?? ""),
    name: typeof s.name === "string" ? s.name : "",
    agentKind: typeof s.agentKind === "string" ? s.agentKind : "",
    lastActivityAt:
      typeof s.lastActivityAt === "string" ? s.lastActivityAt : null,
    ...(typeof s.status === "string" ? { status: s.status } : {}),
    ...(typeof s.parentSessionId === "string" || s.parentSessionId === null
      ? { parentSessionId: s.parentSessionId as string | null }
      : {}),
    ...(options.includeSdkSessionId && typeof s.sdkSessionId === "string"
      ? { sdkSessionId: s.sdkSessionId }
      : {}),
    ...(typeof s.hasChildren === "boolean" ? { hasChildren: s.hasChildren } : {}),
    ...(Number.isSafeInteger(s.childCount) && Number(s.childCount) >= 0
      ? { childCount: Number(s.childCount) }
      : {}),
    ...(Number.isSafeInteger(s.runningChildCount) && Number(s.runningChildCount) >= 0
      ? { runningChildCount: Number(s.runningChildCount) }
      : {}),
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

const CURRENT_WORK_MAX_SESSIONS = 100;
const CURRENT_WORK_MAX_DEPTH = 6;
const RECENT_PAGE_LIMIT = 25;

interface SessionPage {
  sessions?: unknown[];
  ancestors?: unknown[];
  pageInfo?: {
    limit?: number;
    hasMore?: boolean;
    nextCursor?: string | null;
    expiresAt?: string;
  };
}

function pageInfo(page: SessionPage): Record<string, unknown> {
  return {
    limit: Number.isSafeInteger(page.pageInfo?.limit) ? page.pageInfo?.limit : RECENT_PAGE_LIMIT,
    hasMore: page.pageInfo?.hasMore === true,
    nextCursor: typeof page.pageInfo?.nextCursor === "string" ? page.pageInfo.nextCursor : null,
    ...(typeof page.pageInfo?.expiresAt === "string" ? { expiresAt: page.pageInfo.expiresAt } : {}),
  };
}

function sessionPagePath(options: {
  limit: number;
  search?: string;
  cursor?: string;
  parentId?: string;
  projectId?: string | null;
}): string {
  const params = new URLSearchParams({ scope: "chats", limit: String(options.limit) });
  if (options.search !== undefined) params.set("search", options.search);
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  if (options.parentId !== undefined) params.set("parentId", options.parentId);
  if (options.projectId !== undefined) params.set("projectId", options.projectId ?? "null");
  return `/agent-sessions?${params.toString()}`;
}

function projectIdOf(value: unknown): string | null | undefined {
  if (!value || typeof value !== "object") return undefined;
  const projectId = (value as Record<string, unknown>).projectId;
  return typeof projectId === "string" ? projectId : projectId === null ? null : undefined;
}

async function readCurrentWork(
  agentUrl: string,
  agentToken: string,
  sdkSessionId: string | null,
): Promise<{
  state: "available" | "caller_unavailable" | "read_failed";
  sessions: AgentSessionLite[];
  truncated: boolean;
  hasMore: boolean;
  maxDepth: number;
  maxSessions: number;
}> {
  const result = {
    state: "caller_unavailable" as "available" | "caller_unavailable" | "read_failed",
    sessions: [] as AgentSessionLite[],
    truncated: false,
    hasMore: false,
    maxDepth: CURRENT_WORK_MAX_DEPTH,
    maxSessions: CURRENT_WORK_MAX_SESSIONS,
  };
  if (!sdkSessionId) return result;

  try {
    const callerPage = await apiGet<SessionPage>(
      agentUrl,
      agentToken,
      sessionPagePath({ limit: RECENT_PAGE_LIMIT, search: sdkSessionId }),
    );
    const caller = (Array.isArray(callerPage?.sessions) ? callerPage.sessions : [])
      .find((row) => row && typeof row === "object" &&
        (row as Record<string, unknown>).sdkSessionId === sdkSessionId) as Record<string, unknown> | undefined;
    if (!caller || typeof caller.id !== "string" || caller.id.length === 0) return result;

    result.state = "available";
    const projectId = projectIdOf(caller);
    const seen = new Set<string>();
    const callerLite = pickSession(caller, { includeSdkSessionId: true });
    result.sessions.push(callerLite);
    seen.add(callerLite.id);
    let frontier: Array<{ id: string; depth: number }> = [{ id: callerLite.id, depth: 0 }];

    while (frontier.length > 0 && result.sessions.length < CURRENT_WORK_MAX_SESSIONS) {
      const nextFrontier: Array<{ id: string; depth: number }> = [];
      for (const parent of frontier) {
        const parentRow = result.sessions.find((session) => session.id === parent.id);
        if (parentRow?.childCount === 0 || parentRow?.hasChildren === false) continue;
        if (parent.depth >= CURRENT_WORK_MAX_DEPTH) {
          if (parentRow?.hasChildren || (parentRow?.childCount ?? 0) > 0) {
            result.truncated = true;
            result.hasMore = true;
          }
          continue;
        }
        if (result.sessions.length >= CURRENT_WORK_MAX_SESSIONS) {
          result.truncated = true;
          result.hasMore = true;
          break;
        }
        const remaining = CURRENT_WORK_MAX_SESSIONS - result.sessions.length;
        const childPage = await apiGet<SessionPage>(
          agentUrl,
          agentToken,
          sessionPagePath({
            limit: Math.min(remaining, 100),
            parentId: parent.id,
            ...(projectId !== undefined ? { projectId } : {}),
          }),
        );
        const children = Array.isArray(childPage?.sessions) ? childPage.sessions : [];
        if (childPage?.pageInfo?.hasMore === true) {
          result.truncated = true;
          result.hasMore = true;
        }
        for (const value of children) {
          if (!value || typeof value !== "object") continue;
          const child = value as Record<string, unknown>;
          if (child.parentSessionId !== parent.id || typeof child.id !== "string" ||
              child.id.length === 0 || seen.has(child.id)) continue;
          if (projectId !== undefined && projectIdOf(child) !== projectId) continue;
          if (result.sessions.length >= CURRENT_WORK_MAX_SESSIONS) {
            result.truncated = true;
            result.hasMore = true;
            break;
          }
          seen.add(child.id);
          result.sessions.push(pickSession(child, { includeSdkSessionId: true }));
          if (parent.depth < CURRENT_WORK_MAX_DEPTH) {
            nextFrontier.push({ id: child.id, depth: parent.depth + 1 });
          } else if (child.hasChildren === true || Number(child.childCount) > 0) {
            result.truncated = true;
            result.hasMore = true;
          }
        }
      }
      frontier = nextFrontier;
    }
    if (frontier.length > 0 && result.sessions.length >= CURRENT_WORK_MAX_SESSIONS) {
      result.truncated = true;
      result.hasMore = true;
    }
  } catch {
    result.state = "read_failed";
    result.truncated = true;
    result.hasMore = true;
  }
  return result;
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
    `List recent sessions and, by default, bounded work under the current caller, or search/paginate session history. Session status and parentage help you locate nested blockers; an incomplete currentWork result is explicitly marked and must not be treated as proof that no other work exists.

Without search: returns a recent page (default 25, maximum 25) and currentWork for the session identified by trusted caller metadata. currentWork is capped at 100 sessions and depth 6; inspect its state, truncated, and hasMore fields.
With search: returns matching sessions plus visible ancestors and pageInfo; pass cursor from pageInfo.nextCursor to continue. With sessionId: returns that session's messages (id, role, body, createdAt).

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
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Message page size (up to 500); session-list pages are capped at 25 (default: 25)."),
      search: z.string().max(500).optional().describe("Literal session history search; results are owner-scoped and include visible ancestors."),
      cursor: z.string().max(256).optional().describe("History page cursor returned by pageInfo.nextCursor."),
    },
    async (
      { sessionId, limit, search, cursor }: { sessionId?: string; limit?: number; search?: string; cursor?: string },
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
          const normalizedSearch = typeof search === "string" ? search.trim() : "";
          const res = await apiGet<SessionPage>(
            agentUrl,
            agentToken,
            sessionPagePath({
              limit: Math.min(limit ?? RECENT_PAGE_LIMIT, RECENT_PAGE_LIMIT),
              ...(normalizedSearch ? { search: normalizedSearch } : {}),
              ...(cursor !== undefined ? { cursor } : {}),
            }),
          );
          const matches = Array.isArray(res?.sessions) ? flattenSessions(res.sessions) : [];
          const ancestors = Array.isArray(res?.ancestors) ? res.ancestors : [];
          const uniqueRows = new Map<string, Record<string, unknown>>();
          for (const value of [...ancestors, ...matches]) {
            if (!value || typeof value !== "object") continue;
            const row = value as Record<string, unknown>;
            if (typeof row.id === "string" && !uniqueRows.has(row.id)) uniqueRows.set(row.id, row);
          }
          const sessions = [...uniqueRows.values()].map((row) => pickSession(row));
          if (normalizedSearch) {
            result = { sessions, pageInfo: pageInfo(res) };
          } else {
            const context = trustedSecurityContext(extra);
            const currentWork = await readCurrentWork(agentUrl, agentToken, context?.sdkSessionId ?? null);
            result = { sessions, pageInfo: pageInfo(res), currentWork };
          }
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
        approval_id,
      }: {
        sessionId: string;
        prompt: string;
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
        // ponytail: the target's stored profile always applies; no per-turn agent override.
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
        const trustedCall = currentTrustedSecurityCall();
        if (!trustedCall) return toolError(new Error('Trusted MCP call is unavailable'));
        const result = await apiPost(
          agentUrl,
          agentToken,
          `/agent-sessions/${encodeURIComponent(sessionId)}/prompt`,
          { trustedCall },
        );
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
