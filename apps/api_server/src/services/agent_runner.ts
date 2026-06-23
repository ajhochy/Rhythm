/**
 * AgentRunner — #738
 *
 * Thin orchestration wrapper over OpencodeClientService:
 *  1. Creates an opencode session (with optional role/mcp scoping)
 *  2. Calls promptAsync() to fire the prompt (non-blocking enqueue)
 *  3. Polls the session message list via the SDK until the assistant replies
 *     or a timeout fires
 *  4. Returns { sessionId, result, status }
 *
 * Concurrency cap: MAX_CONCURRENT_AGENT_RUNS (env, default 3)
 * Per-run timeout:  AGENT_RUN_TIMEOUT_MS      (env, default 600 000 ms)
 *
 * outputTarget (default 'session'):
 *   'session'      — leave result in the opencode session; no extra I/O
 *   'task_notes'   — PATCH the named task's notes with `result` (requires taskId)
 *   'notification' — TODO: POST to notifications path (best-effort; no-op for now)
 */

import { opencodeClient } from './opencode_engine';
import { logger } from '../utils/logger';

// ── Environment caps (read per-call so tests can override via process.env) ────

function getMaxConcurrentRuns(): number {
  return Number(process.env.MAX_CONCURRENT_AGENT_RUNS ?? 3);
}

