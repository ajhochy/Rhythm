import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentConfigInput } from '../repositories/agent_configs_repository';

const repo = new AgentConfigsRepository();

// Fields that are forbidden to patch on preset rows
const PRESET_PROTECTED_FIELDS = [
  'label',
  'icon',
  'isAgent',
  'canResume',
  'resumeCommand',
  'sessionIdPattern',
  'outputMarker',
];

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

  if (body.command !== undefined) {
    if (typeof body.command !== 'string' || body.command.trim() === '') {
      throw AppError.badRequest('command must be a non-empty string');
    }
    const tokens = body.command.trim().split(/\s+/);
    if (tokens.length === 0 || tokens[0] === '') {
      throw AppError.badRequest('command must contain at least one token');
    }
  } else if (requireLabel) {
    // command is required on create
    throw AppError.badRequest('command must be a non-empty string');
  }

  // Normalize booleans for validation checks
  const isAgent = body.isAgent !== undefined ? Boolean(body.isAgent) : true;
  const canResume = body.canResume !== undefined ? Boolean(body.canResume) : false;

  if (isAgent === false && canResume === true) {
    throw AppError.badRequest('canResume cannot be true when isAgent is false');
  }

  if (canResume) {
    if (
      !body.resumeCommand ||
      typeof body.resumeCommand !== 'string' ||
      body.resumeCommand.trim() === ''
    ) {
      throw AppError.badRequest('resumeCommand is required when canResume is true');
    }
    if (!body.resumeCommand.includes('{{sessionId}}')) {
      throw AppError.badRequest('resumeCommand must contain {{sessionId}}');
    }
  }

  if (body.sessionIdPattern !== undefined && body.sessionIdPattern !== null) {
    if (typeof body.sessionIdPattern !== 'string') {
      throw AppError.badRequest('sessionIdPattern must be a string');
    }
    try {
      new RegExp(body.sessionIdPattern);
    } catch {
      throw AppError.badRequest('sessionIdPattern is not a valid regular expression');
    }
  }
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
        command: (body.command as string).trim(),
        enabled: body.enabled !== false,
        isAgent: body.isAgent !== false,
        canResume: body.canResume === true,
        resumeCommand: typeof body.resumeCommand === 'string' ? body.resumeCommand : null,
        sessionIdPattern:
          typeof body.sessionIdPattern === 'string' ? body.sessionIdPattern : null,
        outputMarker: typeof body.outputMarker === 'string' ? body.outputMarker : null,
        presetId: null,
      };

      // isAgent: false forces canResume: false
      if (!input.isAgent) {
        input.canResume = false;
        input.resumeCommand = null;
      }

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
      if (body.command !== undefined) patch.command = (body.command as string).trim();
      if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
      if (body.isAgent !== undefined) patch.isAgent = Boolean(body.isAgent);
      if (body.canResume !== undefined) patch.canResume = Boolean(body.canResume);
      if ('resumeCommand' in body)
        patch.resumeCommand =
          body.resumeCommand != null ? (body.resumeCommand as string) : null;
      if ('sessionIdPattern' in body)
        patch.sessionIdPattern =
          body.sessionIdPattern != null ? (body.sessionIdPattern as string) : null;
      if ('outputMarker' in body)
        patch.outputMarker = body.outputMarker != null ? (body.outputMarker as string) : null;

      // isAgent: false forces canResume: false
      const effectiveIsAgent =
        patch.isAgent !== undefined ? patch.isAgent : existing.isAgent;
      if (!effectiveIsAgent) {
        patch.canResume = false;
        if (!('resumeCommand' in patch)) patch.resumeCommand = null;
      }

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
