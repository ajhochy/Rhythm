import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { UsersRepository } from '../repositories/users_repository';

const repo = new UsersRepository();

export class UsersController {
  getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findAll());
    } catch (err) {
      next(err);
    }
  }

  getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findById(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, email, role } = req.body as Record<string, unknown>;
      if (!name || typeof name !== 'string') {
        throw AppError.badRequest('name is required');
      }
      if (!email || typeof email !== 'string') {
        throw AppError.badRequest('email is required');
      }
      const user = repo.create({ name, email, role: role as string | undefined });
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  }

  update(req: Request, res: Response, next: NextFunction) {
    try {
      const user = repo.update(Number(req.params.id), req.body as Record<string, unknown>);
      res.json(user);
    } catch (err) {
      next(err);
    }
  }
}
