import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { TasksRepository } from '../repositories/tasks_repository';

const repo = new TasksRepository();

export class TasksController {
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

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, notes, dueDate, status } = req.body as Record<string, unknown>;
      if (!title || typeof title !== 'string') {
        throw AppError.badRequest('title is required');
      }
      const task = await repo.createAsync({
        title,
        notes: (notes as string) ?? null,
        dueDate: (dueDate as string) ?? null,
        status: status as 'open' | 'done',
        ownerId: req.auth?.user.id ?? null,
      });
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const task = await repo.updateAsync(
        req.params.id,
        req.body as Record<string, unknown>,
        req.auth?.user.id,
      );
      res.json(task);
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
}
