import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import { opencodeClient } from '../services/opencode_engine';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const repo = new AgentSessionsRepository();
export const ptyRouter = Router();

// POST /agent-sessions/:id/pty — create a PTY in the session's cwd
ptyRouter.post(
  '/agent-sessions/:id/pty',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = repo.findById(req.params.id);
      if (!session) throw AppError.notFound('AgentSession');
      const result = await opencodeClient.createPty({ cwd: session.cwd });
      res.json({ ptyId: result.id });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /pty/:id — resize a PTY (cols + rows required)
ptyRouter.patch(
  '/pty/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { cols, rows } = req.body as { cols?: number; rows?: number };
      if (typeof cols !== 'number' || typeof rows !== 'number') {
        throw new AppError(400, 'BAD_REQUEST', 'cols and rows (numbers) are required');
      }
      await opencodeClient.resizePty(req.params.id, cols, rows);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /pty/:id — kill a PTY
ptyRouter.delete(
  '/pty/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await opencodeClient.removePty(req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
