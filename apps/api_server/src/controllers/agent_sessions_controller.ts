import os from 'os';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
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
import { syncOpencodeAgentProfiles } from '../services/agent_profile_sync';
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
 * Learn a session's actual model from opencode when the row never recorded one
 * (created without an explicit pick). Reads the session's messages, finds the
 * most recent assistant message's providerID/modelID, backfills the row (only
 * when still empty), and broadcasts the update so live clients refresh. Best
 * effort — any failure is logged and swallowed (never blocks a request).
 */
async function backfillSessionModelFromOpencode(
  localSessionId: string,
  sdkSessionId: string,
): Promise<void> {
  try {
    const messages = await opencodeClient.listMessages(sdkSessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      // SDK shape is { info, parts }; tolerate a flat shape defensively.
      const m = messages[i] as unknown as Record<string, unknown>;
      const info = (m.info ?? m) as Record<string, unknown>;
      if (
        info?.role === 'assistant' &&
        typeof info.providerID === 'string' &&
        typeof info.modelID === 'string'
      ) {
        const updated = repo.backfillModel(
          localSessionId,
          info.providerID,
          info.modelID,
        );
        if (updated) broadcastSessionUpdated(updated);
        return;
      }
    }
  } catch (err) {
    logger.warn(
      `[AgentSessionsController] model backfill failed for ${localSessionId}: ${String(err)}`,
    );
  }
}

/**
 * C1 — MCP role resolution helpers.
 *
 * `.mcp-roles/` lives at the repo root. The controller lives at:
 *   apps/api_server/src/controllers/  (dev source)
 *   apps/api_server/dist/controllers/  (compiled output, same depth)
 *
 * From src/controllers/ → ../../../../ = Rhythm/ (repo root).
 * Override with MCP_ROLES_DIR env var for bundled/non-standard deployments
 * (e.g. the Flutter .app bundle where the api_server is embedded without the
 * full repo tree).
 */
const MCP_ROLES_DIR =
  process.env.MCP_ROLES_DIR ??
  path.join(__dirname, '..', '..', '..', '..', '.mcp-roles');

/** Slug validation: only lowercase letters, digits, and hyphens. No `/`, no `..`. */
const MCP_ROLE_SLUG_RE = /^[a-z0-9-]+$/;

/** Shape of a resolved .mcp-roles/<role>.mcp.json file. */
interface McpRoleFile {
  mcpServers: Record<string, { allowedTools?: string[]; [k: string]: unknown }>;
  disabledMcpServers?: string[];
}

/**
 * Resolve and validate an mcpRole slug.
 * Returns the parsed role file.
 * Throws AppError 400 for:
 *   - invalid slug characters (path traversal prevention)
 *   - role file not found
 *   - malformed role file (not valid JSON or missing mcpServers)
 */
