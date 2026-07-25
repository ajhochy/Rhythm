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

export const agentApprovalsRouter = Router();

if (!env.agentLocal) agentApprovalsRouter.use(requireAuth);

const controller = new AgentApprovalsController();
const securityController = new ExternalContentSecurityController();

agentApprovalsRouter.post('/', (req, res, next) => controller.create(req, res, next));
agentApprovalsRouter.post('/external-content/taint', (req, res, next) =>
  securityController.taint(req, res, next));
agentApprovalsRouter.post('/consume', (req, res, next) =>
  securityController.consume(req, res, next));
agentApprovalsRouter.get('/', (req, res, next) => controller.list(req, res, next));
agentApprovalsRouter.patch('/:id', (req, res, next) => controller.decide(req, res, next));
