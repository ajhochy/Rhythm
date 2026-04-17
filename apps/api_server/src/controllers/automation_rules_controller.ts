import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app_error";
import type { Condition, ConditionOperator } from "../models/automation_rule";
import { AutomationRulesRepository } from "../repositories/automation_rules_repository";
import { AutomationCatalogService } from "../services/automation_catalog_service";
import { IntegrationsService } from "../services/integrations_service";

const repo = new AutomationRulesRepository();
const catalog = new AutomationCatalogService();
const integrations = new IntegrationsService();

function parseConditions(value: unknown): Condition[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) {
    throw AppError.badRequest("conditions must be an array");
  }
  return value.map((item) => {
    if (
      item == null ||
      typeof item !== "object" ||
      typeof (item as Record<string, unknown>).field !== "string" ||
      typeof (item as Record<string, unknown>).operator !== "string" ||
      typeof (item as Record<string, unknown>).value !== "string"
    ) {
      throw AppError.badRequest(
        "conditions must contain field, operator, and value strings",
      );
    }
    return {
      field: (item as Record<string, unknown>).field as string,
      operator: (item as Record<string, unknown>).operator as ConditionOperator,
      value: (item as Record<string, unknown>).value as string,
    };
  });
}

function describeSource(source: string): string {
  return (
    catalog.getProviders().find((item) => item.source === source)?.label ??
    source
  );
}

function summarizeConfig(config: Record<string, unknown> | null): string[] {
  if (config == null) return [];
  const items: string[] = [];
  const pushIfString = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) {
      items.push(`${label} ${value.trim()}`);
    }
  };
  const pushIfStringArray = (label: string, value: unknown) => {
    if (!Array.isArray(value)) return;
    const values = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
    if (values.length > 0) items.push(`${label} ${values.join(", ")}`);
  };
  const pushIfNumber = (label: string, value: unknown, suffix = "") => {
    if (typeof value === "number" && Number.isFinite(value)) {
      items.push(`${label} ${value}${suffix}`);
    }
  };

  pushIfString("team", config.teamId);
  pushIfStringArray("teams", config.teamIds);
  pushIfString("position", config.positionName);
  pushIfStringArray("positions", config.positionNames);
  pushIfString("service", config.serviceType);
  pushIfString("match", config.textQuery);
  pushIfString("sender", config.sender);
  pushIfString("subject", config.subjectContains);
  pushIfString("label", config.label);
  pushIfString("template", config.templateName);
  pushIfString("tag", config.tag);
  pushIfNumber("within", config.leadDays, " days");
  pushIfNumber("window", config.dateWindowDays, " days");
  pushIfNumber("received within", config.hoursSinceReceived, " hours");
  if (config.allDayOnly == true) items.push("all-day only");
  return items;
}

function buildPreviewSummary(
  rule: ReturnType<AutomationRulesRepository["findById"]>,
): string {
  const trigger = catalog.findTrigger(rule.triggerKey);
  const action = catalog
    .getActions()
    .find((item) => item.key === rule.actionType);
  const parts = [
    `When ${trigger?.label ?? rule.triggerKey}`,
    `from ${describeSource(rule.source)}`,
  ];
  const triggerDetails = summarizeConfig(rule.triggerConfig);
  if (triggerDetails.length > 0) {
    parts.push(`with ${triggerDetails.join(", ")}`);
  }
  parts.push(`then ${action?.label.toLowerCase() ?? rule.actionType}`);
  const actionDetails = summarizeConfig(rule.actionConfig);
  if (actionDetails.length > 0) {
    parts.push(`using ${actionDetails.join(", ")}`);
  }
  return `${parts.join(" ")}.`;
}

export class AutomationRulesController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findAllAsync(req.auth?.user.id));
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findByIdAsync(req.params.id, req.auth?.user.id));
    } catch (err) {
      next(err);
    }
  }

  async getPreview(req: Request, res: Response, next: NextFunction) {
    try {
      const rule = await repo.findByIdAsync(req.params.id, req.auth?.user.id);
      res.json({
        ruleId: rule.id,
        previewSample: rule.previewSample,
        lastMatchedAt: rule.lastMatchedAt,
        lastEvaluatedAt: rule.lastEvaluatedAt,
        matchCountLastRun: rule.matchCountLastRun,
        summary: buildPreviewSummary(rule),
      });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
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
        conditions,
      } = req.body as Record<string, unknown>;

      if (!name || typeof name !== "string") {
        throw AppError.badRequest("name is required");
      }
      if (!source || typeof source !== "string") {
        throw AppError.badRequest("source is required");
      }
      if (!triggerKey || !catalog.isValidTriggerKey(String(triggerKey))) {
        throw AppError.badRequest("triggerKey is invalid");
      }
      const trigger = catalog.findTrigger(String(triggerKey));
      if (trigger == null || trigger.source !== source) {
        throw AppError.badRequest("triggerKey does not belong to source");
      }
      if (!actionType || !catalog.isValidActionType(String(actionType))) {
        throw AppError.badRequest("actionType is invalid");
      }

      const rule = await repo.createAsync({
        name,
        source: source as never,
        triggerKey: triggerKey as never,
        triggerConfig:
          triggerConfig && typeof triggerConfig === "object"
            ? (triggerConfig as Record<string, unknown>)
            : undefined,
        actionType: actionType as never,
        actionConfig:
          actionConfig && typeof actionConfig === "object"
            ? (actionConfig as Record<string, unknown>)
            : undefined,
        enabled: typeof enabled === "boolean" ? enabled : true,
        ownerId: req.auth?.user.id ?? null,
        sourceAccountId:
          typeof sourceAccountId === "string" ? sourceAccountId : null,
        conditions: parseConditions(conditions),
      });

      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as Record<string, unknown>;
      if (
        body.triggerKey &&
        (!catalog.isValidTriggerKey(String(body.triggerKey)) ||
          (body.source &&
            catalog.findTrigger(String(body.triggerKey))?.source !==
              body.source))
      ) {
        throw AppError.badRequest("triggerKey is invalid");
      }
      if (
        body.actionType &&
        !catalog.isValidActionType(String(body.actionType))
      ) {
        throw AppError.badRequest("actionType is invalid");
      }
      const rule = await repo.updateAsync(
        req.params.id,
        {
          name: typeof body.name === "string" ? body.name : undefined,
          source:
            typeof body.source === "string"
              ? (body.source as never)
              : undefined,
          triggerKey:
            typeof body.triggerKey === "string"
              ? (body.triggerKey as never)
              : undefined,
          triggerConfig:
            body.triggerConfig && typeof body.triggerConfig === "object"
              ? (body.triggerConfig as Record<string, unknown>)
              : body.triggerConfig === null
                ? null
                : undefined,
          actionType:
            typeof body.actionType === "string"
              ? (body.actionType as never)
              : undefined,
          actionConfig:
            body.actionConfig && typeof body.actionConfig === "object"
              ? (body.actionConfig as Record<string, unknown>)
              : body.actionConfig === null
                ? null
                : undefined,
          enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
          sourceAccountId:
            typeof body.sourceAccountId === "string"
              ? body.sourceAccountId
              : body.sourceAccountId === null
                ? null
                : undefined,
          conditions: parseConditions(body.conditions),
        },
        req.auth?.user.id,
      );
      res.json(rule);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.deleteAsync(req.params.id, req.auth?.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async resync(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(
        await integrations.resyncAutomationRule(
          req.params.id,
          req.auth!.user.id,
        ),
      );
    } catch (err) {
      next(err);
    }
  }
}
