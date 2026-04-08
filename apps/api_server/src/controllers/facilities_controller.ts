import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { FacilitiesRepository } from '../repositories/facilities_repository';
import { MessagesRepository } from '../repositories/messages_repository';
import { UsersRepository } from '../repositories/users_repository';
import { FacilitiesBookingService } from '../services/facilities_booking_service';

const repo = new FacilitiesRepository();
const messagesRepo = new MessagesRepository();
const usersRepo = new UsersRepository();
const bookingService = new FacilitiesBookingService();

export class FacilitiesController {
  private assertFacilitiesManager(req: Request): void {
    if (req.auth?.user.isFacilitiesManager) return;
    throw AppError.forbidden('Facilities manager access required');
  }

  private assertCanManageReservation(
    req: Request,
    reservation: { createdByUserId: number | null },
  ): void {
    const actor = req.auth?.user;
    if (actor == null) {
      throw AppError.unauthorized('Missing auth context');
    }
    if (actor.isFacilitiesManager) return;
    if (reservation.createdByUserId === actor.id) return;
    throw AppError.forbidden('You can only modify reservations you created');
  }

  getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findAll());
    } catch (err) {
      next(err);
    }
  }

  getAllReservations(req: Request, res: Response, next: NextFunction) {
    try {
      const facilityIdParam = req.query.facilityId;
      const facilityId =
        typeof facilityIdParam === 'string' && facilityIdParam.trim().length > 0
          ? Number(facilityIdParam)
          : undefined;
      if (facilityId !== undefined && !Number.isFinite(facilityId)) {
        throw AppError.badRequest('facilityId must be a valid number');
      }
      const start =
        typeof req.query.start === 'string' && req.query.start.trim().length > 0
          ? req.query.start.trim()
          : undefined;
      const end =
        typeof req.query.end === 'string' && req.query.end.trim().length > 0
          ? req.query.end.trim()
          : undefined;
      const building =
        typeof req.query.building === 'string' &&
        req.query.building.trim().length > 0
          ? req.query.building.trim()
          : undefined;
      res.json(
        repo.findReservations({
          start,
          end,
          facilityId,
          building,
        }),
      );
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction) {
    try {
      this.assertFacilitiesManager(req);
      const { name, description, capacity, location } = req.body as Record<string, unknown>;
      if (!name || typeof name !== 'string') {
        throw AppError.badRequest('name is required');
      }
      const facility = repo.create({
        name,
        description: description as string | null | undefined,
        capacity: capacity != null ? Number(capacity) : null,
        location: location as string | null | undefined,
        building:
          typeof req.body.building === 'string'
            ? (req.body.building as string)
            : undefined,
      });
      res.status(201).json(facility);
    } catch (err) {
      next(err);
    }
  }

  update(req: Request, res: Response, next: NextFunction) {
    try {
      this.assertFacilitiesManager(req);
      const facility = repo.update(Number(req.params.id), req.body as Record<string, unknown>);
      res.json(facility);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction) {
    try {
      this.assertFacilitiesManager(req);
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

  getReservationSeries(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findReservationSeriesByFacility(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  }

  createReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        title,
        start_time,
        end_time,
        notes,
        requester_user_id,
        requester_name,
      } = req.body as Record<string, unknown>;
      if (!title || typeof title !== 'string') {
        throw AppError.badRequest('title is required');
      }
      if (!start_time || typeof start_time !== 'string') {
        throw AppError.badRequest('start_time is required');
      }
      if (!end_time || typeof end_time !== 'string') {
        throw AppError.badRequest('end_time is required');
      }
      const actor = req.auth?.user;
      if (actor == null) {
        throw AppError.unauthorized('Missing auth context');
      }
      const requestedUserId =
        typeof requester_user_id === 'number'
          ? requester_user_id
          : typeof requester_user_id === 'string' &&
              requester_user_id.trim().length > 0
            ? Number(requester_user_id)
            : null;
      if (requestedUserId != null && !Number.isFinite(requestedUserId)) {
        throw AppError.badRequest('requester_user_id must be a valid number');
      }
      const requestedName =
        typeof requester_name === 'string' && requester_name.trim().length > 0
          ? requester_name.trim()
          : null;
      const isBookingForAnotherUser =
        (requestedUserId != null && requestedUserId !== actor.id) ||
        (requestedName != null && requestedName != actor.name);
      if (isBookingForAnotherUser && !actor.isFacilitiesManager) {
        throw AppError.forbidden(
          'Only facilities managers can create reservations for other users',
        );
      }
      const requester =
        requestedUserId != null
          ? usersRepo.findById(requestedUserId)
          : requestedName != null && requestedName !== actor.name
            ? null
            : actor;
      const reservation = repo.createReservation(Number(req.params.id), {
        title,
        requester_name: requestedName ?? requester?.name ?? actor.name,
        requester_user_id: requestedUserId ?? requester?.id ?? null,
        created_by_user_id: actor.id,
        start_time,
        end_time,
        notes: notes as string | null | undefined,
      });
      res.status(201).json(reservation);
    } catch (err) {
      next(err);
    }
  }

  createReservationSeries(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        title,
        start_time,
        end_time,
        notes,
        requester_user_id,
        requester_name,
        recurrence_type,
        recurrence_interval,
        custom_dates,
        end_date,
      } = req.body as Record<string, unknown>;
      if (!title || typeof title !== 'string') {
        throw AppError.badRequest('title is required');
      }
      if (!start_time || typeof start_time !== 'string') {
        throw AppError.badRequest('start_time is required');
      }
      if (!end_time || typeof end_time !== 'string') {
        throw AppError.badRequest('end_time is required');
      }
      if (
        recurrence_type !== 'weekly' &&
        recurrence_type !== 'biweekly' &&
        recurrence_type !== 'monthly' &&
        recurrence_type !== 'custom'
      ) {
        throw AppError.badRequest(
          'recurrence_type must be weekly, biweekly, monthly, or custom',
        );
      }
      const actor = req.auth?.user;
      if (actor == null) {
        throw AppError.unauthorized('Missing auth context');
      }
      const requestedUserId =
        typeof requester_user_id === 'number'
          ? requester_user_id
          : typeof requester_user_id === 'string' &&
              requester_user_id.trim().length > 0
            ? Number(requester_user_id)
            : null;
      if (requestedUserId != null && !Number.isFinite(requestedUserId)) {
        throw AppError.badRequest('requester_user_id must be a valid number');
      }
      const requestedName =
        typeof requester_name === 'string' && requester_name.trim().length > 0
          ? requester_name.trim()
          : null;
      const isBookingForAnotherUser =
        (requestedUserId != null && requestedUserId !== actor.id) ||
        (requestedName != null && requestedName != actor.name);
      if (isBookingForAnotherUser && !actor.isFacilitiesManager) {
        throw AppError.forbidden(
          'Only facilities managers can create reservations for other users',
        );
      }
      const requester =
        requestedUserId != null
          ? usersRepo.findById(requestedUserId)
          : requestedName != null && requestedName !== actor.name
            ? null
            : actor;
      const seriesStartTime = new Date(start_time);
      if (Number.isNaN(seriesStartTime.getTime())) {
        throw AppError.badRequest('start_time must be a valid ISO timestamp');
      }
      const result = bookingService.createRecurringSeries({
        facility_id: Number(req.params.id),
        title,
        requester_name: requestedName ?? requester?.name ?? actor.name,
        requester_user_id: requestedUserId ?? requester?.id ?? null,
        created_by_user_id: actor.id,
        notes: notes as string | null | undefined,
        recurrence_type,
        recurrence_interval:
          typeof recurrence_interval === 'number'
            ? recurrence_interval
            : recurrence_type === 'biweekly'
              ? 1
              : null,
        custom_dates: Array.isArray(custom_dates)
          ? custom_dates.map((item) => String(item))
          : null,
        start_time,
        end_time,
        start_date: seriesStartTime.toISOString().slice(0, 10),
        end_date:
          typeof end_date === 'string' && end_date.trim().length > 0
            ? end_date
            : recurrence_type === 'custom'
              ? seriesStartTime.toISOString().slice(0, 10)
              : null,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  updateReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const existing = repo.findReservationById(Number(req.params.reservationId));
      this.assertCanManageReservation(req, existing);
      const {
        title,
        start_time,
        end_time,
        notes,
        requester_user_id,
        requester_name,
      } =
        req.body as Record<string, unknown>;
      const actor = req.auth?.user;
      if (actor == null) {
        throw AppError.unauthorized('Missing auth context');
      }
      const requestedUserId =
        typeof requester_user_id === 'number'
          ? requester_user_id
          : typeof requester_user_id === 'string' &&
              requester_user_id.trim().length > 0
            ? Number(requester_user_id)
            : undefined;
      if (requestedUserId !== undefined && !Number.isFinite(requestedUserId)) {
        throw AppError.badRequest('requester_user_id must be a valid number');
      }
      if (
        requestedUserId != null &&
        requestedUserId !== existing.requesterUserId &&
        !actor.isFacilitiesManager
      ) {
        throw AppError.forbidden(
          'Only facilities managers can reassign reservations to another user',
        );
      }
      const requestedName =
        typeof requester_name === 'string' && requester_name.trim().length > 0
          ? requester_name.trim()
          : undefined;
      if (
        requestedName !== undefined &&
        requestedName !== existing.requesterName &&
        !actor.isFacilitiesManager
      ) {
        throw AppError.forbidden(
          'Only facilities managers can reassign reservations to another user',
        );
      }
      const requester =
        requestedUserId != null
          ? usersRepo.findById(requestedUserId)
          : requestedName != null &&
              requestedName !== actor.name &&
              requestedName !== existing.requesterName
            ? null
            : null;
      const reservation = repo.updateReservation(
        Number(req.params.id),
        Number(req.params.reservationId),
        {
          ...(typeof title === 'string' ? { title } : {}),
          ...(typeof start_time === 'string' ? { start_time } : {}),
          ...(typeof end_time === 'string' ? { end_time } : {}),
          ...(notes !== undefined ? { notes: (notes as string | null) ?? null } : {}),
          ...(requester_user_id !== undefined
            ? { requester_user_id: requester?.id ?? null }
            : {}),
          ...(requester_name !== undefined || requester != null
            ? {
                requester_name:
                  requester?.name ??
                  requestedName ??
                  existing.requesterName,
              }
            : {}),
        },
      );
      res.json(reservation);
    } catch (err) {
      next(err);
    }
  }

  deleteReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const existing = repo.findReservationById(Number(req.params.reservationId));
      this.assertCanManageReservation(req, existing);
      const deletedReservation = repo.deleteReservation(
        Number(req.params.id),
        Number(req.params.reservationId),
      );
      const actor = req.auth?.user;
      if (
        actor != null &&
        deletedReservation.requesterUserId != null &&
        deletedReservation.requesterUserId !== actor.id
      ) {
        const bot = usersRepo.findOrCreateSystemBot();
        messagesRepo.sendDirectMessage(
          bot.id,
          deletedReservation.requesterUserId,
          `Your facility reservation was deleted by ${actor.name}. Go to Facilities to resubmit a reservation.`,
        );
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
