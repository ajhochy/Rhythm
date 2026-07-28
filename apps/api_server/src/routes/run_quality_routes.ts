import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { getRunQualityRollup, ingestToolEvent, isToolTelemetryEnabled } from '../services/run_quality_service';

export const runQualityRouter = Router();

if (!env.agentLocal) runQualityRouter.use(requireAuth);

/**
 * GET /agents/run-quality
 *
 * Plain-language QUALITY scorecard for recent agent runs (#865), DISTINCT
 * from the per-provider SPEND view (GET /agents/usage-budget). Per agent
 * (agent_kind grouping): completion vs escalation, token waste (a subset of
 * spend — see run_quality_service.ts doc comment), user corrections, and
 * repeated mistakes. READ-ONLY — never wired into the org-optimizer auto-tune
 * loop (#816 is the separate, explicitly-scoped concern for that).
 *
 * Query params:
 *   windowDays  Lookback window in days (default 30).
 */
runQualityRouter.get('/', (req: Request, res: Response) => {
  try {
    const windowDaysRaw = req.query.windowDays;
    const windowDays =
      typeof windowDaysRaw === 'string' && Number.isFinite(Number(windowDaysRaw)) && Number(windowDaysRaw) > 0
        ? Number(windowDaysRaw)
        : undefined;
    const rollup = getRunQualityRollup({
      windowDays,
      ...(req.mobileDevice
        ? { ownerUserId: req.mobileDevice.userId }
        : {}),
    });
    res.json(rollup);
  } catch (err) {
    res.status(503).json({
      error: 'run quality rollup unavailable',
      ...(!req.mobileDevice ? { detail: String(err) } : {}),
    });
  }
});

/**
 * POST /agents/run-quality/tool-events — #1069 (OCU-28) ingestion endpoint the
 * vendored rhythm-telemetry plugin POSTs to (fire-and-forget, from inside the
 * engine subprocess via RHYTHM_API_BASE). Always responds fast — persistence
 * failures are swallowed inside ingestToolEvent so a plugin retry storm can
 * never cascade into a slow/failing response. Disabled via the same
 * RHYTHM_TOOL_TELEMETRY_DISABLED flag the plugin itself checks (defense in
 * depth — accepts and silently drops rather than erroring, since a stale
 * plugin process from before the flag flipped may still be sending events).
 */
runQualityRouter.post('/tool-events', (req: Request, res: Response) => {
  if (!isToolTelemetryEnabled()) {
    res.status(202).end(); // accepted-and-dropped — never surfaces as a plugin-side error
    return;
  }
  const body = req.body as Record<string, unknown>;
  if (
    typeof body?.sessionID !== 'string' ||
    typeof body?.callID !== 'string' ||
    typeof body?.tool !== 'string' ||
    typeof body?.startedAt !== 'number' ||
    typeof body?.durationMs !== 'number'
  ) {
    res.status(400).json({ error: 'malformed tool event' });
    return;
  }
  ingestToolEvent({
    sessionID: body.sessionID,
    callID: body.callID,
    tool: body.tool,
    startedAt: body.startedAt,
    durationMs: body.durationMs,
    status: body.status === 'error' ? 'error' : 'success',
    errorClass: typeof body.errorClass === 'string' ? body.errorClass : null,
  });
  res.status(202).end();
});
