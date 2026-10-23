import { Router } from 'express';
import { AppError } from '../errors/app_error';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { decideWebCard, listPendingRelayCards } from '../security/relay_approval_security';
import { agentApprovalContinuationService } from '../services/agent_approval_continuation_service';
import { webHostOwner } from '../services/web_host';

// Mounted only in configured host mode, behind the exact Host/Origin guard.
// The server supplies its validated owner; no browser bearer or signing key.
export function createWebApprovalsRouter() {
  const router = Router();
  const approvals = new AgentApprovalsRepository();
  router.get('/', (req, res, next) => {
    try {
      const owner = webHostOwner();
      if (!owner) throw AppError.notFound('web approvals');
      if (req.query.status !== undefined && req.query.status !== 'pending') throw AppError.badRequest('Only pending cards may be listed');
      res.setHeader('Cache-Control', 'no-store');
      res.json(listPendingRelayCards(owner.id).map(card => ({ ...card,
        sessionId: approvals.getById(card.id)!.sessionId, status: 'pending', decisionMode: 'trusted-tailnet-web' })));
    } catch (error) { next(error); }
  });
  router.patch('/:id', async (req, res, next) => {
    try {
      const owner = webHostOwner();
      if (!owner) throw AppError.notFound('web approvals');
      const { approval, result } = decideWebCard(owner, req.params.id, req.body);
      await agentApprovalContinuationService.onDecision(approval);
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) { next(error); }
  });
  return router;
}
