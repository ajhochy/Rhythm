import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app_error';
import {
  AGENT_ACTIVITY_SOURCES,
  AGENT_ACTIVITY_STATUSES,
  listAgentActivity,
  type AgentActivitySource,
  type AgentActivityStatus,
} from '../services/agent_activity_service';

function optionalQuery(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw AppError.badRequest(`${name} must be a non-empty string`);
  }
  return value;
}

function enumQuery<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const parsed = optionalQuery(value, name);
  if (parsed === undefined) return undefined;
  if (!allowed.includes(parsed as T)) {
    throw AppError.badRequest(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return parsed as T;
}

export class AgentActivityController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawLimit = optionalQuery(req.query.limit, 'limit');
      const limit = rawLimit === undefined ? undefined : Number(rawLimit);
      if (
        limit !== undefined &&
        (!Number.isInteger(limit) || limit < 1 || limit > 100)
      ) {
        throw AppError.badRequest('limit must be an integer from 1 to 100');
      }
      const page = await listAgentActivity({
        source: enumQuery<AgentActivitySource>(
          req.query.source,
          'source',
          AGENT_ACTIVITY_SOURCES,
        ),
        status: enumQuery<AgentActivityStatus>(
          req.query.status,
          'status',
          AGENT_ACTIVITY_STATUSES,
        ),
        profileId: optionalQuery(req.query.profileId, 'profileId'),
        projectId: optionalQuery(req.query.projectId, 'projectId'),
        cursor: optionalQuery(req.query.cursor, 'cursor'),
        limit,
      });
      res.json(page);
    } catch (error) {
      next(error);
    }
  }
}
