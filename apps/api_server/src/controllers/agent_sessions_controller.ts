import os from 'os';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import type { AgentKind, CreateAgentSessionDto, PermissionMode } from '../models/agent_session';
import { PERMISSION_MODES } from '../models/agent_session';
import { opencodeClient, opencodeSessionMap } from '../services/opencode_engine';
import { streamBridge } from '../services/opencode_stream_bridge';
import { broadcastSessionUpdated, broadcastSessionRemoved } from '../services/ws_gateway';
import { logger } from '../utils/logger';

// Legacy agentId aliases. Older Rhythm clients (and a handful of historical
// scripts) used short names. /agents/capabilities and the seed both use
// kebab-case canonical IDs; this map keeps stale clients working.
const AGENT_ID_ALIASES: Record<string, string> = {
  claude: 'claude-code',
  claudeCode: 'claude-code',
  gemini: 'gemini-cli',
  codexCli: 'codex',
};

function normalizeAgentId(id: string): string {
  return AGENT_ID_ALIASES[id] ?? id;
}

const repo = new AgentSessionsRepository();
const messagesRepo = new AgentSessionMessagesRepository();

import { gitCheckout, probeVcs } from '../services/vcs_probe';

/**
 * Expands '~' at the start of a path string to the current user's home directory.
 */
function expandHome(path: string): string {
  if (path === '~' || path.startsWith('~/')) {
    return path.replace('~', os.homedir());
  }
  return path;
}

