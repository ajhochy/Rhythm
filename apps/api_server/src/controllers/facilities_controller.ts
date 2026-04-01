import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { FacilitiesRepository } from '../repositories/facilities_repository';

const repo = new FacilitiesRepository();

export class FacilitiesController {
  getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findAll());
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, description, capacity, location } = req.body as Record<string, unknown>;
      if (!name || typeof name !== 'string') {
        throw AppError.badRequest('name is required');
      }
      const facility = repo.create({
        name,
        description: description as string | null | undefined,
        capacity: capacity != null ? Number(capacity) : null,
        location: location as string | null | undefined,
      });
      res.status(201).json(facility);
    } catch (err) {
      next(err);
    }
  }

  update(req: Request, res: Response, next: NextFunction) {
    try {
      const facility = repo.update(Number(req.params.id), req.body as Record<string, unknown>);
      res.json(facility);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction) {
    try {
      repo.delete(Number(req.params.id));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  getReservations(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findReservationsByFacility(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  }

  createReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, start_time, end_time, notes } = req.body as Record<string, unknown>;
      if (!title || typeof title !== 'string') {
        throw AppError.badRequest('title is required');
      }
      if (!start_time || typeof start_time !== 'string') {
        throw AppError.badRequest('start_time is required');
      }
      if (!end_time || typeof end_time !== 'string') {
        throw AppError.badRequest('end_time is required');
      }
      const reservation = repo.createReservation(Number(req.params.id), {
        title,
        reserved_by: req.auth?.user.name ?? 'Unknown user',
        reserved_by_user_id: req.auth?.user.id ?? null,
        start_time,
        end_time,
        notes: notes as string | null | undefined,
      });
      res.status(201).json(reservation);
    } catch (err) {
      next(err);
    }
  }
}
