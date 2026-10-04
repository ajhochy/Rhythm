import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app_error';
import {
  parseCancel,
  parseCriteriaBatch,
  parseCheckpoint,
  parseCriterionWaiver,
  parseCreate,
  parsePatch,
  parsePause,
  parseResume,
  parseRunNextForProject,
  parseUsageAcknowledgement,
  parseEvidenceSelector,
  parseEvidenceVerification,
} from '../contracts/agent_workstream_contract';
import {
  parseOneShotAutomationDisableRequest,
  parseOneShotAutomationRequest,
} from '../contracts/agent_workstream_automation_contract';
import { AgentWorkstreamsRepository } from '../repositories/agent_workstreams_repository';
import type { PersistentWorkstreamCoordinator } from '../services/persistent_workstream_coordinator';

const repo = new AgentWorkstreamsRepository();

function project(req: Request): string {
  const value = req.query.projectId;
  if (typeof value !== 'string' || !value) throw AppError.badRequest('projectId is required');
  return value;
}

function auth(req: Request) {
  if (!req.auth) throw AppError.unauthorized('Authentication required');
  return req.auth;
}

function listLimit(req: Request): number {
  const raw = req.query.limit;
  const limit = raw === undefined ? 50 : (typeof raw === 'string' ? Number(raw) : NaN);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw AppError.badRequest('limit must be 1..100');
  }
  return limit;
}

function cursor(req: Request): string | undefined {
  const value = req.query.cursor;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw AppError.badRequest('invalid cursor');
  }
  return value;
}

/** Authenticated normal-app controls; the coordinator owns every model action. */
export class AgentWorkstreamsController {
  constructor(private readonly coordinator?: PersistentWorkstreamCoordinator) {}

  create(req: Request, res: Response, next: NextFunction): void {
    try {
      const input = parseCreate(req.body);
      if (input.projectId !== project(req)) throw AppError.badRequest('projectId must match the selected project');
      const result = repo.create(auth(req).user.id, input);
      if (result.conflict) {
        res.status(409).json({ error: 'create_key_conflict' });
        return;
      }
      res.status(result.replay ? 200 : 201).json(result.row);
    } catch (error) { next(error); }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = auth(req);
      const scope = project(req);
      if (this.coordinator) {
        res.json(await this.coordinator.list(context, scope, listLimit(req), cursor(req)));
        return;
      }
      const limit = listLimit(req);
      const items = repo.list(context.user.id, scope, limit, cursor(req));
      res.json({ items, nextCursor: items.length === limit ? items.at(-1)?.id ?? null : null });
    } catch (error) { next(error); }
  }

  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = auth(req);
      const scope = project(req);
      if (this.coordinator) {
        res.json(await this.coordinator.status(context, scope, req.params.id));
        return;
      }
      const row = repo.find(context.user.id, scope, req.params.id);
      if (!row) { res.sendStatus(404); return; }
      res.json(row);
    } catch (error) { next(error); }
  }

  revise(req: Request, res: Response, next: NextFunction): void {
    try {
      const scope = project(req);
      const context = auth(req);
      const existing = repo.find(context.user.id, scope, req.params.id);
      if (!existing) { res.sendStatus(404); return; }
      const patch = parsePatch(req.body);
      if (patch.checkpoint !== undefined) patch.checkpoint = parseCheckpoint(patch.checkpoint, scope);
      const row = repo.revise(context.user.id, scope, req.params.id, patch.expectedRevision, patch);
      if (!row) { res.status(409).json({ error: 'revision_conflict' }); return; }
      res.json(row);
    } catch (error) { next(error); }
  }

  async pause(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const scope = project(req);
      const context = auth(req);
      const expected = parsePause(req.body);
      if (this.coordinator) {
        res.json(await this.coordinator.pause(context, scope, req.params.id, expected));
        return;
      }
      const row = repo.pause(context.user.id, scope, req.params.id, expected);
      if (!row) { res.status(409).json({ error: 'revision_conflict' }); return; }
      res.json(row);
    } catch (error) { next(error); }
  }

  async resume(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      res.json(await this.coordinator.resume(auth(req), project(req), req.params.id, parseResume(req.body)));
    } catch (error) { next(error); }
  }

  async runNext(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      const scope = project(req);
      res.json(await this.coordinator.runNext(
        auth(req),
        scope,
        req.params.id,
        parseRunNextForProject(req.body, scope),
      ));
    } catch (error) { next(error); }
  }

  async automationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      res.json(await this.coordinator.automationStatus(auth(req), project(req), req.params.id));
    } catch (error) { next(error); }
  }

  async configureAutomation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      const context = auth(req);
      res.json(await this.coordinator.configureAutomation(
        context,
        project(req),
        req.params.id,
        parseOneShotAutomationRequest(req.body, new Date()),
      ));
    } catch (error) { next(error); }
  }

  async disableAutomation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      const parsed = parseOneShotAutomationDisableRequest(req.body);
      res.json(await this.coordinator.disableAutomation(
        auth(req), project(req), req.params.id, parsed.expectedRevision, parsed.planId,
      ));
    } catch (error) { next(error); }
  }

  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      const parsed = parseCancel(req.body);
      res.json(await this.coordinator.cancel(
        auth(req), project(req), req.params.id,
        parsed.expectedRevision, parsed.jobId,
      ));
    } catch (error) { next(error); }
  }

  async acknowledgeUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      const parsed = parseUsageAcknowledgement(req.body);
      res.json(await this.coordinator.acknowledgeUsageEstimate(
        auth(req), project(req), req.params.id,
        parsed.expectedRevision, parsed.jobId, parsed.accept,
      ));
    } catch (error) { next(error); }
  }

  async reconcileUnknownFromEngine(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      const parsed = parseCancel(req.body);
      res.json(await this.coordinator.reconcileUnknownFromEngine(
        auth(req), project(req), req.params.id, parsed.expectedRevision, parsed.jobId,
      ));
    } catch (error) { next(error); }
  }

  async waiveCriterion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      const parsed = parseCriterionWaiver(req.body);
      res.json(await this.coordinator.waiveCriterion(
        auth(req), project(req), req.params.id,
        parsed.expectedRevision, parsed.jobId, parsed.criterionId,
      ));
    } catch (error) { next(error); }
  }

  async waiveCriteria(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      const parsed = parseCriteriaBatch(req.body);
      res.json(await this.coordinator.waiveCriteria(
        auth(req), project(req), req.params.id,
        parsed.expectedRevision, parsed.jobId, parsed.criterionIds,
      ));
    } catch (error) { next(error); }
  }

  async inspectEvidence(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      res.json(await this.coordinator.inspectEvidence(
        auth(req), project(req), req.params.id, parseEvidenceSelector(req.query.sourceId),
      ));
    } catch (error) { next(error); }
  }

  async verifyCriteria(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.coordinator) throw AppError.notFound('Workstream coordinator');
      res.json(await this.coordinator.verifyCriteriaFromEvidence(
        auth(req), project(req), req.params.id, parseEvidenceVerification(req.body),
      ));
    } catch (error) { next(error); }
  }
}
