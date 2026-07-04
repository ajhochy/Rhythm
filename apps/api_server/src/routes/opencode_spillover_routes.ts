import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { anthropicAccountsService } from '../services/anthropic_accounts_service';
import { broadcast, broadcastSessionUpdated } from '../services/ws_gateway';
import { logger } from '../utils/logger';

/**
 * Task D (dual Anthropic accounts) — spillover intake.
 *
 * The vendored engine plugin (rhythm-anthropic-accounts) POSTs here,
 * fire-and-forget, when it fails a session over to another account after a
 * rate limit. api_server is the single writer of anthropic-accounts.json, so
 * the durable routing update happens HERE (the plugin only flips an in-memory
 * override for the requests already in flight).
 *
 * Mounted at /opencode/spillover (see app.ts). AGENT_LOCAL bypass, same as
 * agent_configs_routes: localhost-only plugin traffic.
 */
export const opencodeSpilloverRouter = Router();

if (!env.agentLocal) opencodeSpilloverRouter.use(requireAuth);

const repo = new AgentSessionsRepository();

opencodeSpilloverRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const sdkSessionId = typeof body.sdkSessionId === 'string' ? body.sdkSessionId : '';
  const fromAccountId = typeof body.fromAccountId === 'string' ? body.fromAccountId : null;
  const toAccountId = typeof body.toAccountId === 'string' ? body.toAccountId : '';
  const reason = typeof body.reason === 'string' ? body.reason : 'rate_limited';

  if (!sdkSessionId || !toAccountId) {
    res.status(400).json({ error: 'sdkSessionId and toAccountId are required' });
    return;
  }

  const session = repo.findBySdkSessionId(sdkSessionId);
  if (!session) {
    // The engine can race ahead of the DB write of sdk_session_id (or report
    // for a session Rhythm never tracked). Accept and move on — the plugin's
    // in-memory override keeps the failover working either way.
    logger.warn(
      `[Spillover] no local session for sdkSessionId=${sdkSessionId} — accepted without persisting (202)`,
    );
    res.status(202).json({ accepted: true });
    return;
  }

  repo.setAnthropicAccountId(session.id, toAccountId);
  anthropicAccountsService.setRouting(sdkSessionId, toAccountId);
  logger.info(
    `[Spillover] session ${session.id} (${sdkSessionId}) moved ${fromAccountId ?? '?'} → ${toAccountId} (${reason})`,
  );

  broadcast({
    v: 1,
    type: 'session.spillover',
    sessionId: session.id,
    fromAccountId,
    toAccountId,
    reason,
  });
  const updated = repo.findById(session.id);
  if (updated) broadcastSessionUpdated(updated);

  res.json({ ok: true });
});