function resolveMcpRole(role: string): McpRoleFile {
  // Guard 1: slug must be [a-z0-9-]+ only — rejects `..`, `/`, etc.
  if (!MCP_ROLE_SLUG_RE.test(role)) {
    throw AppError.badRequest(
      `Invalid mcpRole "${role}": must match [a-z0-9-]+ (no slashes, dots, or special characters)`,
    );
  }

  // Guard 2: resolved path must stay within MCP_ROLES_DIR.
  const resolved = path.resolve(MCP_ROLES_DIR, `${role}.mcp.json`);
  if (!resolved.startsWith(path.resolve(MCP_ROLES_DIR) + path.sep) &&
      resolved !== path.resolve(MCP_ROLES_DIR)) {
    // Extra defense-in-depth; the slug guard above should already prevent this.
    throw AppError.badRequest(
      `Invalid mcpRole "${role}": resolved path escapes the .mcp-roles directory`,
    );
  }

  // Guard 3: file must exist — no silent fallback to full tools.
  if (!existsSync(resolved)) {
    throw AppError.badRequest(`Unknown mcpRole: "${role}"`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch {
    throw AppError.badRequest(
      `mcpRole "${role}": role file is not valid JSON`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || !('mcpServers' in parsed) ||
      typeof (parsed as Record<string, unknown>).mcpServers !== 'object') {
    throw AppError.badRequest(
      `mcpRole "${role}": role file is missing required "mcpServers" field`,
    );
  }

  return parsed as McpRoleFile;
}

/**
 * Expands '~' at the start of a path string to the current user's home directory.
 */
function expandHome(path: string): string {
  if (path === '~' || path.startsWith('~/')) {
    return path.replace('~', os.homedir());
  }
  return path;
}

/**
 * Resolve the opencode SDK session id for a Rhythm session.
 *
 * The in-memory `opencodeSessionMap` is only populated when a session is
 * created or (re)attached this server-run, so after a relaunch — or for a
 * resumable session the user hasn't messaged yet — it misses, and every action
 * (summarize, cancel, shell, diff, revert, …) failed with "no active SDK
 * mapping". Fall back to the persisted `sdk_session_id` (OPC-M1-5) and
 * re-register the map so subsequent calls + streaming reuse it.
 */
function resolveSdkSessionId(session: {
  id: string;
  sdkSessionId: string | null;
}): string | undefined {
  // NON-MUTATING: only READ the live routing map; never write to it. A one-off
  // action (summarize/cancel/diff/…) must not clobber opencodeSessionMap — the
  // live id registered by ws_gateway's attach is authoritative for turn
  // routing. Writing a persisted (possibly stale) id here broke response
  // streaming. The persisted id is used ONLY as a read-only fallback for this
  // action when the live map has no entry yet.
  return opencodeSessionMap.get(session.id) ?? session.sdkSessionId ?? undefined;
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
      // Mirror the engine's agent registry into agent_configs so every opencode
      // agent also exists as an Agent Profile. Reuse the list we just fetched
      // (no second engine hit). Fire-and-forget: the picker response must not
      // wait on the upsert. Idempotent + non-throwing.
      void syncOpencodeAgentProfiles(agents).catch(() => {});
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

      // Non-blocking: if the session never recorded a model (created without an
      // explicit pick), learn the actual model from opencode and broadcast the
      // update so the context panel + model-derived icon fill in. Fire-and-forget
      // so it never adds latency to opening a session.
      if ((!session.providerId || session.providerId === '') && session.sdkSessionId) {
        void backfillSessionModelFromOpencode(session.id, session.sdkSessionId);
      }
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
      //
      // OPC-#710 exception: agentId may be null for instant-create sessions
      // (one-click "New session" with no agent selected yet). The session is
      // agent-less at creation time; the user picks a model in the composer.
      // This is distinct from the deprecated '__pending__' sentinel (#653):
      //   - null / omitted → intentional agent-less session (allowed)
      //   - '__pending__'  → old client bug (rejected)
      if (agentId === '__pending__') {
        throw AppError.badRequest(
          "agentId '__pending__' is no longer supported (#653). " +
            'Use null for an agent-less session or pass a real agentId.',
        );
      }
      // Validate agentId type (null / undefined / string are all acceptable;
      // non-string non-null is a client error).
      if (agentId !== null && agentId !== undefined && typeof agentId !== 'string') {
        throw AppError.badRequest('agentId must be a string or null');
      }

      // Resolve + validate the agent config only when an agentId was provided.
      // OPC-#710: omitting agentId (null) creates an agent-less session — the
      // user picks a model later in the composer, same as the trigger-bubble
      // flow from #653.
      let normalizedAgentId: string = '';
      if (typeof agentId === 'string' && agentId.trim() !== '') {
        normalizedAgentId = normalizeAgentId(agentId);
        const agentConfig = new AgentConfigsRepository().getById(normalizedAgentId);
        if (!agentConfig) {
          throw AppError.badRequest(`agent not configured: '${normalizedAgentId}'`);
        }
        if (!agentConfig.enabled) {
          throw AppError.badRequest(`agent disabled: '${normalizedAgentId}'`);
        }
      }

      if (!cwd || typeof cwd !== 'string' || cwd.trim() === '') {
        throw AppError.badRequest('cwd is required and must be a non-empty string');
      }
      // OPC-#710: name may be empty (instant-create). Opencode will auto-title
      // the session after the first exchange and broadcast session.updated.
      if (name !== undefined && name !== null && typeof name !== 'string') {
        throw AppError.badRequest('name must be a string');
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

      // C1 — MCP role: optional slug that scopes the session to a subset of MCP tools.
      // Resolved at create time (init-time gate); unknown/invalid role → 400, no session.
      const mcpRoleRaw = body.mcpRole;
      if (mcpRoleRaw !== undefined && mcpRoleRaw !== null && typeof mcpRoleRaw !== 'string') {
        throw AppError.badRequest('mcpRole must be a string or null');
      }

      let resolvedMcpRole: string | null = null;
      let mcpAllowedToolsJson: string | null = null;
      let mcpRoleConfig:
        | { role: string; mcpServers: Record<string, unknown>; allowedToolsJson: string }
        | undefined;

      if (typeof mcpRoleRaw === 'string' && mcpRoleRaw.trim() !== '') {
        const roleSlug = mcpRoleRaw.trim();
        // resolveMcpRole throws AppError 400 on invalid slug, missing file, or bad JSON.
        const roleFile = resolveMcpRole(roleSlug);
        resolvedMcpRole = roleSlug;

        // Build a per-server allowedTools map for persistence and SDK passthrough.
        const allowedToolsMap: Record<string, string[]> = {};
        for (const [serverName, serverCfg] of Object.entries(roleFile.mcpServers)) {
          if (Array.isArray(serverCfg?.allowedTools)) {
            allowedToolsMap[serverName] = serverCfg.allowedTools as string[];
          }
        }
        mcpAllowedToolsJson = JSON.stringify(allowedToolsMap);
        mcpRoleConfig = {
          role: roleSlug,
          mcpServers: roleFile.mcpServers as Record<string, unknown>,
          allowedToolsJson: mcpAllowedToolsJson,
        };
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
        // OPC-#710: normalizedAgentId is '' for agent-less instant-create.
        // The AgentKind type accepts arbitrary strings; '' is persisted as the
        // agent_kind value and treated as "no agent selected yet" by the client.
        agentKind: normalizedAgentId as AgentKind,
        taskId: resolvedTaskId,
        taskTitle: taskTitle != null ? (taskTitle as string) : null,
        cwd: expandedCwd,
        // OPC-#710: name defaults to '' for instant-create sessions.
        name: typeof name === 'string' ? name.trim() : '',
        projectId,
        // C1 — MCP role (null when no role was requested).
        mcpRole: resolvedMcpRole,
        mcpAllowedToolsJson,
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

      // OPC-#710: name may be undefined/null for instant-create sessions.
      // C1: pass mcpRoleConfig so callers/tests can spy on the init-time allowlist;
      // the SDK itself doesn't have a per-session tool param (documented in service).
      const opencodeSession = await opencodeClient.createSession(
        typeof name === 'string' ? name.trim() : '',
        dto.cwd,
        mcpRoleConfig,
      );
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
      const opencodeId = resolveSdkSessionId(session);
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
      const opencodeId = resolveSdkSessionId(session);
      if (!opencodeId) {
        throw AppError.badRequest('Session has no SDK mapping for permission.');
      }
      const decision = req.params.decision as string;
      if (decision !== 'accept' && decision !== 'deny') {
        throw AppError.badRequest('decision must be accept or deny');
      }
      const permissionId = req.params.permissionId;

      // Forward to the SDK.
      const ok = await opencodeClient.respondPermission(opencodeId, permissionId, decision, session.cwd);
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

  /**
   * Answer (or dismiss) a pending `question` (AskUserQuestion) tool call.
   *
   * POST /agent-sessions/:id/question/:callId/:action  (action = reply | reject)
   *   reply body: { answers: string[][] }  — one string[] per question.
   *
   * The client only knows the tool `callId` it rendered; we resolve it to the
   * opencode `requestId` (the `que_…` id) via the stream bridge's pending-question
   * map, falling back to GET /question if the map was lost (server restart).
   * Then we POST to opencode's /question/{requestId}/{action}. Without this the
   * question tool stays status:running forever and the session hangs.
   */
  async respondQuestion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const action = req.params.action;
      if (action !== 'reply' && action !== 'reject') {
        throw AppError.badRequest('action must be reply or reject');
      }
      const callId = req.params.callId;

      // Resolve the tool callId → opencode requestId.
      let pending = streamBridge.getPendingQuestionByCallId(session.id, callId);
      if (!pending) {
        // Fallback: the bridge map was lost (e.g. restart). Ask opencode.
        const list = await opencodeClient.listQuestions(session.cwd);
        const match = list.find((q) => q.tool?.callID === callId);
        if (match) {
          pending = {
            requestId: match.id,
            callId,
            sdkSessionId: match.sessionID,
            questions: [],
          };
        }
      }
      if (!pending) {
        throw AppError.notFound('No pending question for that callId');
      }

      let ok: boolean;
      if (action === 'reply') {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const answers = body.answers;
        if (
          !Array.isArray(answers) ||
          !answers.every(
            (a) => Array.isArray(a) && a.every((s) => typeof s === 'string'),
          )
        ) {
          throw AppError.badRequest('answers must be a string[][]');
        }
        ok = await opencodeClient.replyToQuestion(
          pending.requestId,
          answers as string[][],
          session.cwd,
        );
      } else {
        ok = await opencodeClient.rejectQuestion(pending.requestId, session.cwd);
      }

      // Clear locally + broadcast resolution (the question.replied/rejected
      // event will also fire, but this keeps every client snappy and idempotent).
      streamBridge.clearPendingQuestion(session.id, pending.requestId);
      const { broadcast } = await import('../services/ws_gateway');
      broadcast({
        v: 1,
        type: 'question.resolved',
        sessionId: session.id,
        requestId: pending.requestId,
        rejected: action === 'reject',
      });

      if (!ok) {
        console.warn(
          `[AgentSessionsController] respondQuestion: opencode returned false for session ${session.id}`,
        );
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
      const opencodeId = resolveSdkSessionId(session);
      if (!opencodeId) {
        throw AppError.badRequest('Session has no active SDK mapping; cannot cancel.');
      }
      const ok = await opencodeClient.abortSession(opencodeId, session.cwd);
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
      const opencodeId = resolveSdkSessionId(session);
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
      const opencodeId = resolveSdkSessionId(session);
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
      const opencodeId = resolveSdkSessionId(session);
      if (!opencodeId) {
        throw AppError.badRequest('Session has no active SDK mapping; cannot summarize.');
      }
      // session.summarize needs a model to write the summary. Resolve it the
      // same way a turn does (session's last model → agent default).
      const { resolveModelForSessionTurn } = await import(
        '../services/agent_model_resolver'
      );
      const model = await resolveModelForSessionTurn({
        agentId: session.agentKind,
        sessionProviderId: session.providerId,
        sessionModelId: session.modelId,
      });
      if (!model) {
        throw AppError.badRequest(
          'No model available to summarize this session — connect a provider or pick a model first.',
        );
      }
      await opencodeClient.summarizeSession(opencodeId, model, session.cwd);
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
      const opencodeId = resolveSdkSessionId(session);
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
      const opencodeId = resolveSdkSessionId(session);
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

      const parentSdkId = resolveSdkSessionId(parent);
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

  // OPC-M1-6 / issue #709: run a one-shot shell command in the session.
  //
  // POST /agent-sessions/:id/shell { command }
  //
  // Flow:
  //   1. Look up the session and its active SDK mapping.
  //   2. Validate the command (400 on empty).
  //   3. Resolve the session's model using the same resolver as prompts.
  //   4. Call opencodeClient.runShell(sdkId, command, model).
  //   5. Return { messageId } so the Flutter terminal tab can track which
  //      messages were created by the terminal (criterion c4 transcript filter).
  //
  // Error handling:
  //   - No session row → 404.
  //   - Empty command → 400 (caught before SDK call).
  //   - No active SDK mapping → 400.
  //   - SDK error (including no authed model) → AppError 502 via next().
  async shell(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');

      const command =
        typeof req.body.command === 'string' ? req.body.command.trim() : '';
      if (!command) {
        throw AppError.badRequest('command is required and must not be empty');
      }

      const sdkId = resolveSdkSessionId(session);
      if (!sdkId) {
        throw AppError.badRequest(
          'Session has no active SDK mapping; cannot run shell command.',
        );
      }

      // Resolve the session's model using the same fallback logic as prompts.
      const { resolveModelForAgent } = await import('../services/agent_model_resolver');
      const agentKind = (session.agentKind as string) ?? 'claude-code';
      const model = await resolveModelForAgent(agentKind);

      if (!model) {
        throw new AppError(
          502,
          'SDK_ERROR',
          `Cannot run shell command: no authed model found for agent '${agentKind}'`,
        );
      }

      const result = await opencodeClient.runShell(sdkId, command, model);
      res.json({ messageId: result.messageId });
    } catch (err) {
      next(err);
    }
  }
}
