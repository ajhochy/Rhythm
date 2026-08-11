import type { NextFunction, Request, Response } from 'express';
import { PcoPermissionError, PlanningCenterService } from '../integrations/planning_center/planning_center_service';
import { AppError } from '../errors/app_error';
import { LiveArtifactsRepository } from '../repositories/live_artifacts_repository';
import { IntegrationsService } from '../services/integrations_service';
import { logger } from '../utils/logger';

const repo = new LiveArtifactsRepository();
const integrations = new IntegrationsService();
const planningCenter = new PlanningCenterService();
// ponytail: single-process Synology limiter; use a shared store if deployment becomes multi-instance.
const requests = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const LIMIT = 30;

// ponytail: test seam only — an injected clock keeps window-reset/pruning tests off wall-clock timers,
// and reset() clears the module-level window between tests. Production always uses Date.now().
export const capabilityRateLimit = {
  now: () => Date.now(),
  reset: () => requests.clear(),
  size: () => requests.size,
};

const PCO_DISCONNECTED_MESSAGE = 'Planning Center is not connected';

type CapabilityRequest =
  | { operation: 'list_service_types' }
  | { operation: 'list_plans'; serviceTypeId: string; filter: 'future' | 'past' }
  | { operation: 'list_plan_items'; serviceTypeId: string; planId: string };

function id(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw AppError.badRequest(`${name} must be a safe identifier`);
  }
  return value;
}

function request(body: unknown): CapabilityRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw AppError.badRequest('invalid capability request');
  const input = body as Record<string, unknown>;
  if (input.operation === 'list_service_types' && Object.keys(input).length === 1) return { operation: input.operation };
  if (input.operation === 'list_plans' && Object.keys(input).length === 3 && (input.filter === 'future' || input.filter === 'past')) return { operation: input.operation, serviceTypeId: id(input.serviceTypeId, 'serviceTypeId'), filter: input.filter };
  if (input.operation === 'list_plan_items' && Object.keys(input).length === 3) return { operation: input.operation, serviceTypeId: id(input.serviceTypeId, 'serviceTypeId'), planId: id(input.planId, 'planId') };
  throw AppError.badRequest('unsupported capability request');
}

function rateLimit(key: string): number | null {
  const now = capabilityRateLimit.now();
  for (const [candidate, value] of requests) if (value.resetAt <= now) requests.delete(candidate);
  const current = requests.get(key);
  if (current && current.count >= LIMIT) return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  if (current) current.count += 1;
  else requests.set(key, { count: 1, resetAt: now + WINDOW_MS });
  return null;
}

export class LiveArtifactCapabilitiesController {
  async readPcoServices(req: Request, res: Response, next: NextFunction) {
    const actor = req.auth!.user.id;
    const artifactId = req.params.id;
    let operation: CapabilityRequest['operation'] | null = null;
    // Audit is deliberately limited to actor/artifact/operation/outcome/timestamp: never the
    // request body, upstream URL, PCO account internals, or any token.
    // ponytail: outcome is one bit (did the capability return data). Add denial reason codes only
    // when something actually consumes them — the error response already carries the machine code.
    const audit = (outcome: 'success' | 'failure') =>
      logger.info('Live artifact PCO capability completed', { actorUserId: actor, artifactId, operation, at: new Date().toISOString(), outcome });
    try {
      const artifact = await repo.find(artifactId);
      if (!artifact || !(await repo.canRead(artifact, actor))) throw AppError.notFound('Live artifact');
      if (artifact.deletedAt) { audit('failure'); return res.status(410).json({ error: { code: 'artifact_deleted', message: 'Artifact deleted' } }); }
      if (!artifact.declaredCapabilities.includes('pco.services.read')) throw new AppError(403, 'capability_not_declared', 'Capability is not declared');
      const retryAfter = rateLimit(`${actor}:${artifact.id}`);
      if (retryAfter !== null) { audit('failure'); return res.status(429).json({ error: { code: 'capability_rate_limited', message: 'Too many capability requests', retryAfter } }); }
      const input = request(req.body);
      operation = input.operation;
      const account = await integrations.ensureFreshPlanningCenterAccount(actor).catch((error: unknown) => {
        // ponytail: map only the known integration-missing error to a stable capability code so a
        // disconnected account is distinguishable from schema rejection. Shared IntegrationsService
        // behavior is unchanged; anything else propagates untouched.
        if (error instanceof AppError && error.statusCode === 400 && error.message === PCO_DISCONNECTED_MESSAGE) {
          throw new AppError(400, 'pco_not_connected', PCO_DISCONNECTED_MESSAGE);
        }
        throw error;
      });
      const data = input.operation === 'list_service_types'
        ? await planningCenter.listServiceTypes(account)
        : input.operation === 'list_plans'
          ? await planningCenter.listPlans(account, input.serviceTypeId, input.filter)
          : await planningCenter.listPlanItems(account, input.serviceTypeId, input.planId);
      audit('success');
      res.json({ operation: input.operation, data });
    } catch (error) {
      if (error instanceof PcoPermissionError) { audit('failure'); return res.status(403).json({ error: { code: 'pco_permission_denied', message: error.message } }); }
      audit('failure');
      next(error);
    }
  }
}