export class AgentSessionsController {
  /**
   * OPC-M4-4 — GET /agent-sessions/agents
   *
   * Returns the SDK-reported agent list for an optional cwd, shaped as:
   *   { agents: Array<{ name, builtIn, description?, mode?, color? }> }
   *
   * Route choice: on the agent_sessions router (not a separate route file)
   * so all agent-session affordances stay under one router. Registered before
   * /:id in agent_sessions_routes.ts so Express does not treat "agents" as a
   * session id.
   *
   * When the opencode engine is not ready, returns an empty list (graceful
   * degradation) rather than 503 — the Flutter selector shows "no agents" and
   * falls back to built-ins stored locally.
   */
  async listAgents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const directory = typeof req.query.cwd === 'string' ? req.query.cwd : undefined;
      if (!opencodeClient.isReady) {
        res.json({ agents: [] });
        return;
      }
      const agents = await opencodeClient.listAgents(directory);
      res.json({ agents });
    } catch (err) {
      next(err);
    }
  }

  list(req: Request, res: Response, next: NextFunction): void {
    try {
      const projectIdParam = req.query.projectId;
      const includeArchived = req.query.includeArchived === 'true';
      const archivedOnly = req.query.archivedOnly === 'true';
      const archiveOpts = { includeArchived, archivedOnly };
      let sessions;
      if (typeof projectIdParam === 'string') {
        // Literal "null" → unassigned bucket; any other string → filter by id.
        sessions = projectIdParam === 'null'
          ? repo.listByProject(null, 100, archiveOpts)
          : repo.listByProject(projectIdParam, 100, archiveOpts);
      } else {
        sessions = repo.listAll(100, archiveOpts);
      }
      const resumable = archivedOnly ? [] : repo.listResumable();
      res.json({ sessions, resumable });
    } catch (err) {
      next(err);
    }
  }

  getOne(req: Request, res: Response, next: NextFunction): void {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      // OPC-M1-2: Return structured messages (parts parsed, tokens parsed, cost).
      // Legacy rows (parts_json IS NULL) get a synthetic [{type:'text',text:rawText}] shim.
      const messages = messagesRepo.listBySessionStructured(session.id, 200);
      res.json({ session, messages });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const { taskId, taskTitle, cwd, name } = body;

      // Accept agentId (preferred) with agentKind as a deprecated fallback.
      let agentId = body.agentId;
      if (!agentId && body.agentKind) {
        console.warn('[deprecated] agentKind is deprecated in POST /agent-sessions — use agentId instead');
        agentId = body.agentKind;
      }

      // Issue #653: agentId is REQUIRED and must NOT be the legacy
      // '__pending__' sentinel. The client must pick an agent + model before
      // creating the session (model-pick-first trigger bubble); task context
      // is delivered via a client-side composer prefill, not a deferred
      // server-side resolution.
      if (
        agentId === null ||
        agentId === undefined ||
        agentId === '' ||
        agentId === '__pending__'
      ) {
        throw AppError.badRequest(
          "agentId is required; agent-less ('__pending__') sessions are no longer supported (#653). " +
            'The client must pick a model in the trigger bubble before opening the chat.',
        );
      }
      if (typeof agentId !== 'string') {
        throw AppError.badRequest('agentId must be a non-empty string');
      }
      const normalizedAgentId = normalizeAgentId(agentId);
      const agentConfig = new AgentConfigsRepository().getById(normalizedAgentId);
      if (!agentConfig) {
        throw AppError.badRequest(`agent not configured: '${normalizedAgentId}'`);
      }
      if (!agentConfig.enabled) {
        throw AppError.badRequest(`agent disabled: '${normalizedAgentId}'`);
      }
      if (!cwd || typeof cwd !== 'string' || cwd.trim() === '') {
        throw AppError.badRequest('cwd is required and must be a non-empty string');
      }
      if (!name || typeof name !== 'string' || name.trim() === '') {
        throw AppError.badRequest('name is required and must be a non-empty string');
      }

      let resolvedTaskId: string | null = null;
      if (taskId !== undefined && taskId !== null) {
        if (typeof taskId !== 'string') {
          throw AppError.badRequest('taskId must be a string');
        }
        // Defensive FK check: the local SQLite tasks table may not contain
        // production task IDs (sync gap). Rather than let SQLite raise
        // SQLITE_CONSTRAINT_FOREIGNKEY (which becomes a 500), we probe the
        // local table and silently null out the foreign key when not found.
        // task_title is preserved so the UI still shows context.
        try {
          new TasksRepository().findByIdIncludingLegacy(taskId);
          resolvedTaskId = taskId;
        } catch {
          logger.warn(
            `[AgentSessionsController] taskId "${taskId}" not found in local tasks table — ` +
              'creating agent session with task_id=null; task_title will be preserved.',
          );
          resolvedTaskId = null;
        }
      }

      if (taskTitle !== undefined && taskTitle !== null && typeof taskTitle !== 'string') {
        throw AppError.badRequest('taskTitle must be a string');
      }

      // projectId: optional in body. Explicit `null` is honored (intentional
      // "unassigned"). When the client omits the field entirely, fall back to
      // cwd-prefix lookup against the projects table (longest match wins,
      // archived projects skipped).
      const expandedCwd = expandHome(cwd.trim());

      // Optional branch checkout before starting the session.
      const branchParam = body.branch;
      const stashParam = body.stash;
      const createBranchParam = body.createBranch;
      if (typeof branchParam === 'string' && branchParam.trim() !== '') {
        // Only checkout when requested branch differs from current HEAD.
        const currentBranch = (() => {
          try {
            const info = probeVcs(expandedCwd);
            return info?.vcsBranch ?? null;
          } catch {
            return null;
          }
        })();
        if (currentBranch !== branchParam.trim()) {
          const stashMode: 'none' | 'stash' | 'discard' =
            stashParam === 'stash'
              ? 'stash'
              : stashParam === 'discard'
                ? 'discard'
                : 'none';
          const checkoutResult = gitCheckout(expandedCwd, branchParam.trim(), {
            stash: stashMode,
            createBranch: createBranchParam === true,
          });
          if (!checkoutResult.ok) {
            res.status(409).json({ error: checkoutResult.stderr });
            return;
          }
        }
      }

      let projectId: string | null = null;
      if (Object.prototype.hasOwnProperty.call(body, 'projectId')) {
        const raw = body.projectId;
        if (raw !== null && typeof raw !== 'string') {
          throw AppError.badRequest('projectId must be a string or null');
        }
        projectId = (raw as string | null) ?? null;
      } else {
        const match = new ProjectsRepository().findByCwdPrefix(expandedCwd);
        projectId = match?.id ?? null;
      }

      const dto: CreateAgentSessionDto = {
        agentKind: normalizedAgentId as AgentKind,
        taskId: resolvedTaskId,
        taskTitle: taskTitle != null ? (taskTitle as string) : null,
        cwd: expandedCwd,
        name: name.trim(),
        projectId,
      };

      const session = repo.insert(dto);

      // Issue #653: The previous #629 system-message seeding and the
      // agent-less ('__pending__') early-return branch are intentionally
      // removed. The new design (model-pick-first trigger bubble) requires
      // the client to pick an agent + model BEFORE creating the session,
      // and to deliver task context as an editable composer prefill — not
      // as a server-seeded system message. Sessions arrive at the WS
      // gateway fully resolved.

      // Create an Opencode SDK session instead of spawning a PTY subprocess.
      // Try to auto-recover if the engine was disposed accidentally (e.g.,
      // PARENT_GONE watchdog raced against a request).
      if (!opencodeClient.isReady) {
        console.log(
          `[AgentSessionsController] Engine status="${opencodeClient.statusMessage}" — attempting auto-recovery for session ${session.id}`,
        );
        if (!(await opencodeClient.ensureReady())) {
          repo.markClosed(session.id);
          throw AppError.badRequest(
            `Opencode engine is not ready (${opencodeClient.statusMessage}) — check Settings to connect an AI account`,
          );
        }
        console.log(`[AgentSessionsController] Engine recovered — continuing session ${session.id} creation`);
      }

      const opencodeSession = await opencodeClient.createSession(name.trim(), dto.cwd);
      if (!opencodeSession) {
        repo.markClosed(session.id);
        throw AppError.badRequest('Failed to create Opencode session — check your AI account is authorized');
      }

      // Store the SDK session ID mapping so the WS gateway can route user input
      opencodeSessionMap.set(session.id, opencodeSession.id);

      // OPC-M1-5 — Persist the SDK session id on the DB row so resume() can
      // re-attach to the EXISTING SDK conversation rather than creating a new one.
      repo.setSdkSessionId(session.id, opencodeSession.id);

      // Start streaming Opencode events through the WebSocket gateway.
      // Pass the cwd so the bridge can subscribe to /event with the right
      // directory filter (opencode only delivers session/message events
      // for sessions whose cwd matches the subscription's directory).
      try {
        await streamBridge.streamSession(session.id, opencodeSession.id, dto.cwd);
      } catch (err) {
        console.error(
          `[AgentSessionsController] Stream bridge error for session ${session.id}:`,
          err,
        );
      }

      // Issue #653: the previous "auto-send initial prompt with task context"
      // path is removed. The client owns first-turn content (composer prefill
      // with task title + notes that the user can edit before hitting Enter).
      // The server no longer fabricates "I need help with: ..." prompts.

      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const body = (req.body ?? {}) as Record<string, unknown>;

      const fields: {
        name?: string;
        providerId?: string | null;
        modelId?: string | null;
        agentMode?: string | null;
        permissionMode?: PermissionMode;
        thinkingBudget?: number | null;
        fastMode?: boolean;
      } = {};

      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.trim() === '') {
          throw AppError.badRequest('name must be a non-empty string');
        }
        fields.name = body.name.trim();
      }
      if (body.providerId !== undefined) {
        if (body.providerId !== null && typeof body.providerId !== 'string') {
          throw AppError.badRequest('providerId must be a string or null');
        }
        // Validate against the authed providers list. Null clears the override.
        if (typeof body.providerId === 'string') {
          const authed = await opencodeClient.listAuthedProviders();
          if (!authed.includes(body.providerId)) {
            throw AppError.badRequest(`provider not authenticated: '${body.providerId}'`);
          }
        }
        fields.providerId = body.providerId as string | null;
      }
      if (body.modelId !== undefined) {
        if (body.modelId !== null && typeof body.modelId !== 'string') {
          throw AppError.badRequest('modelId must be a string or null');
        }
        fields.modelId = body.modelId as string | null;
      }
      if (body.agentMode !== undefined) {
        if (body.agentMode !== null && typeof body.agentMode !== 'string') {
          throw AppError.badRequest('agentMode must be a string or null');
        }
        fields.agentMode = body.agentMode as string | null;
      }
      // Issue #611 — permission mode
      if (body.permissionMode !== undefined) {
        if (typeof body.permissionMode !== 'string' || !PERMISSION_MODES.includes(body.permissionMode as PermissionMode)) {
          throw AppError.badRequest(`permissionMode must be one of: ${PERMISSION_MODES.join(', ')}`);
        }
        fields.permissionMode = body.permissionMode as PermissionMode;
      }

      // Issue #604 — reasoning budget + fast-mode
      if (body.thinkingBudget !== undefined) {
        if (body.thinkingBudget !== null && (typeof body.thinkingBudget !== 'number' || !Number.isInteger(body.thinkingBudget) || body.thinkingBudget < 0)) {
          throw AppError.badRequest('thinkingBudget must be a non-negative integer or null');
        }
        fields.thinkingBudget = body.thinkingBudget as number | null;
      }
      if (body.fastMode !== undefined) {
        if (typeof body.fastMode !== 'boolean') {
          throw AppError.badRequest('fastMode must be a boolean');
        }
        fields.fastMode = body.fastMode;
      }

      // Issue #601 — archive / unarchive via PATCH { archived: boolean }
      if (body.archived !== undefined) {
        if (typeof body.archived !== 'boolean') {
          throw AppError.badRequest('archived must be a boolean');
        }
        const updated = repo.setArchived(session.id, body.archived);
        if (updated) broadcastSessionUpdated(updated);
        res.json(updated ?? repo.findById(session.id)!);
        return;
      }

      repo.updateFields(session.id, fields);
      const updated = repo.findById(session.id)!;
      broadcastSessionUpdated(updated);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  // M3-4: return a session's working-tree diff via the typed getSessionDiff
  // wrapper (OPC-M1-1). The duck-typed probe that always returned [] has been
  // replaced — getSessionDiff calls the real SDK method.
  async getDiff(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const opencodeId = opencodeSessionMap.get(session.id);
      if (!opencodeId) {
        res.json([]);
        return;
      }
      const diff = await opencodeClient.getSessionDiff(opencodeId);
      res.json(diff);
    } catch (err) {
      next(err);
    }
  }

  // M3-6 / #608: respond to a permission prompt forwarded by the SDK.
  async respondPermission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const opencodeId = opencodeSessionMap.get(session.id);
      if (!opencodeId) {
        throw AppError.badRequest('Session has no SDK mapping for permission.');
      }
      const decision = req.params.decision as string;
      if (decision !== 'accept' && decision !== 'deny') {
        throw AppError.badRequest('decision must be accept or deny');
      }
      const permissionId = req.params.permissionId;

      // Forward to the SDK.
      const ok = await opencodeClient.respondPermission(opencodeId, permissionId, decision);
      // If the SDK doesn't support this endpoint, respond gracefully (204).
      // The caller can still update their local state.

      // Clear the pending permission from the bridge.
      streamBridge.clearPendingPermission(session.id, permissionId);

      // Broadcast resolution so other connected clients update their UI.
      const { broadcast } = await import('../services/ws_gateway');
      broadcast({
        v: 1,
        type: 'permission.resolved',
        sessionId: session.id,
        permissionId,
        decision,
      });

      if (!ok) {
        // Non-fatal: SDK may not support this endpoint yet.
        console.warn(`[AgentSessionsController] respondPermission: SDK returned false for session ${session.id}`);
      }

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  // M2-4: cancel an in-flight turn for a session.
  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const opencodeId = opencodeSessionMap.get(session.id);
      if (!opencodeId) {
        throw AppError.badRequest('Session has no active SDK mapping; cannot cancel.');
      }
      const ok = await opencodeClient.abortSession(opencodeId);
      if (!ok) {
        throw AppError.badRequest('Cancel failed at the SDK level.');
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction): void {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');

      // Stop any streaming for this session, clean up the SDK mapping, and mark it closed
      streamBridge.stopStream(session.id);
      opencodeSessionMap.delete(session.id);
      repo.markClosed(session.id);

      // Issue #605 — broadcast the status change so live clients update without polling.
      const closed = repo.findById(session.id);
      if (closed) broadcastSessionUpdated(closed);

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  /**
   * Hard-delete a session row plus its messages (cascade). This is the
   * "clear from history" action — distinct from `remove`, which only flips
   * status to closed. See #598 follow-up; archive lives at #601.
   */
  destroy(req: Request, res: Response, next: NextFunction): void {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');

      streamBridge.stopStream(session.id);
      opencodeSessionMap.delete(session.id);
      const changes = repo.deleteById(session.id);
      if (changes === 0) throw AppError.notFound('AgentSession');

      // Issue #605 — broadcast row removal so live clients drop it from their cache.
      broadcastSessionRemoved(session.id);

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  async resume(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');

      // agentId may be provided in the body; fall back to the session's stored agentKind
      const body = req.body as Record<string, unknown> | undefined ?? {};
      const requestedAgentId = (body.agentId ?? body.agentKind) as string | undefined;
      if (requestedAgentId && typeof requestedAgentId === 'string') {
        if (body.agentKind && !body.agentId) {
          console.warn('[deprecated] agentKind is deprecated in resume body — use agentId instead');
        }
        const agentConfig = new AgentConfigsRepository().getById(requestedAgentId);
        if (!agentConfig) {
          throw AppError.badRequest(`agent not configured: '${requestedAgentId}'`);
        }
        if (!agentConfig.enabled) {
          throw AppError.badRequest(`agent disabled: '${requestedAgentId}'`);
        }
      }

      if (session.status !== 'resumable' || !session.sessionToken) {
        throw AppError.badRequest(
          'Session is not resumable — status must be "resumable" and session_token must be present',
        );
      }

      // Auto-recover if the engine was disposed accidentally.
      if (!opencodeClient.isReady) {
        console.log(
          `[AgentSessionsController] Resume: engine status="${opencodeClient.statusMessage}" — attempting auto-recovery`,
        );
        if (!(await opencodeClient.ensureReady())) {
          throw AppError.badRequest(
            `Opencode engine is not ready (${opencodeClient.statusMessage})`,
          );
        }
      }

      // OPC-M1-5 — Real resume continuity: re-attach to the EXISTING SDK session
      // rather than creating a fresh one.
      //
      // Path 1 (happy path): sdk_session_id is set → verify the SDK session still
      //   exists via getSession → re-register in the session map → clear any error
      //   state → stream.
      // Path 2 (gone): SDK returns null → HTTP 410 naming the session. Client
      //   shows a "Start fresh" affordance; no session map entry is created.
      // Path 3 (legacy row with no sdk_session_id): fall back to the old create
      //   path so pre-migration sessions can still resume.

      let sdkSessionId: string;

      if (session.sdkSessionId) {
        // Path 1/2: attempt re-attach.
        const existingSession = await opencodeClient.getSession(session.sdkSessionId);

        if (!existingSession) {
          // Path 2: SDK session is gone.
          logger.warn(
            `[AgentSessionsController] resume: SDK session "${session.sdkSessionId}" no longer exists for local session ${session.id} ("${session.name}")`,
          );
          res.status(410).json({
            error: `SDK session "${session.name}" (${session.sdkSessionId}) no longer exists on the server. Use start-fresh to create a new session.`,
          });
          return;
        }

        // Path 1: session still alive — re-attach.
        sdkSessionId = existingSession.id;
        logger.info(
          `[AgentSessionsController] resume: re-attaching to existing SDK session ${sdkSessionId} for local session ${session.id}`,
        );
      } else {
        // Path 3: legacy row (no sdk_session_id) — create a fresh SDK session to
        // maintain backward compatibility for sessions created before OPC-M1-5.
        logger.info(
          `[AgentSessionsController] resume: no sdk_session_id on session ${session.id} — creating fresh SDK session (legacy path)`,
        );
        const opencodeSession = await opencodeClient.createSession(session.name, session.cwd);
        if (!opencodeSession) {
          throw AppError.badRequest('Failed to create Opencode session — check your AI account is authorized');
        }
        sdkSessionId = opencodeSession.id;
        // Persist for future resumes.
        repo.setSdkSessionId(session.id, sdkSessionId);
      }

      // Register in session map (both re-attach and legacy-create paths).
      opencodeSessionMap.set(session.id, sdkSessionId);

      // OPC-M1-4: clear persisted error status so errored sessions can resume cleanly.
      streamBridge.clearErrorStatus(session.id);

      // Start streaming Opencode events through the WebSocket gateway
      try {
        await streamBridge.streamSession(session.id, sdkSessionId, session.cwd);
      } catch (err) {
        console.error(`[AgentSessionsController] Stream bridge error for session ${session.id}:`, err);
      }

      repo.updateStatus(session.id, 'starting');
      const updated = repo.findById(session.id)!;
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  }

  // OPC-M3-2: revert the session to a prior message (POST /:id/revert).
  async revert(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const opencodeId = opencodeSessionMap.get(session.id);
      if (!opencodeId) {
        throw AppError.badRequest('Session has no active SDK mapping; cannot revert.');
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const messageId = body.messageId as string | undefined;
      if (!messageId || typeof messageId !== 'string') {
        throw AppError.badRequest('messageId is required in the request body');
      }
      const result = await opencodeClient.revertSession(opencodeId, messageId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  // OPC-M3-2: restore all reverted messages (POST /:id/unrevert).
  async unrevert(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const opencodeId = opencodeSessionMap.get(session.id);
      if (!opencodeId) {
        throw AppError.badRequest('Session has no active SDK mapping; cannot unrevert.');
      }
      const result = await opencodeClient.unrevertSession(opencodeId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  // OPC-M3-3: trigger session compaction via POST /:id/summarize.
  async summarize(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const opencodeId = opencodeSessionMap.get(session.id);
      if (!opencodeId) {
        throw AppError.badRequest('Session has no active SDK mapping; cannot summarize.');
      }
      await opencodeClient.summarizeSession(opencodeId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  // OPC-M3-6: list child sessions via the typed listChildren wrapper.
  // Returns [] when there is no SDK mapping (same contract as getDiff).
  // The route is GET /:id/children — no auth is required at the route level
  // (agentLocal=true, same as all other agent-session routes).
  async getChildren(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const opencodeId = opencodeSessionMap.get(session.id);
      if (!opencodeId) {
        // No active SDK mapping — return empty array (same contract as getDiff).
        res.json([]);
        return;
      }
      const children = await opencodeClient.listChildren(opencodeId);
      res.json(children);
    } catch (err) {
      next(err);
    }
  }

  // OPC-M3-6: get messages for a specific child session identified by its SDK
  // session id (GET /:id/children/:childSdkId/messages).
  //
  // The child's messages are fetched directly from the SDK via listMessages —
  // child sessions have no local DB row. The returned shape is the same
  // StructuredAgentSessionMessage-compatible format as M1-2 so the Flutter
  // client can reuse _rehydrateChatMessages / fromStructuredJson.
  //
  // Role mapping: SDK 'user' → 'input', SDK 'assistant' → 'output' (matches
  // the role convention used throughout the structured-message pipeline).
  async getChildMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const { childSdkId } = req.params;
      const sdkMessages = await opencodeClient.listMessages(childSdkId);
      // Map SDK Message[] → M1-2-compatible structured shape.
      const messages = sdkMessages.map((msg, idx) => {
        // SDK role 'user' → 'input', 'assistant' → 'output'
        const role: 'input' | 'output' = msg.role === 'user' ? 'input' : 'output';
        return {
          id: idx + 1,
          sessionId: `child-${childSdkId}`,
          role,
          rawText: '',
          strippedText: '',
          createdAt: msg.time?.created
            ? new Date(msg.time.created).toISOString()
            : new Date().toISOString(),
          sdkMessageId: msg.id,
          // Parts array passes through as-is (same shape as M1-2 parts_json).
          parts: msg.parts ?? [],
          tokens: null,
          cost: null,
        };
      });
      res.json({ messages });
    } catch (err) {
      next(err);
    }
  }

  // OPC-M3-5: get the session todo list (GET /:id/todo).
  async getTodo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const opencodeId = opencodeSessionMap.get(session.id);
      if (!opencodeId) {
        // No active SDK mapping — return empty array (same contract as getDiff).
        res.json([]);
        return;
      }
      const todos = await opencodeClient.getTodo(opencodeId);
      res.json(todos);
    } catch (err) {
      next(err);
    }
  }

  // OPC-M4-2: fork the session at the given message (POST /:id/fork).
  //
  // Flow:
  //   1. Look up the parent session and its SDK mapping.
  //   2. Call the typed forkSession wrapper (throws on SDK error).
  //   3. Insert a local DB row for the fork (name "<parent> (fork)", same cwd).
  //   4. Set sdk_session_id on the fork row + populate opencodeSessionMap.
  //   5. Register a stream for the fork.
  //   6. Copy parent messages up to and including the fork message.
  //   7. Return 201 with the new session row.
  //
  // Rollback: if the SDK call succeeds but any subsequent step throws, the
  // fork DB row (if created) is deleted so no orphan remains.
  async fork(req: Request, res: Response, next: NextFunction): Promise<void> {
    let forkLocalId: string | null = null;
    try {
      const parent = repo.findById(req.params.id);
      if (!parent) throw AppError.notFound('AgentSession');

      const parentSdkId = opencodeSessionMap.get(parent.id);
      if (!parentSdkId) {
        throw AppError.badRequest('Session has no active SDK mapping; cannot fork.');
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const messageId = body.messageId as string | undefined;
      // messageId is required — the fork point must be explicit.
      if (!messageId || typeof messageId !== 'string') {
        throw AppError.badRequest('messageId is required in the request body');
      }

      // 1. Call SDK fork (throws on error → caught below, no row to rollback).
      const forkedSdkSession = await opencodeClient.forkSession(parentSdkId, messageId);
      if (!forkedSdkSession) {
        throw AppError.badRequest('forkSession returned no session — SDK may not support forking');
      }

      // 2. Insert local DB row.
      const forkDto = {
        agentKind: parent.agentKind,
        taskId: null,
        taskTitle: null,
        cwd: parent.cwd,
        name: `${parent.name} (fork)`,
        projectId: parent.projectId ?? null,
      };
      const forkSession = repo.insert(forkDto);
      forkLocalId = forkSession.id;

      // 3. Persist SDK session id on the fork row + register in session map.
      repo.setSdkSessionId(forkLocalId, forkedSdkSession.id);
      opencodeSessionMap.set(forkLocalId, forkedSdkSession.id);

      // 4. Start streaming for the fork session.
      try {
        await streamBridge.streamSession(forkLocalId, forkedSdkSession.id, parent.cwd);
      } catch (err) {
        logger.warn(`[AgentSessionsController] fork: stream bridge error for fork session ${forkLocalId}:`, err);
        // Non-fatal: streaming failure doesn't prevent the fork from being usable.
      }

      // 5. Copy parent messages up to and including the fork message.
      //    Uses listBySessionStructured so parts_json is carried over intact.
      const parentMessages = messagesRepo.listBySessionStructured(parent.id, 500);
      for (const msg of parentMessages) {
        if (!msg.sdkMessageId) continue;
        const role = msg.role as 'output' | 'input' | 'system';
        const partsJson = JSON.stringify(msg.parts ?? []);
        const tokensJson = msg.tokens ? JSON.stringify(msg.tokens) : null;
        messagesRepo.upsertStructured(
          forkLocalId,
          msg.sdkMessageId,
          role,
          partsJson,
          tokensJson,
          msg.cost,
        );
        // Stop after the fork message (inclusive).
        if (msg.sdkMessageId === messageId) break;
      }

      // 6. Return 201 with the fork session row (re-fetch to get sdk_session_id populated).
      const updated = repo.findById(forkLocalId)!;
      res.status(201).json(updated);
    } catch (err) {
      // Rollback: remove the fork row if it was inserted before the error.
      if (forkLocalId) {
        try {
          streamBridge.stopStream(forkLocalId);
          opencodeSessionMap.delete(forkLocalId);
          repo.deleteById(forkLocalId);
        } catch (rollbackErr) {
          logger.warn(`[AgentSessionsController] fork rollback failed for ${forkLocalId}:`, rollbackErr);
        }
      }
      next(err);
    }
  }

  listMessages(req: Request, res: Response, next: NextFunction): void {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');

      const limitParam = req.query.limit;
      const limit =
        limitParam !== undefined ? Math.min(Number(limitParam), 500) : 200;

      const messages = messagesRepo.listBySession(session.id, limit);
      res.json({ messages });
    } catch (err) {
      next(err);
    }
  }
}
