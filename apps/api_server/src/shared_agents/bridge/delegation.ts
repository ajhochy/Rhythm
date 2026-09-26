import type { Request, Response, Router } from 'express';

import type { BridgeDeps } from './common';
import {
  BRIDGE_RATE_LIMITS,
  bridgeGrant,
  claimConcurrencyLimit,
  grantRateLimit,
  runtime,
  sendBridgeError,
} from './common';
import {
  BridgeDelegationError,
  DelegationCoordinator,
} from '../delegation_coordinator';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CHILD_SESSION_KEY = /^[A-Za-z0-9._:-]{1,256}$/;
const SAFE_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const LATEST_KINDS = new Set(['tool', 'message', 'approval_denied']);
const dispatchRateLimit = grantRateLimit(
  'delegation.dispatch',
  BRIDGE_RATE_LIMITS.dispatchPerMinute,
);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(body: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(body).every((key) => keys.includes(key));
}

function parent(value: unknown): { projectionId: string; sessionKey: string } | null {
  const input = record(value);
  if (!input || !exact(input, ['projectionId', 'sessionKey'])) return null;
  return typeof input.projectionId === 'string' && input.projectionId.length <= 128 &&
    typeof input.sessionKey === 'string' && input.sessionKey.length <= 256
    ? { projectionId: input.projectionId, sessionKey: input.sessionKey }
    : null;
}

function handle(error: unknown, res: Response): void {
  if (error instanceof BridgeDelegationError) {
    sendBridgeError(res, error.statusCode, error.code);
    return;
  }
  throw error;
}

