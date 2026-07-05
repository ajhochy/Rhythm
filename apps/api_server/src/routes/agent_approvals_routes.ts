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

export const agentApprovalsRouter = Router();

if (!env.agentLocal) agentApprovalsRouter.use(requireAuth);

const controller = new AgentApprovalsController();

agentApprovalsRouter.post('/', (req, res, next) => controller.create(req, res, next));
agentApprovalsRouter.get('/', (req, res, next) => controller.list(req, res, next));
agentApprovalsRouter.patch('/:id', (req, res, next) => controller.decide(req, res, next));
