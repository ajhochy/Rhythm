import os from 'os';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentKind, CreateAgentSessionDto } from '../models/agent_session';
import * as ptyRunner from '../services/pty_runner';

const repo = new AgentSessionsRepository();
const messagesRepo = new AgentSessionMessagesRepository();

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

  create(req: Request, res: Response, next: NextFunction): void {
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
      // Validate that a matching, enabled agent config exists
      const agentConfig = new AgentConfigsRepository().getById(agentId);
      if (!agentConfig) {
        throw AppError.badRequest(`agent not configured: '${agentId}'`);
      }
      if (!agentConfig.enabled) {
        throw AppError.badRequest(`agent disabled: '${agentId}'`);
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
        agentKind: agentId as AgentKind,
        taskId: taskId != null ? (taskId as string) : null,
        taskTitle: taskTitle != null ? (taskTitle as string) : null,
        cwd: expandHome(cwd.trim()),
        name: name.trim(),
      };

      const session = repo.insert(dto);

      // Spawn the PTY — if the binary is missing or node-pty fails, roll back
      // the row and return 400 so the client gets a clear error.
      const cols = typeof req.body.cols === 'number' ? (req.body.cols as number) : undefined;
      const rows = typeof req.body.rows === 'number' ? (req.body.rows as number) : undefined;
      try {
        ptyRunner.spawn({ session, cols, rows });
      } catch (spawnErr) {
        repo.markClosed(session.id);
        const message =
          spawnErr instanceof Error ? spawnErr.message : 'Failed to spawn agent binary';
        throw AppError.badRequest(message);
      }

      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction): void {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');

      // Kill the live PTY if running; the onExit handler will update the DB row
      // and broadcast session.closed asynchronously.
      ptyRunner.kill(session.id);

      // If the PTY was not alive (already exited), ensure the row is marked closed.
      if (!ptyRunner.isAlive(session.id)) {
        repo.markClosed(session.id);
      }

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  resume(req: Request, res: Response, next: NextFunction): void {
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

      if (ptyRunner.isAlive(session.id)) {
        throw AppError.badRequest('Session is already running');
      }

      try {
        ptyRunner.resume(session.id, session);
      } catch (resumeErr) {
        const message =
          resumeErr instanceof Error ? resumeErr.message : 'Failed to resume agent session';
        throw AppError.badRequest(message);
      }

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
