import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AutomationRulesRepository } from '../repositories/automation_rules_repository';
import type {
  AutomationActionType,
  AutomationTriggerType,
} from '../models/automation_rule';

const VALID_TRIGGER_TYPES: AutomationTriggerType[] = [
  'project_step_due',
  'task_due',
  'plan_assembly',
];

const VALID_ACTION_TYPES: AutomationActionType[] = [
  'auto_schedule',
  'send_notification',
  'tag_task',
];

const repo = new AutomationRulesRepository();

export class AutomationRulesController {
  getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findAll());
    } catch (err) {
      next(err);
    }
  }

  getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findById(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, triggerType, triggerConfig, actionType, actionConfig, enabled } =
        req.body as Record<string, unknown>;

      if (!name || typeof name !== 'string') {
        throw AppError.badRequest('name is required');
      }
      if (!triggerType || !VALID_TRIGGER_TYPES.includes(triggerType as AutomationTriggerType)) {
        throw AppError.badRequest(
          `triggerType must be one of: ${VALID_TRIGGER_TYPES.join(', ')}`,
        );
      }
      if (!actionType || !VALID_ACTION_TYPES.includes(actionType as AutomationActionType)) {
        throw AppError.badRequest(
          `actionType must be one of: ${VALID_ACTION_TYPES.join(', ')}`,
        );
      }

      const rule = repo.create({
        name,
        triggerType: triggerType as AutomationTriggerType,
        triggerConfig:
          triggerConfig && typeof triggerConfig === 'object'
            ? (triggerConfig as Record<string, unknown>)
            : undefined,
        actionType: actionType as AutomationActionType,
        actionConfig:
          actionConfig && typeof actionConfig === 'object'
            ? (actionConfig as Record<string, unknown>)
            : undefined,
        enabled: typeof enabled === 'boolean' ? enabled : true,
      });

      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  }

  update(req: Request, res: Response, next: NextFunction) {
    try {
      const rule = repo.update(
        req.params.id,
        req.body as Record<string, unknown>,
      );
      res.json(rule);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction) {
    try {
      repo.delete(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