function getRunTimeoutMs(): number {
  return Number(process.env.AGENT_RUN_TIMEOUT_MS ?? 600_000);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentRunOptions {
  prompt: string;
  /** Raw JSON string of allowed MCP tools (same shape as agent_sessions.allowed_mcps_json) */
  allowedMcpsJson?: string | null;
  /** MCP role slug (e.g. 'email-assistant') — parsed from .mcp-roles/<slug>.mcp.json */
  mcpRole?: string;
  /** Working directory for the opencode session */
  cwd?: string;
  /** Rhythm task ID for 'task_notes' delivery */
  taskId?: string | null;
  /** Where to deliver the agent result (default: 'session') */
  outputTarget?: 'session' | 'notification' | 'task_notes';
}

export interface AgentRunResult {
  sessionId: string;
  result: string;
  status: 'done' | 'error';
  error?: string;
}

// ── In-process concurrency gate ───────────────────────────────────────────────

const _activeRuns = new Set<string>();

function _acquireSlot(id: string): boolean {
  if (_activeRuns.size >= getMaxConcurrentRuns()) return false;
  _activeRuns.add(id);
  return true;
}

function _releaseSlot(id: string): void {
  _activeRuns.delete(id);
}

// Exported for testing only
export function _activeRunCount(): number {
  return _activeRuns.size;
}

// ── Prompt result extraction ──────────────────────────────────────────────────

/**
 * Poll the session's message list until we find an assistant message newer than
 * `afterTimestamp`, or until `deadline` is reached.
 *
 * Strategy: the SDK `session.messages` endpoint returns all messages in the
 * session ordered by time. We wait for a message whose `role === 'assistant'`
 * and whose `time.created` is >= our prompt submission time. This is simpler
 * than subscribing to SSE inside a background runner where we don't have a live
 * HTTP connection to stream from.
 *
 * Poll interval: 500 ms — low enough to be responsive, high enough to avoid
 * flooding the local opencode process.
 */
async function _waitForAssistantReply(
  sessionId: string,
  afterTimestamp: number,
  deadline: number,
): Promise<string | null> {
  const POLL_INTERVAL_MS = 500;

  while (Date.now() < deadline) {
    try {
      const messages = await opencodeClient.listMessages(sessionId);
      // Find the last assistant message created after our prompt was sent
      const assistantMessages = messages.filter(
        (m) =>
          m.role === 'assistant' &&
          (m.time?.created ?? 0) >= afterTimestamp,
      );
      if (assistantMessages.length > 0) {
        const last = assistantMessages[assistantMessages.length - 1];
        // Extract text from parts — SDK Part is a discriminated union; pick type='text'
        const textParts = (last.parts ?? []).filter(
          (p): p is import('@opencode-ai/sdk').TextPart => p.type === 'text',
        );
        if (textParts.length > 0) {
          return textParts.map((p) => p.text).join('\n').trim();
        }
        // Non-text assistant turn (tool calls only) — keep waiting
      }
    } catch {
      // listMessages throws on SDK error — swallow transient errors and retry
    }

    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return null; // timeout
}

// ── Main run function ─────────────────────────────────────────────────────────

export async function run(opts: AgentRunOptions): Promise<AgentRunResult> {
  const {
    prompt,
    allowedMcpsJson,
    mcpRole,
    cwd,
    taskId,
    outputTarget = 'session',
  } = opts;

  // Unique slot key for concurrency tracking
  const slotKey = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (!_acquireSlot(slotKey)) {
    const msg = `AgentRunner: concurrency cap (${getMaxConcurrentRuns()}) reached — rejecting run`;
    logger.warn(`[AgentRunner] ${msg}`);
    return {
      sessionId: '',
      result: '',
      status: 'error',
      error: msg,
    };
  }

  const deadline = Date.now() + getRunTimeoutMs();

  try {
    // ── Build mcpRoleConfig if allowedMcpsJson is provided without a role slug ──
    let mcpRoleConfig:
      | { role: string; mcpServers: Record<string, unknown>; allowedToolsJson: string }
      | undefined;

    if (mcpRole) {
      // Role slug provided — build a minimal config object; the sessions
      // controller does the full file-system resolution; here we trust the
      // caller already has the allowedMcpsJson from the scheduled task row.
      mcpRoleConfig = {
        role: mcpRole,
        mcpServers: allowedMcpsJson ? _parseMcpServersFromJson(allowedMcpsJson) : {},
        allowedToolsJson: allowedMcpsJson ?? '{}',
      };
    } else if (allowedMcpsJson) {
      // No explicit role slug but explicit allowed tools — create an anonymous config
      mcpRoleConfig = {
        role: 'scheduled-task',
        mcpServers: _parseMcpServersFromJson(allowedMcpsJson),
        allowedToolsJson: allowedMcpsJson,
      };
    }

    // ── Create session ────────────────────────────────────────────────────────
    const sessionResult = await opencodeClient.createSession(
      'agent-runner',
      cwd,
      mcpRoleConfig,
    );

    if (!sessionResult?.id) {
      return {
        sessionId: '',
        result: '',
        status: 'error',
        error: 'AgentRunner: failed to create opencode session',
      };
    }

    const sessionId = sessionResult.id;
    const promptSentAt = Date.now();

    // ── Fire prompt ───────────────────────────────────────────────────────────
    const enqueued = await opencodeClient.promptAsync(sessionId, prompt, undefined, cwd);
    if (!enqueued) {
      return {
        sessionId,
        result: '',
        status: 'error',
        error: 'AgentRunner: promptAsync returned false (prompt not accepted)',
      };
    }

    // ── Wait for completion with timeout ──────────────────────────────────────
    let aborted = false;
    const timeoutHandle = setTimeout(async () => {
      aborted = true;
      await opencodeClient.abortSession(sessionId, cwd);
    }, Math.max(0, deadline - Date.now()));

    let resultText: string | null = null;
    try {
      resultText = await _waitForAssistantReply(sessionId, promptSentAt, deadline);
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (aborted || resultText === null) {
      const errMsg = 'AgentRunner: run timed out';
      logger.warn(`[AgentRunner] session ${sessionId} timed out`);
      return {
        sessionId,
        result: '',
        status: 'error',
        error: errMsg,
      };
    }

    // ── Output delivery ───────────────────────────────────────────────────────
    if (outputTarget === 'task_notes' && taskId) {
      await _deliverToTaskNotes(taskId, resultText).catch((err) => {
        logger.warn(`[AgentRunner] task_notes delivery failed for task ${taskId}: ${String(err)}`);
      });
    } else if (outputTarget === 'notification') {
      // TODO: POST to notifications path once the endpoint shape is finalised
      logger.info(`[AgentRunner] notification delivery is a no-op (TODO)`);
    }
    // 'session' path: nothing extra to do — result lives in the opencode session

    logger.info(`[AgentRunner] session ${sessionId} completed (outputTarget=${outputTarget})`);
    return {
      sessionId,
      result: resultText,
      status: 'done',
    };
  } catch (err) {
    const errMsg = String(err);
    logger.error(`[AgentRunner] unexpected error: ${errMsg}`);
    return {
      sessionId: '',
      result: '',
      status: 'error',
      error: errMsg,
    };
  } finally {
    _releaseSlot(slotKey);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse allowedMcpsJson (a per-server tool-allowlist map) into the mcpServers
 * shape expected by createSession's mcpRoleConfig.
 *
 * Input: '{"rhythm":["rhythm_list_tasks"],"github":["github_list_repos"]}'
 * Output: { rhythm: { allowedTools: ['rhythm_list_tasks'] }, github: { allowedTools: [...] } }
 */
function _parseMcpServersFromJson(allowedMcpsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(allowedMcpsJson) as Record<string, unknown>;
    const mcpServers: Record<string, unknown> = {};
    for (const [serverName, tools] of Object.entries(parsed)) {
      if (Array.isArray(tools)) {
        mcpServers[serverName] = { allowedTools: tools };
      } else {
        // Already in expanded form (e.g. { allowedTools: [...] }) — pass through
        mcpServers[serverName] = tools;
      }
    }
    return mcpServers;
  } catch {
    logger.warn(`[AgentRunner] _parseMcpServersFromJson: invalid JSON — ignoring`);
    return {};
  }
}

/**
 * Best-effort PATCH of a Rhythm task's notes field.
 * Uses the production API URL from env (if configured) or falls back to localhost.
 */
async function _deliverToTaskNotes(taskId: string, text: string): Promise<void> {
  // Import lazily to avoid circular deps; env is a plain object
  const { env } = await import('../config/env');
  const baseUrl = env.prodApiUrl ?? `http://localhost:${env.port}`;
  const authToken = env.prodAuthToken;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const resp = await fetch(`${baseUrl}/tasks/${taskId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ notes: text }),
  });
  if (!resp.ok) {
    throw new Error(`PATCH /tasks/${taskId} returned ${resp.status}`);
  }
}
