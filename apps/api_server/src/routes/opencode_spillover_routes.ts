import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { anthropicAccountsService } from '../services/anthropic_accounts_service';
import { broadcast, broadcastSessionUpdated } from '../services/ws_gateway';
import { logger } from '../utils/logger';
import { opencodeClient } from '../services/opencode_engine';
import { resolveCrossProviderHandoff } from '../services/model_fallback';

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
 *
 * #930 Unit 3 (scoped): the same intake ALSO accepts an account-exhaustion
 * signal — `exhausted: true`, no `toAccountId` — meaning the plugin has no
 * more Anthropic accounts to spill over to. api_server (never the vendored
 * plugin) decides the next CROSS-PROVIDER chain tier via
 * `resolveCrossProviderHandoff` (gated by the same global authed-providers
 * set, no new allowlist) and persists the new provider/model on the session
 * row. This mirrors the `_isEscalation` recursion-guard SHAPE used by
 * agent_runner.ts's escalateAndCapture: the decision is made ONCE per report
 * and does not recurse — a session that fails again after the handoff
 * surfaces as a normal error rather than auto-walking further down the chain.
 * Actually RE-DISPATCHING the in-flight turn's prompt on the new provider is
 * live-engine/session-continuity machinery (ws_gateway / opencode_stream_bridge)
 * intentionally left untouched here — this route's job stops at
 * "decide + persist + notify", which is what's safely unit-testable without a
 * live opencode engine (see #930 report for why the rest was not attempted).
 */
export const opencodeSpilloverRouter = Router();

if (!env.agentLocal) opencodeSpilloverRouter.use(requireAuth);

const repo = new AgentSessionsRepository();

opencodeSpilloverRouter.post('/', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const sdkSessionId = typeof body.sdkSessionId === 'string' ? body.sdkSessionId : '';
  const fromAccountId = typeof body.fromAccountId === 'string' ? body.fromAccountId : null;
  const toAccountId = typeof body.toAccountId === 'string' ? body.toAccountId : '';
  const reason = typeof body.reason === 'string' ? body.reason : 'rate_limited';
  const exhausted = body.exhausted === true;

  if (!sdkSessionId || (!toAccountId && !exhausted)) {
    res.status(400).json({ error: 'sdkSessionId and (toAccountId or exhausted) are required' });
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

  if (exhausted) {
    const authed = await opencodeClient.listAuthedProviders();
    // Only the Anthropic plugin reports `exhausted` today (no more Team/
    // Personal accounts) — the exhausted provider is always 'anthropic'.
    const handoff = resolveCrossProviderHandoff('anthropic', authed);
    if (!handoff) {
      logger.warn(
        `[Spillover] session ${session.id} (${sdkSessionId}) reported account exhaustion but no further authed fallback tier exists — leaving session as-is`,
      );
      res.status(202).json({ accepted: true, handoff: false });
      return;
    }

    repo.updateFields(session.id, { providerId: handoff.providerID, modelId: handoff.modelID });
    logger.info(
      `[Spillover] session ${session.id} (${sdkSessionId}) exhausted account options → cross-provider handoff to ${handoff.tier.label} (${handoff.providerID}/${handoff.modelID})`,
    );

    broadcast({
      v: 1,
      type: 'session.spillover',
      sessionId: session.id,
      fromAccountId,
      toAccountId: null,
      reason: 'rate_limit_cross_provider',
      toProvider: handoff.providerID,
      toModel: handoff.modelID,
      toTier: handoff.tier.label,
    });
    const updated = repo.findById(session.id);
    if (updated) broadcastSessionUpdated(updated);

    res.json({ ok: true, handoff: true, providerID: handoff.providerID, modelID: handoff.modelID });
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
