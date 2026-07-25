/**
 * #895 — Agent approval gate.
 *
 * An agent calls rhythm_request_approval (MCP tool → POST /agent-approvals)
 * before an irreversible action (scheduling, emailing, updating a PCO plan
 * item). The row is created 'pending' unless the calling profile has
 * auto_approve_actions set. A human then approves/rejects via PATCH, which
 * the Flutter notification panel surfaces as an approval card.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import {
  AgentApprovalsRepository,
  isAutoApproveProfile,
  type AgentApprovalStatus,
} from '../repositories/agent_approvals_repository';
import {
  ExternalContentSecurityService,
  parseSecurityAction,
  parseSecurityPayload,
  parseTrustedSecurityContext,
} from '../services/external_content_security_service';
import { verifyHumanApprovalSignature } from '../security/human_approval_security';

const repo = new AgentApprovalsRepository();
const security = new ExternalContentSecurityService();

export class AgentApprovalsController {
  create(req: Request, res: Response, next: NextFunction): void {
    try {
      const body = req.body ?? {};
      const action = typeof body.action === 'string' ? body.action.trim() : '';
      if (!action) throw AppError.badRequest('action is required');

      if (body.security !== undefined) {
        if (!body.security || typeof body.security !== 'object' || Array.isArray(body.security)) {
          throw AppError.badRequest('security must be an object');
        }
        const securityInput = body.security as Record<string, unknown>;
        const binding = security.createApprovalBinding(
          parseTrustedSecurityContext(securityInput.context),
          parseSecurityAction(securityInput.action),
          parseSecurityPayload(securityInput.payload),
        );
        const approval = repo.create({
          sessionId: binding.sessionId,
          agentConfigId: binding.agentConfigId,
          // Security-bound cards use a server-authored action label and
          // canonical payload preview so untrusted/model text cannot misstate
          // what the human is approving.
          action: `Authorize ${binding.securityAction}`,
          preview: binding.preview,
          consequence: typeof body.consequence === 'string' ? body.consequence : null,
          autoApprove: false,
          securityAction: binding.securityAction,
          payloadDigest: binding.payloadDigest,
          taintId: binding.taintId,
          taintedTurnId: binding.taintedTurnId,
          boundAgent: binding.boundAgent,
          expiresAt: binding.expiresAt,
        });
        res.status(201).json(approval);
        return;
      }

      const agentConfigId = typeof body.agentConfigId === 'string' ? body.agentConfigId : null;
      const approval = repo.create({
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
        agentConfigId,
        action,
        preview: typeof body.preview === 'string' ? body.preview : null,
        consequence: typeof body.consequence === 'string' ? body.consequence : null,
        autoApprove: isAutoApproveProfile(agentConfigId),
      });

      res.status(201).json(approval);
    } catch (err) {
      next(err);
    }
  }

  list(req: Request, res: Response, next: NextFunction): void {
    try {
      const statusParam = req.query.status;
      let status: AgentApprovalStatus | null = 'pending';
      if (statusParam === 'all') {
        status = null;
      } else if (
        statusParam === 'pending' ||
        statusParam === 'approved' ||
        statusParam === 'rejected'
      ) {
        status = statusParam;
      } else if (statusParam !== undefined) {
        throw AppError.badRequest('status must be one of pending, approved, rejected, all');
      }

      res.json(repo.list(status));
    } catch (err) {
      next(err);
    }
  }

  decide(req: Request, res: Response, next: NextFunction): void {
    try {
      const { id } = req.params;
      const body = req.body ?? {};
      if (body.status !== 'approved' && body.status !== 'rejected') {
        throw AppError.badRequest('status must be "approved" or "rejected"');
      }
      if (typeof body.signature !== 'string' || body.signature.trim() === '') {
        throw AppError.forbidden('A signed human decision is required');
      }
      const actorUser = req.auth?.user;
      if (!actorUser) {
        throw AppError.unauthorized('Authenticated human identity is required');
      }
      const existing = repo.getById(id);
      if (!existing || existing.status !== 'pending') {
        throw AppError.notFound(
          'agent approval (or it is no longer pending)',
        );
      }
      if (!existing.decisionNonce) {
        throw AppError.forbidden(
          'Approval predates signed decisions and must be requested again',
        );
      }
      if (
        !verifyHumanApprovalSignature({
          approvalId: id,
          status: body.status,
          decisionNonce: existing.decisionNonce,
          payloadDigest: existing.payloadDigest,
          signature: body.signature,
        })
      ) {
        throw AppError.forbidden('Human approval signature is invalid');
      }

      const updated = repo.decideWithNonce(
        id,
        body.status,
        `user:${actorUser.id}`,
        existing.decisionNonce,
      );
      if (!updated) {
        throw AppError.notFound('agent approval (or it is no longer pending)');
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
}
