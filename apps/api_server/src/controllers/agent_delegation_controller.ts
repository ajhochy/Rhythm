import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import {
  delegateToAgent,
  delegateToAgentAsync,
} from '../services/agent_delegation_service';

export class AgentDelegationController {
  async delegate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const authenticatedUserId = req.auth?.user.id;
      if (!authenticatedUserId) {
        throw AppError.unauthorized('Authenticated user is required for delegation');
      }
      const result = await delegateToAgent({
        authenticatedUserId,
        callerAgentConfigId:
          typeof body.callerAgentConfigId === 'string' ? body.callerAgentConfigId : null,
        targetAgentConfigId:
          typeof body.targetAgentConfigId === 'string' ? body.targetAgentConfigId : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        callerSessionId: typeof body.callerSessionId === 'string' ? body.callerSessionId : '',
        context: typeof body.context === 'string' ? body.context : null,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async delegateAsync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const authenticatedUserId = req.auth?.user.id;
      if (!authenticatedUserId) {
        throw AppError.unauthorized('Authenticated user is required for delegation');
      }
      const result = await delegateToAgentAsync({
        authenticatedUserId,
        callerAgentConfigId:
          typeof body.callerAgentConfigId === 'string' ? body.callerAgentConfigId : null,
        targetAgentConfigId:
          typeof body.targetAgentConfigId === 'string' ? body.targetAgentConfigId : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        callerSessionId: typeof body.callerSessionId === 'string' ? body.callerSessionId : '',
        context: typeof body.context === 'string' ? body.context : null,
      });
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  }
}
