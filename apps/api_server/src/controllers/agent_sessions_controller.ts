import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { getDb } from '../database/db';
import type { AgentKind, CreateAgentSessionDto } from '../models/agent_session';
import * as ptyRunner from '../services/pty_runner';

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
