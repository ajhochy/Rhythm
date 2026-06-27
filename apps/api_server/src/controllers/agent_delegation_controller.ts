import type { NextFunction, Request, Response } from 'express';
import { delegateToAgent } from '../services/agent_delegation_service';

export class AgentDelegationController {
  async delegate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const result = await delegateToAgent({
        callerAgentConfigId:
          typeof body.callerAgentConfigId === 'string' ? body.callerAgentConfigId : '',
        targetAgentConfigId:
          typeof body.targetAgentConfigId === 'string' ? body.targetAgentConfigId : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        callerSessionId: typeof body.callerSessionId === 'string' ? body.callerSessionId : null,
        depth: typeof body.depth === 'number' ? body.depth : 0,
        context: typeof body.context === 'string' ? body.context : null,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}
