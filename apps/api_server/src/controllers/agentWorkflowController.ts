import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { RecipeWorkflowRunner } from '../services/recipe_workflow_runner';
import type { RunInput } from '../contracts/recipe_workflow_contract';

const runner = new RecipeWorkflowRunner();

/**
 * #1485 S3a-1 — start/get/cancel only. Flutter (the only caller in S3a) sends
 * no bearer for these local-agent routes (see agentWorkflowRoutes.ts); the
 * completion endpoint MCP-signed callers need is S3b.
 */
export class AgentWorkflowController {
  async start(req: Request, res: Response, next: NextFunction) {
    try {
      const { recipeId, input } = req.body as { recipeId?: unknown; input?: unknown };
      if (!recipeId || typeof recipeId !== 'string') {
        throw AppError.badRequest('recipeId is required');
      }
      const runInput: RunInput = {};
      if (input && typeof input === 'object') {
        for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
          if (typeof value === 'string') runInput[key] = value;
        }
      }
      const ownerUserId = req.mobileDevice?.userId ?? req.auth?.user.id ?? null;
      const result = await runner.start({ recipeId, ownerUserId, input: runInput });
      if (!result.ok) {
        if (result.reason === 'disabled' || result.reason === 'workflow_execution_unavailable') {
          res.status(409).json({ error: result.reason });
          return;
        }
        throw AppError.badRequest(`Invalid recipe: ${result.reason}`);
      }
      res.status(202).json({ runId: result.runId, status: result.status });
    } catch (err) {
      next(err);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      // #1485 S3a review fix — ownership check: the SAME identity start()
      // stamps ownerUserId with (mobile device, then desktop/web session
      // user, else null for a trusted local caller) must own the run, or the
      // route 404s rather than leaking another user's run existence/content.
      const ownerUserId = req.mobileDevice?.userId ?? req.auth?.user.id ?? null;
      const dto = runner.getDto(req.params.id, ownerUserId);
      if (!dto) throw AppError.notFound('RecipeWorkflowRun');
      res.json(dto);
    } catch (err) {
      next(err);
    }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const ownerUserId = req.mobileDevice?.userId ?? req.auth?.user.id ?? null;
      const result = await runner.cancel(req.params.id, ownerUserId);
      if (!result.ok) throw AppError.notFound('RecipeWorkflowRun');
      res.status(202).json({ runId: req.params.id, status: result.status });
    } catch (err) {
      next(err);
    }
  }
}
