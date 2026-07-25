import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { OrgOptimizerRunController } from '../controllers/org_optimizer_run_controller';

const router = Router();
const controller = new OrgOptimizerRunController();

/**
 * Local agent-server auth posture — same as agent-org-proposals/agent-webhooks:
 * the AGENT_LOCAL bypass is scoped to localhost-only traffic (the embedded
 * api_server process for the desktop app) and is never exposed externally.
 * Tool-level access control (which agent/session may call this route) is
 * enforced upstream by the MCP dispatch guard (#736) against the calling
 * session's role-scoped allowlist — see .mcp-roles/org-optimizer.mcp.json.
 */
if (!env.agentLocal) router.use(requireAuth);

router.post('/run', (req, res, next) => controller.run(req, res, next));
router.post('/external-discovery', (req, res, next) => controller.runExternalDiscovery(req, res, next));

export default router;
