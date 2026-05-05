import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { getDb } from '../database/db';
import type { AgentKind, CreateAgentSessionDto } from '../models/agent_session';

const VALID_AGENT_KINDS: AgentKind[] = ['claude-code', 'codex'];

const repo = new AgentSessionsRepository();
const messagesRepo = new AgentSessionMessagesRepository();

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
      const { agentKind, taskId, cwd, name } = req.body as Record<string, unknown>;

      if (!agentKind || typeof agentKind !== 'string') {
        throw AppError.badRequest('agentKind is required');
      }
      if (!VALID_AGENT_KINDS.includes(agentKind as AgentKind)) {
        throw AppError.badRequest(
          `agentKind must be one of: ${VALID_AGENT_KINDS.join(', ')}`,
        );
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
        const taskRow = getDb()
          .prepare(`SELECT id FROM tasks WHERE id = ?`)
          .get(taskId);
        if (!taskRow) {
          throw AppError.badRequest(`Task with id '${taskId}' does not exist`);
        }
      }

      const dto: CreateAgentSessionDto = {
        agentKind: agentKind as AgentKind,
        taskId: taskId != null ? (taskId as string) : null,
        cwd: cwd.trim(),
        name: name.trim(),
      };

      const session = repo.insert(dto);
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction): void {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      repo.markClosed(session.id);
      res.status(204).end();
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
