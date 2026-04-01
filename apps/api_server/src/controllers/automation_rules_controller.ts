import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AutomationRulesRepository } from '../repositories/automation_rules_repository';
import { AutomationCatalogService } from '../services/automation_catalog_service';

const repo = new AutomationRulesRepository();
const catalog = new AutomationCatalogService();

export class AutomationRulesController {
  getAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findAll(req.auth?.user.id));
    } catch (err) {
      next(err);
    }
  }

  getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findById(req.params.id, req.auth?.user.id));
    } catch (err) {
      next(err);
    }
  }

  getPreview(req: Request, res: Response, next: NextFunction) {
    try {
      const rule = repo.findById(req.params.id, req.auth?.user.id);
      res.json({
        ruleId: rule.id,
        previewSample: rule.previewSample,
        lastMatchedAt: rule.lastMatchedAt,
        lastEvaluatedAt: rule.lastEvaluatedAt,
        matchCountLastRun: rule.matchCountLastRun,
        summary: `${rule.name}: ${rule.triggerKey} -> ${rule.actionType}`,
      });
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        name,
        source,
        triggerKey,
        triggerConfig,
        actionType,
        actionConfig,
        enabled,
        sourceAccountId,
      } = req.body as Record<string, unknown>;

      if (!name || typeof name !== 'string') {
        throw AppError.badRequest('name is required');
      }
      if (!source || typeof source !== 'string') {
        throw AppError.badRequest('source is required');
      }
      if (!triggerKey || !catalog.isValidTriggerKey(String(triggerKey))) {
        throw AppError.badRequest('triggerKey is invalid');
      }
      const trigger = catalog.findTrigger(String(triggerKey));
      if (trigger == null || trigger.source !== source) {
        throw AppError.badRequest('triggerKey does not belong to source');
      }
      if (!actionType || !catalog.isValidActionType(String(actionType))) {
        throw AppError.badRequest('actionType is invalid');
      }

      const rule = repo.create({
        name,
        source: source as never,
        triggerKey: triggerKey as never,
        triggerConfig:
          triggerConfig && typeof triggerConfig === 'object'
            ? (triggerConfig as Record<string, unknown>)
            : undefined,
        actionType: actionType as never,
        actionConfig:
          actionConfig && typeof actionConfig === 'object'
            ? (actionConfig as Record<string, unknown>)
            : undefined,
        enabled: typeof enabled === 'boolean' ? enabled : true,
        ownerId: req.auth?.user.id ?? null,
        sourceAccountId: typeof sourceAccountId === 'string' ? sourceAccountId : null,
      });

      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  }

  update(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as Record<string, unknown>;
      if (
        body.triggerKey &&
        (!catalog.isValidTriggerKey(String(body.triggerKey)) ||
          (body.source &&
            catalog.findTrigger(String(body.triggerKey))?.source !== body.source))
      ) {
        throw AppError.badRequest('triggerKey is invalid');
      }
      if (
        body.actionType &&
        !catalog.isValidActionType(String(body.actionType))
      ) {
        throw AppError.badRequest('actionType is invalid');
      }
      const rule = repo.update(
        req.params.id,
        {
          name: typeof body.name === 'string' ? body.name : undefined,
          source: typeof body.source === 'string' ? (body.source as never) : undefined,
          triggerKey:
            typeof body.triggerKey === 'string'
              ? (body.triggerKey as never)
              : undefined,
          triggerConfig:
            body.triggerConfig && typeof body.triggerConfig === 'object'
              ? (body.triggerConfig as Record<string, unknown>)
              : body.triggerConfig === null
                ? null
                : undefined,
          actionType:
            typeof body.actionType === 'string'
              ? (body.actionType as never)
              : undefined,
          actionConfig:
            body.actionConfig && typeof body.actionConfig === 'object'
              ? (body.actionConfig as Record<string, unknown>)
              : body.actionConfig === null
                ? null
                : undefined,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
          sourceAccountId:
            typeof body.sourceAccountId === 'string'
              ? body.sourceAccountId
              : body.sourceAccountId === null
                ? null
                : undefined,
        },
        req.auth?.user.id,
      );
      res.json(rule);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction) {
    try {
      repo.delete(req.params.id, req.auth?.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
