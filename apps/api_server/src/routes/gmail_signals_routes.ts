/**
 * C2 — GET /integrations/gmail-signals
 *
 * Returns recent gmail signals for the authenticated user.
 * Uses GmailSignalsRepository.listRecentAsync() (already implemented).
 * Returns [] (200) when there are no signals — never 500.
 */
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { GmailSignalsRepository } from '../repositories/gmail_signals_repository';

const router = Router();
const repo = new GmailSignalsRepository();

if (!env.agentLocal) router.use(requireAuth);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limitParam = Number(req.query.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 12;
    const signals = await repo.listRecentAsync(req.auth!.user.id, limit);
    res.json(signals);
  } catch (err) {
    next(err);
  }
});

export default router;
