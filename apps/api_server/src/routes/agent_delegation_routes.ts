import { Router } from 'express';
import { requireAuth, authenticateIfPresent } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentDelegationController } from '../controllers/agent_delegation_controller';

const controller = new AgentDelegationController();
export const agentDelegationRouter = Router();

// Delegation is an owner-scoped action even on the loopback-only agent server, so
// a valid bearer is still preferred and is the ONLY accepted identity off-loopback.
//
// But requiring it outright made delegation unusable. The bearer is written into
// `~/.config/opencode/opencode.json` by `POST /opencode/mcp/rhythm/ensure`, which
// the desktop app calls with the user's CURRENT token — and nothing ever re-pushes
// it. Measured 2026-08-05: the configured token was absent from the local
// `sessions` table and returned 403 from production too, i.e. stale in both auth
// domains. Delegation is the only consumer that validates that token (every other
// agent route takes the AGENT_LOCAL bypass), so it was the only thing that broke,
// silently and permanently: `rhythm_delegate_async` never once succeeded.
//
// Under AGENT_LOCAL the request is loopback-only and every other agent capability
// is already reachable without a bearer, so falling back to the CALLER SESSION's
// owner is not a weakening — it is the same owner-scoping, derived from the session
// row instead of a token that has to be manually kept in sync. `authenticateIfPresent`
// still honors a good bearer when one exists; the fallback is refused unless
// AGENT_LOCAL is set, so a hosted deployment keeps hard bearer enforcement.
agentDelegationRouter.use(env.agentLocal ? authenticateIfPresent : requireAuth);

agentDelegationRouter.post('/delegate', controller.delegate.bind(controller));
agentDelegationRouter.post('/delegate-async', controller.delegateAsync.bind(controller));
