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
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  ExternalContentSecurityService,
  parseSecurityAction,
  parseSecurityPayload,
  parseTrustedSecurityContext,
} from '../services/external_content_security_service';
import { verifyHumanApprovalSignature } from '../security/human_approval_security';

const repo = new AgentApprovalsRepository();
const security = new ExternalContentSecurityService();
const sessions = new AgentSessionsRepository();

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
        if (!binding) {
          // The session carries no taint, so consumeApproval will allow the
          // action outright. Say so explicitly instead of failing: this used to
          // be a 409, and an agent following "request approval before mutating"
          // treated it as a hard stop and abandoned the write.
          res.status(200).json({
            status: 'not_required',
            reason: 'no_external_content_taint',
          });
          return;
        }
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

      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
      // #895 follow-up (2026-08-03): a calling agent has no reliable way to
      // know its own agent_configs.id, and a model self-reporting it would be
      // a privilege-escalation risk anyway (it could claim a different,
      // auto-approve profile). Resolve the profile server-side from the
      // session's agent_kind — a logical FK to agent_configs.id — and only
      // fall back to the model-supplied agentConfigId when no session is
      // known (kept for callers with no session context yet).
      const sessionRecord = sessionId ? sessions.findById(sessionId) : null;
      const agentConfigId =
        sessionRecord?.agentKind ??
        (typeof body.agentConfigId === 'string' ? body.agentConfigId : null);
      const approval = repo.create({
        sessionId,
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
