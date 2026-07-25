/**
 * #895 — Agent approval gate routes.
 *
 *   POST  /agent-approvals       → create a pending (or auto-approved) approval
 *   GET   /agent-approvals       → list (?status=pending|approved|rejected|all, default pending)
 *   PATCH /agent-approvals/:id   → approve or reject
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentApprovalsController } from '../controllers/agent_approvals_controller';
import { ExternalContentSecurityController } from '../controllers/external_content_security_controller';
import { requireHumanApprovalCapability } from '../security/human_approval_security';

export const agentApprovalsRouter = Router();

const controller = new AgentApprovalsController();
const securityController = new ExternalContentSecurityController();

const requireInternalAuth = env.agentLocal
  ? []
  : [requireAuth];

agentApprovalsRouter.post(
  '/',
  ...requireInternalAuth,
  (req, res, next) => controller.create(req, res, next),
);
agentApprovalsRouter.post(
  '/external-content/taint',
  ...requireInternalAuth,
  (req, res, next) => securityController.taint(req, res, next),
);
agentApprovalsRouter.post(
  '/consume',
  ...requireInternalAuth,
  (req, res, next) => securityController.consume(req, res, next),
);
// Human surfaces never inherit AGENT_LOCAL's internal auth bypass. A model
// may hold RHYTHM_API_TOKEN, so reads and decisions additionally require the
// distinct app-Keychain capability whose digest alone is given to this child.
agentApprovalsRouter.get(
  '/',
  requireAuth,
  requireHumanApprovalCapability,
  (req, res, next) => controller.list(req, res, next),
);
agentApprovalsRouter.patch(
  '/:id',
  requireAuth,
  requireHumanApprovalCapability,
  (req, res, next) => controller.decide(req, res, next),
);
