import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { UsersRepository } from '../repositories/users_repository';

const repo = new UsersRepository();

/**
 * Validate that the given string is a recognised IANA timezone name.
 * Throws a 400 AppError if the timezone is not supported by Intl.DateTimeFormat.
 */
function validateTimezone(tz: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    throw AppError.badRequest(
      `Invalid timezone "${tz}". Must be a recognised IANA timezone name (e.g. "America/Los_Angeles").`,
    );
  }
}

export class UsersController {
  private requireAdmin(req: Request) {
    const actor = req.auth?.user;
    if (!actor) {
      throw AppError.unauthorized('Authentication required');
    }
    if (actor.role !== 'admin' && actor.role !== 'system') {
      throw AppError.forbidden('Only admins can manage user permissions');
    }
  }

  async getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findAllAsync());
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findByIdAsync(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      this.requireAdmin(req);
      const { name, email, role, isFacilitiesManager } =
        req.body as Record<string, unknown>;
      if (!name || typeof name !== 'string') {
        throw AppError.badRequest('name is required');
      }
      if (!email || typeof email !== 'string') {
        throw AppError.badRequest('email is required');
      }
      const user = await repo.createAsync({
        name,
        email,
        role: role as string | undefined,
        isFacilitiesManager:
          typeof isFacilitiesManager === 'boolean'
            ? isFacilitiesManager
            : undefined,
      });
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  }

  async updateMyPreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.auth!.user.id;
      const { emailNotificationsEnabled, timezone } = req.body as Record<string, unknown>;
      if (emailNotificationsEnabled !== undefined && typeof emailNotificationsEnabled !== 'boolean') {
        throw AppError.badRequest('emailNotificationsEnabled must be a boolean');
      }
      const patch: Record<string, unknown> = {};
      if (typeof emailNotificationsEnabled === 'boolean') {
        patch.emailNotificationsEnabled = emailNotificationsEnabled;
      }
      if (typeof timezone === 'string') {
        validateTimezone(timezone);
        patch.timezone = timezone;
      }
      if (Object.keys(patch).length === 0) {
        throw AppError.badRequest('No valid preference fields provided');
      }
      const user = await repo.updateAsync(userId, patch);
      res.json(user);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      this.requireAdmin(req);
      const { name, email, role, googleSub, photoUrl, isFacilitiesManager, timezone } =
        req.body as Record<string, unknown>;
      if (typeof timezone === 'string') {
        validateTimezone(timezone);
      }
      const user = await repo.updateAsync(Number(req.params.id), {
        ...(typeof name === 'string' ? { name } : {}),
        ...(typeof email === 'string' ? { email } : {}),
        ...(typeof role === 'string' ? { role } : {}),
        ...(typeof googleSub === 'string' || googleSub === null
          ? { googleSub: googleSub as string | null }
          : {}),
        ...(typeof photoUrl === 'string' || photoUrl === null
          ? { photoUrl: photoUrl as string | null }
          : {}),
        ...(typeof isFacilitiesManager === 'boolean'
          ? { isFacilitiesManager }
          : {}),
        ...(typeof timezone === 'string' ? { timezone } : {}),
      });
      res.json(user);
    } catch (err) {
      next(err);
    }
  }
}
