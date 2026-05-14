import os from 'os';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentKind, CreateAgentSessionDto } from '../models/agent_session';
import { opencodeClient, opencodeSessionMap } from '../services/opencode_engine';
import { streamBridge } from '../services/opencode_stream_bridge';

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
  list(_req: Request, res: Response, next: NextFunction): void {
    try {
      const sessions = repo.listAll(100);
      const resumable = repo.listResumable();
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

      // Accept agentId (preferred) with agentKind as a deprecated fallback
      let agentId = body.agentId;
      if (!agentId && body.agentKind) {
        console.warn('[deprecated] agentKind is deprecated in POST /agent-sessions — use agentId instead');
        agentId = body.agentKind;
      }

      if (!agentId || typeof agentId !== 'string') {
        throw AppError.badRequest('agentId is required');
      }
      const normalizedAgentId = normalizeAgentId(agentId);
      // Validate that a matching, enabled agent config exists
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

      if (taskId !== undefined && taskId !== null) {
        if (typeof taskId !== 'string') {
          throw AppError.badRequest('taskId must be a string');
        }
      }

      if (taskTitle !== undefined && taskTitle !== null && typeof taskTitle !== 'string') {
        throw AppError.badRequest('taskTitle must be a string');
      }

      const dto: CreateAgentSessionDto = {
        agentKind: normalizedAgentId as AgentKind,
        taskId: taskId != null ? (taskId as string) : null,
        taskTitle: taskTitle != null ? (taskTitle as string) : null,
        cwd: expandHome(cwd.trim()),
        name: name.trim(),
      };

      const session = repo.insert(dto);

      // Create an Opencode SDK session instead of spawning a PTY subprocess
      if (!opencodeClient.isReady) {
        repo.markClosed(session.id);
        throw AppError.badRequest('Opencode engine is not ready — check Settings to connect an AI account');
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

      const model = await resolveModel(agentId);
      console.log(
        `[AgentSessionsController] Routing ${agentId} session ${session.id} via ` +
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

  remove(req: Request, res: Response, next: NextFunction): void {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');

      // Stop any streaming for this session, clean up the SDK mapping, and mark it closed
      streamBridge.stopStream(session.id);
      opencodeSessionMap.delete(session.id);
      repo.markClosed(session.id);

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

      // Resume via Opencode SDK — create a fresh session with context
      if (!opencodeClient.isReady) {
        throw AppError.badRequest('Opencode engine is not ready');
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
