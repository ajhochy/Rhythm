import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { anthropicAccountsService } from '../services/anthropic_accounts_service';
import { broadcast, broadcastSessionUpdated } from '../services/ws_gateway';
import { logger } from '../utils/logger';
import {
  advanceFallbackCascade,
  finalizeErrorStatus,
} from '../services/turn_redispatch';

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
 * plugin) advances the shared bounded cascade, gated by the global authed
 * provider set, and persists the new provider/model on the session row.
 * `providerID` is optional for backward compatibility with the Anthropic
 * plugin and allows the same authenticated intake to report another current
 * provider explicitly; duplicate/stale provider reports are rejected.
 *
 * #930 mid-run resume: the in-flight turn is ALSO re-dispatched onto the new
 * provider in the SAME engine session (revert failed turn → re-prompt the
 * retained composed prompt). The same bounded state machine also consumes
 * structured OpenAI/Google/OpenRouter `session.error` events from the stream
 * bridge, so this Anthropic-compatible POST is no longer the only driver.
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
  const exhaustedProviderID =
    typeof body.providerID === 'string' && body.providerID.trim().length > 0
      ? body.providerID.trim()
      : 'anthropic';

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
    const result = await advanceFallbackCascade(session.id, {
      providerID: exhaustedProviderID,
      message: `${exhaustedProviderID} provider exhausted`,
      fromAccountId,
    });
    if (result.outcome === 'terminal') {
      // If the bridge deferred the turn's error while we decided, finalize it
      // now — otherwise the session would hang in 'working' forever.
      if (result.error) finalizeErrorStatus(session.id, result.error);
      logger.warn(
        `[Spillover] session ${session.id} (${sdkSessionId}) reported ${exhaustedProviderID} exhaustion but no further authed fallback tier exists — leaving session as-is`,
      );
      res.status(202).json({ accepted: true, handoff: false });
      return;
    }
    if (result.outcome === 'stale') {
      res.status(202).json({ accepted: true, handoff: false, stale: true });
      return;
    }

    const handoff = result.decision;
    logger.info(
      `[Spillover] session ${session.id} (${sdkSessionId}) exhausted ${exhaustedProviderID} options → cross-provider handoff to ${handoff.tier.label} (${handoff.providerID}/${handoff.modelID})`,
    );

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