export function register(router: Router, _deps: BridgeDeps): void {
  // ponytail: lazy singleton — constructing DelegationCoordinator eagerly here
  // runs at createApp()/router-registration time (before some tests' setDb()
  // call), and its default AgentBridgeJobsRepository() touches getDb() immediately.
  let coordinatorInstance: DelegationCoordinator | undefined;
  const coordinator = (): DelegationCoordinator => {
    if (!coordinatorInstance) {
      coordinatorInstance = new DelegationCoordinator();
    }
    return coordinatorInstance;
  };

  router.post('/delegations', runtime('delegation.dispatch'), dispatchRateLimit, async (req: Request, res: Response) => {
    const body = record(req.body);
    const caller = parent(body?.parent);
    if (!body || !caller || !exact(body, ['idempotencyKey', 'parent', 'targetAgentId', 'prompt', 'context']) ||
        typeof body.idempotencyKey !== 'string' || !UUID.test(body.idempotencyKey) ||
        typeof body.targetAgentId !== 'string' || !body.targetAgentId || body.targetAgentId.length > 128 ||
        typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 32_768 ||
        (body.context !== undefined && body.context !== null &&
          (typeof body.context !== 'string' || body.context.length > 16_384))) {
      sendBridgeError(res, 400, 'bridge_invalid_request');
      return;
    }
    try {
      const result = await coordinator().dispatchFromHermes(bridgeGrant(res), {
        idempotencyKey: body.idempotencyKey,
        parent: caller,
        targetAgentId: body.targetAgentId,
        prompt: body.prompt.trim(),
        context: typeof body.context === 'string' ? body.context : null,
      });
      res.status(result.replay ? 200 : 201).json({ job: result.job });
    } catch (error) { handle(error, res); }
  });

  router.post('/delegations/query', runtime('delegation.dispatch'), (req: Request, res: Response) => {
    const body = record(req.body);
    const caller = parent(body?.parent);
    if (!body || !caller || !exact(body, ['parent', 'jobId']) ||
        (body.jobId !== undefined && typeof body.jobId !== 'string')) {
      sendBridgeError(res, 400, 'bridge_invalid_request'); return;
    }
    try {
      res.json({ jobs: coordinator().queryFromHermes(
        bridgeGrant(res), caller, typeof body.jobId === 'string' ? body.jobId : undefined,
      ) });
    } catch (error) { handle(error, res); }
  });

  router.post('/delegations/claim', runtime('delegation.execute'), claimConcurrencyLimit, async (req: Request, res: Response) => {
    const body = record(req.body);
    if (!body || !exact(body, ['waitMs']) || !Number.isInteger(body.waitMs) ||
        Number(body.waitMs) < 0 || Number(body.waitMs) > 20_000) {
      sendBridgeError(res, 400, 'bridge_invalid_request'); return;
    }
    const abort = new AbortController();
    const onAborted = (): void => abort.abort();
    req.once('aborted', onAborted);
    res.once('close', onAborted);
    try {
      const claimed = await coordinator().claimWithWait(
        bridgeGrant(res),
        Number(body.waitMs),
        abort.signal,
      );
      if (abort.signal.aborted) return;
      if (!claimed) { res.status(204).end(); return; }
      res.json(claimed);
    } catch (error) { handle(error, res); }
    finally {
      req.off('aborted', onAborted);
      res.off('close', onAborted);
    }
  });

  router.post('/delegations/:jobId/result', runtime('delegation.dispatch'), (req: Request, res: Response) => {
    const body = record(req.body);
    const caller = parent(body?.parent);
    if (!body || !caller || !exact(body, ['parent'])) {
      sendBridgeError(res, 400, 'bridge_invalid_request'); return;
    }
    try { res.json(coordinator().resultFromHermes(bridgeGrant(res), caller, req.params.jobId)); }
    catch (error) { handle(error, res); }
  });

  router.post('/delegations/:jobId/cancel', runtime('delegation.dispatch'), async (req: Request, res: Response) => {
    const body = record(req.body);
    const caller = parent(body?.parent);
    if (!body || !caller || !exact(body, ['parent'])) {
      sendBridgeError(res, 400, 'bridge_invalid_request'); return;
    }
    try { res.json({ job: await coordinator().cancelFromHermes(bridgeGrant(res), caller, req.params.jobId) }); }
    catch (error) { handle(error, res); }
  });

  router.post('/delegations/:jobId/report', runtime('delegation.execute'), (req: Request, res: Response) => {
    const body = record(req.body);
    const progress = record(body?.progress);
    const phases = new Set(['running', 'progress', 'succeeded', 'failed', 'cancelled']);
    if (!body || !exact(body, ['leaseToken', 'phase', 'childSessionKey', 'progress', 'resultText', 'errorCode']) ||
        typeof body.leaseToken !== 'string' || body.leaseToken.length !== 43 ||
        typeof body.phase !== 'string' || !phases.has(body.phase) ||
        (body.childSessionKey !== undefined &&
          (typeof body.childSessionKey !== 'string' || !SAFE_CHILD_SESSION_KEY.test(body.childSessionKey))) ||
        (body.resultText !== undefined && (typeof body.resultText !== 'string' ||
          Buffer.byteLength(body.resultText, 'utf8') > 65_536)) ||
        (body.errorCode !== undefined &&
          (typeof body.errorCode !== 'string' || !SAFE_ERROR_CODE.test(body.errorCode))) ||
        (body.progress !== undefined && (!progress || !exact(progress, ['steps', 'latestKind']) ||
          !Number.isInteger(progress.steps) || Number(progress.steps) < 0 ||
          typeof progress.latestKind !== 'string' || !LATEST_KINDS.has(progress.latestKind)))) {
      sendBridgeError(res, 400, 'bridge_invalid_request'); return;
    }
    try {
      res.json(coordinator().report(bridgeGrant(res), req.params.jobId, {
        jobId: req.params.jobId,
        leaseToken: body.leaseToken,
        phase: body.phase as 'running' | 'progress' | 'succeeded' | 'failed' | 'cancelled',
        childSessionKey: typeof body.childSessionKey === 'string' ? body.childSessionKey : undefined,
        progress: progress as { steps: number; latestKind: string } | undefined,
        resultText: typeof body.resultText === 'string' ? body.resultText : undefined,
        errorCode: typeof body.errorCode === 'string' ? body.errorCode : undefined,
        now: new Date().toISOString(),
      }));
    } catch (error) { handle(error, res); }
  });
}
