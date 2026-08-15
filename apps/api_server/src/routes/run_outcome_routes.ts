import { Router, type Request, type Response } from 'express';

import { authenticateIfPresent, requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { USER_VERDICTS, type UserVerdict } from '../models/agent_run_outcome';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { recordFeedback } from '../services/run_outcome_service';

export const runOutcomeRouter = Router();

// Same auth posture as agent_sessions_routes: under AGENT_LOCAL the embedded
// desktop server authenticates opportunistically. requireAuth is a NO-OP there,
// so it is NOT the ownership control — the per-run owner check below is.
runOutcomeRouter.use(env.agentLocal ? authenticateIfPresent : requireAuth);

/**
 * The caller's identity, if any. A paired mobile device identifies its user the
 * same way run_quality_routes.ts scopes its rollup; a browser/desktop caller
 * identifies via the session token. Neither exists for the trusted local
 * desktop process, which is the case AGENT_LOCAL exists to serve.
 */
function callerUserId(req: Request): number | null {
  return req.mobileDevice?.userId ?? req.auth?.user.id ?? null;
}

interface ResolvedRun {
  rootSessionId: string;
  ownerUserId: number | null;
  exists: boolean;
}

async function resolveRun(
  repo: AgentRunOutcomesRepository,
  sessionId: string,
): Promise<ResolvedRun> {
  const rootSessionId = await repo.resolveRootSessionIdAsync(sessionId);
  const owner = await repo.findRunOwnerUserIdAsync(rootSessionId);
  const outcome = await repo.findOutcomeAsync(rootSessionId);
  return { rootSessionId, ownerUserId: owner, exists: outcome !== null };
}

/**
 * A run the caller does not own is reported as absent, not as forbidden — the
 * convention agent_sessions_routes uses, so a probe cannot enumerate other
 * users' runs.
 */
function isVisible(req: Request, run: ResolvedRun): boolean {
  const caller = callerUserId(req);
  if (caller === null) return true;
  if (run.ownerUserId === null) return true;
  return run.ownerUserId === caller;
}

/** GET /agent-run-outcomes/:sessionId — the composed outcome + feedback view. */
runOutcomeRouter.get('/:sessionId', async (req: Request, res: Response) => {
  const repo = new AgentRunOutcomesRepository();
  const run = await resolveRun(repo, req.params.sessionId);
  if (!run.exists || !isVisible(req, run)) {
    res.status(404).json({ error: 'run outcome not found' });
    return;
  }
  res.json(await repo.findByRootSessionIdAsync(run.rootSessionId));
});

/**
 * POST /agent-run-outcomes/:sessionId/feedback
 *
 * Body: { verdict: 'success' | 'partial' | 'failure', reason?: string, actor?: string }
 * Anything else is a 400 — `inconclusive` is a finalizer outcome, never a thing
 * a human reports.
 */
runOutcomeRouter.post('/:sessionId/feedback', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const verdict = body?.verdict;
  if (
    typeof verdict !== 'string' ||
    !USER_VERDICTS.includes(verdict as UserVerdict)
  ) {
    res.status(400).json({
      error: `verdict must be one of ${USER_VERDICTS.join(' | ')}`,
    });
    return;
  }

  const repo = new AgentRunOutcomesRepository();
  const run = await resolveRun(repo, req.params.sessionId);
  if (!run.exists || !isVisible(req, run)) {
    res.status(404).json({ error: 'run outcome not found' });
    return;
  }

  const actor =
    typeof body.actor === 'string' && body.actor.length > 0
      ? body.actor
      : callerUserId(req) !== null
        ? `user:${callerUserId(req)}`
        : null;

  const event = await recordFeedback({
    sessionId: run.rootSessionId,
    source: 'explicit_user',
    verdict: verdict as UserVerdict,
    actor,
    reason: typeof body.reason === 'string' ? body.reason : null,
  });
  res.status(201).json(event);
});
