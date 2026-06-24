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
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

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
  /**
   * #738-fix — agent_configs.id to look up a preferred model for this run.
   * When provided, resolveRunModel() checks agent_configs.model_provider +
   * model_id first before falling back to the most-recently-used session model.
   */
  agentConfigId?: string | null;
  /**
   * #738-fix — agent kind label (e.g. 'claude-code') used as the agent_kind
   * on the recorded agent_sessions row. Defaults to 'claude-code' when absent.
   */
  agentKind?: string | null;
  /**
   * #738-fix — Human-readable session name shown in the CHATS list.
   * Falls back to "AgentRunner run" when omitted.
   */
  sessionName?: string | null;
  /**
   * #738-fix — FK to agent_scheduled_tasks.id for scheduler-originated runs.
   * Null for ad-hoc/cookbook runs.
   */
  scheduledTaskId?: string | null;
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

// ── Model resolution ──────────────────────────────────────────────────────────

/**
 * #738-fix: Resolve a {providerID, modelID} pair for an agent run.
 *
 * Resolution order:
 *  1. agent_configs row with matching id → use model_provider + model_id if set.
 *  2. Most-recently-used model from agent_sessions (any session with provider_id
 *     + model_id populated, ordered by created_at DESC).
 *  3. Hardcoded sensible default: anthropic / claude-sonnet-4-5.
 *
 * The function never throws. Returns undefined only if the DB call itself
 * fails — in that case the caller should use the hardcoded default instead
 * (handled by the fallthrough to step 3).
 */
export function resolveRunModel(
  agentConfigId?: string | null,
): { providerID: string; modelID: string } {
  // Step 1 — agent config preference
  if (agentConfigId) {
    try {
      const config = new AgentConfigsRepository().getById(agentConfigId);
      if (config?.modelProvider && config?.modelId) {
        logger.info(
          `[AgentRunner] resolveRunModel: using agent config ${agentConfigId} model (${config.modelProvider}/${config.modelId})`,
        );
        return { providerID: config.modelProvider, modelID: config.modelId };
      }
    } catch (err) {
      logger.warn(`[AgentRunner] resolveRunModel: agent config lookup failed: ${String(err)}`);
    }
  }

  // Step 2 — most-recently-used from any session
  try {
    const mru = new AgentSessionsRepository().findMostRecentlyUsedModel();
    if (mru) {
      logger.info(
        `[AgentRunner] resolveRunModel: using most-recently-used model (${mru.providerID}/${mru.modelID})`,
      );
      return mru;
    }
  } catch (err) {
    logger.warn(`[AgentRunner] resolveRunModel: MRU lookup failed: ${String(err)}`);
  }

  // Step 3 — hardcoded default so a run never silently hangs on undefined
  const DEFAULT_PROVIDER = 'anthropic';
  const DEFAULT_MODEL = 'claude-sonnet-4-5';
  logger.info(
    `[AgentRunner] resolveRunModel: no agent config or MRU model found — using default (${DEFAULT_PROVIDER}/${DEFAULT_MODEL})`,
  );
  return { providerID: DEFAULT_PROVIDER, modelID: DEFAULT_MODEL };
}

// ── Session recording ─────────────────────────────────────────────────────────

/**
 * #738-fix: Record this AgentRunner run in agent_sessions so the CHATS list
 * surfaces scheduler-originated runs.
 *
 * Returns the created session id, or null if the insert fails (non-fatal —
 * the run can still proceed without a DB record).
 */
function _recordSession(opts: {
  name: string;
  agentKind: string;
  cwd: string;
  scheduledTaskId?: string | null;
  mcpRole?: string | null;
  mcpAllowedToolsJson?: string | null;
}): string | null {
  try {
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: opts.agentKind as import('../models/agent_session').AgentKind,
      taskId: null,
      taskTitle: null,
      cwd: opts.cwd,
      name: opts.name,
      projectId: null,
      mcpRole: opts.mcpRole ?? null,
      mcpAllowedToolsJson: opts.mcpAllowedToolsJson ?? null,
      scheduledTaskId: opts.scheduledTaskId ?? null,
    });
    return session.id;
  } catch (err) {
    logger.warn(`[AgentRunner] _recordSession failed (non-fatal): ${String(err)}`);
    return null;
  }
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
    agentConfigId,
    agentKind,
    sessionName,
    scheduledTaskId,
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

  // #738-fix: Resolve the model BEFORE entering the 600s poll so a missing
  // model is a fast fail rather than a silent timeout.
  const resolvedModel = resolveRunModel(agentConfigId);

  // #738-fix: Record a session row so this run appears in the CHATS list.
  const effectiveAgentKind = agentKind ?? 'claude-code';
  const effectiveName = sessionName
    ? sessionName
    : scheduledTaskId
      ? `Scheduled run`
      : `AgentRunner run`;
  const effectiveCwd = cwd ?? process.cwd();

  const rhythmSessionId = _recordSession({
    name: effectiveName,
    agentKind: effectiveAgentKind,
    cwd: effectiveCwd,
    scheduledTaskId: scheduledTaskId ?? null,
    mcpRole: mcpRole ?? null,
    mcpAllowedToolsJson: allowedMcpsJson ?? null,
  });

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
      effectiveName,
      effectiveCwd,
      mcpRoleConfig,
    );

    if (!sessionResult?.id) {
      return {
        sessionId: rhythmSessionId ?? '',
        result: '',
        status: 'error',
        error: 'AgentRunner: failed to create opencode session',
      };
    }

    const sessionId = sessionResult.id;
    const promptSentAt = Date.now();

    // ── Fire prompt — pass resolved model so opencode generates a response ────
    // #738-fix: the root cause was passing undefined here; opencode never
    // generates without a model → the 600s poll always timed out.
    const enqueued = await opencodeClient.promptAsync(sessionId, prompt, resolvedModel, cwd);
    if (!enqueued) {
      return {
        sessionId: rhythmSessionId ?? sessionId,
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
        sessionId: rhythmSessionId ?? sessionId,
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
      sessionId: rhythmSessionId ?? sessionId,
      result: resultText,
      status: 'done',
    };
  } catch (err) {
    const errMsg = String(err);
    logger.error(`[AgentRunner] unexpected error: ${errMsg}`);
    return {
      sessionId: rhythmSessionId ?? '',
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
