import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import { listPendingRelayCards, pendingRelayCard, decideRelayCard } from '../security/relay_approval_security';
import { agentApprovalContinuationService } from '../services/agent_approval_continuation_service';

export class RelayApprovalsController {
  list(req: Request, res: Response, next: NextFunction): void {
    try {
      if (!req.auth) throw AppError.unauthorized('Authenticated owner is required');
      res.json(listPendingRelayCards(req.auth.user.id));
    } catch (error) { next(error); }
  }
  get(req: Request, res: Response, next: NextFunction): void {
    try {
      if (!req.auth) throw AppError.unauthorized('Authenticated owner is required');
      res.json(pendingRelayCard(req.params.id, req.auth.user.id));
    } catch (error) { next(error); }
  }
  async decide(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw AppError.unauthorized('Authenticated owner is required');
      const { approval, result } = decideRelayCard(req.auth.user, req.params.id, req.body ?? {});
      await agentApprovalContinuationService.onDecision(approval);
      res.json(result);
    } catch (error) { next(error); }
  }
}
