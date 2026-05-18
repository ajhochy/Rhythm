import os from 'os';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import type { AgentKind, CreateAgentSessionDto, PermissionMode } from '../models/agent_session';
import { PERMISSION_MODES } from '../models/agent_session';
import { opencodeClient, opencodeSessionMap } from '../services/opencode_engine';
import { streamBridge } from '../services/opencode_stream_bridge';
import { broadcastSessionUpdated, broadcastSessionRemoved } from '../services/ws_gateway';

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

import { resolveModelForAgent as resolveModel } from '../services/agent_model_resolver';
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
      const messages = messagesRepo.listBySession(session.id, 200);
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
      // #602: agentId may be omitted / explicitly null to create an "agent-less"
      // session that defers model selection to the first turn.
      let agentId = body.agentId;
      if (!agentId && body.agentKind) {
        console.warn('[deprecated] agentKind is deprecated in POST /agent-sessions — use agentId instead');
        agentId = body.agentKind;
      }

      // #602: null/omitted agentId → agent-less session. We store a sentinel
      // agent kind ('__pending__') and skip SDK session creation until the
      // first session.input WS frame carries a modelOverride that resolves
      // the agent kind.
      const isAgentLess = agentId === null || agentId === undefined || agentId === '';
      let normalizedAgentId: string;

      if (isAgentLess) {
        normalizedAgentId = '__pending__';
      } else {
        if (typeof agentId !== 'string') {
          throw AppError.badRequest('agentId must be a string or null');
        }
        normalizedAgentId = normalizeAgentId(agentId);
        // Validate that a matching, enabled agent config exists (only for known agents).
        if (normalizedAgentId !== '__pending__') {
          const agentConfig = new AgentConfigsRepository().getById(normalizedAgentId);
          if (!agentConfig) {
            throw AppError.badRequest(`agent not configured: '${normalizedAgentId}'`);
          }
          if (!agentConfig.enabled) {
            throw AppError.badRequest(`agent disabled: '${normalizedAgentId}'`);
          }
        }
      }
      if (!cwd || typeof cwd !== 'string' || cwd.trim() === '') {
        throw AppError.badRequest('cwd is required and must be a non-empty string');
      }
      if (!name || typeof name !== 'string' || name.trim() === '') {
        throw AppError.badRequest('name is required and must be a non-empty string');
      }

      if (taskId !== undefined && taskId !== null) {
        if (typeof taskId !== 'string') {
          throw AppError.badRequest('taskId must be a string');
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
        taskId: taskId != null ? (taskId as string) : null,
        taskTitle: taskTitle != null ? (taskTitle as string) : null,
        cwd: expandedCwd,
        name: name.trim(),
        projectId,
      };

      const session = repo.insert(dto);

      // #602: agent-less sessions skip SDK session creation.
      // The first session.input WS frame with a modelOverride will resolve
      // the agent kind, create the SDK session, and forward the prompt.
      if (isAgentLess) {
        console.log(`[AgentSessionsController] Created agent-less session ${session.id} — awaiting first model pick`);
        res.status(201).json(session);
        return;
      }

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

      // Start streaming Opencode events through the WebSocket gateway.
      // Pass the cwd so the bridge can subscribe to /event with the right
      // directory filter (opencode only delivers session/message events
      // for sessions whose cwd matches the subscription's directory).
      streamBridge
        .streamSession(session.id, opencodeSession.id, dto.cwd)
        .catch((err) => {
          console.error(
            `[AgentSessionsController] Stream bridge error for session ${session.id}:`,
            err,
          );
        });

      // Send the initial prompt with task context so the AI starts working immediately.
      // This uses promptAsync (fire-and-forget) so we return HTTP 201 quickly.
      // Results stream back via the event bridge → WebSocket.
      const initialPrompt = taskTitle
        ? `I need help with: ${taskTitle}\n\nSession name: ${name}`
        : `Starting session: ${name}`;

      const model = await resolveModel(normalizedAgentId);
      console.log(
        `[AgentSessionsController] Routing ${normalizedAgentId} session ${session.id} via ` +
          (model ? `${model.providerID}/${model.modelID}` : '<unmapped>'),
      );
      opencodeClient.promptAsync(
        opencodeSession.id,
        initialPrompt,
        model,
        dto.cwd,
      ).then((ok) => {
        if (!ok) {
          console.warn(`[AgentSessionsController] Initial prompt failed for session ${session.id}`);
        }
      });

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

  // M3-4: return a session's working-tree diff. Wraps client.session.diff when
  // available; falls back to an empty list when the SDK build doesn't expose
  // diff (older SDKs). The empty-list path is shippable — the Flutter side
  // panel renders an empty Changes tab and the user gets correct UX.
  async getDiff(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const opencodeId = opencodeSessionMap.get(session.id);
      if (!opencodeId) {
        res.json([]);
        return;
      }
      const sdk = (opencodeClient as unknown as {
        diffSession?: (id: string) => Promise<Array<{ path: string; before: string; after: string }>>;
      });
      if (typeof sdk.diffSession !== 'function') {
        res.json([]);
        return;
      }
      const diff = await sdk.diffSession(opencodeId);
      res.json(Array.isArray(diff) ? diff : []);
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

      // Resume via Opencode SDK — create a fresh session with context.
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

      // "Resume" means continue the local row with a *fresh* SDK session.
      // The Opencode SDK does not restore prior conversation history; the local
      // row keeps the same id, name, and message history for the user, but the
      // backing SDK session is new. Mirror the create() flow below.
      const opencodeSession = await opencodeClient.createSession(session.name, session.cwd);
      if (!opencodeSession) {
        throw AppError.badRequest('Failed to create Opencode session — check your AI account is authorized');
      }

      // Store the SDK session ID mapping so the WS gateway can route user input
      opencodeSessionMap.set(session.id, opencodeSession.id);

      // Start streaming Opencode events through the WebSocket gateway
      streamBridge
        .streamSession(session.id, opencodeSession.id, session.cwd)
        .catch((err) => {
        console.error(`[AgentSessionsController] Stream bridge error for session ${session.id}:`, err);
      });

      repo.updateStatus(session.id, 'starting');
      const updated = repo.findById(session.id)!;
      res.status(200).json(updated);
    } catch (err) {
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
