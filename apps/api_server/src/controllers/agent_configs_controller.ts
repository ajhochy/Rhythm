import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentConfigInput } from '../repositories/agent_configs_repository';

const repo = new AgentConfigsRepository();

// Fields that are forbidden to patch on preset rows. Reduced to identity
// fields now that the legacy CLI fields (canResume/resumeCommand/etc.) are
// no longer persisted or used (#575/#577/#581).
const PRESET_PROTECTED_FIELDS = ['label', 'icon', 'isAgent'];

function validateBody(body: Record<string, unknown>, requireLabel = true): void {
  if (requireLabel) {
    if (!body.label || typeof body.label !== 'string' || body.label.trim() === '') {
      throw AppError.badRequest('label must be a non-empty string');
    }
  } else if (body.label !== undefined) {
    if (typeof body.label !== 'string' || body.label.trim() === '') {
      throw AppError.badRequest('label must be a non-empty string');
    }
  }

  // Legacy CLI fields (command, canResume, resumeCommand, sessionIdPattern,
  // outputMarker) used to be required here. The Opencode SDK migration
  // dropped them from the data model (#575) and the Flutter client no
  // longer sends them. We accept-and-ignore for backward compatibility
  // with old payloads instead of rejecting outright. The repository layer
  // is the source of truth for what actually gets stored.
}

export class AgentConfigsController {
  list(_req: Request, res: Response, next: NextFunction): void {
    try {
      const configs = repo.list();
      res.json(configs);
    } catch (err) {
      next(err);
    }
  }

  getOne(req: Request, res: Response, next: NextFunction): void {
    try {
      const config = repo.getById(req.params.id);
      if (!config) throw AppError.notFound('AgentConfig');
      res.json(config);
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction): void {
    try {
      const body = req.body as Record<string, unknown>;
      validateBody(body, true);

      const input: AgentConfigInput = {
        label: (body.label as string).trim(),
        icon: typeof body.icon === 'string' ? body.icon : '',
        // Legacy CLI fields (#581) — accept-and-ignore. The repository
        // writes empty/null values for the underlying columns regardless.
        command: typeof body.command === 'string' ? body.command.trim() : '',
        enabled: body.enabled !== false,
        isAgent: body.isAgent !== false,
        canResume: false,
        resumeCommand: null,
        sessionIdPattern: null,
        outputMarker: null,
        presetId: null,
      };

      const config = repo.insert(input);
      res.status(201).json(config);
    } catch (err) {
      next(err);
    }
  }

  patch(req: Request, res: Response, next: NextFunction): void {
    try {
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentConfig');

      const body = req.body as Record<string, unknown>;

      // Preset rows: only allow patching enabled and command
      if (existing.presetId !== null) {
        const suppliedFields = Object.keys(body);
        const forbidden = suppliedFields.filter((f) => PRESET_PROTECTED_FIELDS.includes(f));
        if (forbidden.length > 0) {
          throw AppError.badRequest(
            `Preset configs may only update "enabled" and "command". Forbidden fields: ${forbidden.join(', ')}`,
          );
        }
      }

      // Validate the patch body (don't require label/command presence, but validate if provided)
      validateBody(body, false);

      const patch: Partial<AgentConfigInput> = {};
      if (body.label !== undefined) patch.label = (body.label as string).trim();
      if (body.icon !== undefined) patch.icon = body.icon as string;
      if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
      if (body.isAgent !== undefined) patch.isAgent = Boolean(body.isAgent);
      // Legacy CLI fields (#581) — accept on the wire for back-compat
      // with old payloads but never propagate to the repository layer.

      const updated = repo.update(req.params.id, patch);
      if (!updated) throw AppError.notFound('AgentConfig');
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction): void {
    try {
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentConfig');

      if (existing.presetId !== null) {
        throw AppError.badRequest('Preset configs cannot be deleted');
      }

      const deleted = repo.remove(req.params.id);
      if (!deleted) throw AppError.notFound('AgentConfig');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
}
