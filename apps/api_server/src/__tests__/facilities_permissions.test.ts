import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AppError } from '../errors/app_error';
import { FacilitiesController } from '../controllers/facilities_controller';
import { FacilitiesRepository } from '../repositories/facilities_repository';
import { UsersRepository } from '../repositories/users_repository';
import { FacilitiesBookingService } from '../services/facilities_booking_service';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('Facilities permissions and schema', () => {
  let usersRepo: UsersRepository;
  let facilitiesRepo: FacilitiesRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
    facilitiesRepo = new FacilitiesRepository();
  });

  it('persists facilities-manager flag on users', () => {
    const manager = usersRepo.create({
      name: 'Facilities Manager',
      email: 'facilities@example.com',
      isFacilitiesManager: true,
    });
    const member = usersRepo.create({
      name: 'Team Member',
      email: 'member@example.com',
    });

    expect(manager.isFacilitiesManager).toBe(true);
    expect(member.isFacilitiesManager).toBe(false);
    expect(usersRepo.findById(manager.id).isFacilitiesManager).toBe(true);
  });

  it('stores requester and creator separately on reservations', () => {
    const requester = usersRepo.create({
      name: 'Requester',
      email: 'requester@example.com',
    });
    const creator = usersRepo.create({
      name: 'Facilities Manager',
      email: 'creator@example.com',
      isFacilitiesManager: true,
    });
    const facility = facilitiesRepo.create({
      name: 'North Room',
      building: 'North Campus',
    });

    const reservation = facilitiesRepo.createReservation(facility.id, {
      title: 'Staff Lunch',
      requester_name: requester.name,
      requester_user_id: requester.id,
      created_by_user_id: creator.id,
      start_time: '2026-04-07T18:00:00.000Z',
      end_time: '2026-04-07T19:00:00.000Z',
      notes: 'Need 20 chairs',
    });

    expect(reservation.requesterUserId).toBe(requester.id);
    expect(reservation.requesterName).toBe('Requester');
    expect(reservation.createdByUserId).toBe(creator.id);
    expect(reservation.createdByName).toBe('Facilities Manager');
    expect(reservation.createdByRhythm).toBe(true);
    expect(reservation.isConflicted).toBe(false);
    expect(reservation.externalEventId).toBeNull();
  });

  it('persists facility building metadata', () => {
    const facility = facilitiesRepo.create({
      name: 'South Hall',
      building: 'South Campus',
    });

    expect(facility.building).toBe('South Campus');
    expect(facilitiesRepo.findById(facility.id).building).toBe('South Campus');
  });

  it('still prevents overlapping reservations', () => {
    const user = usersRepo.create({
      name: 'Requester',
      email: 'requester@example.com',
    });
    const facility = facilitiesRepo.create({ name: 'Main Hall' });

    facilitiesRepo.createReservation(facility.id, {
      title: 'Morning Setup',
      requester_name: user.name,
      requester_user_id: user.id,
      created_by_user_id: user.id,
      start_time: '2026-04-07T09:00:00.000Z',
      end_time: '2026-04-07T10:00:00.000Z',
    });

    expect(() =>
      facilitiesRepo.createReservation(facility.id, {
        title: 'Overlap',
        requester_name: user.name,
        requester_user_id: user.id,
        created_by_user_id: user.id,
        start_time: '2026-04-07T09:30:00.000Z',
        end_time: '2026-04-07T10:30:00.000Z',
      }),
    ).toThrowError(AppError);
  });

  it('filters reservation overview queries by building, facility, and time window', () => {
    const requester = usersRepo.create({
      name: 'Requester',
      email: 'requester@example.com',
    });
    const northRoom = facilitiesRepo.create({
      name: 'North Room',
      building: 'North Campus',
    });
    const southRoom = facilitiesRepo.create({
      name: 'South Room',
      building: 'South Campus',
    });

    facilitiesRepo.createReservation(northRoom.id, {
      title: 'North Breakfast',
      requester_name: requester.name,
      requester_user_id: requester.id,
      created_by_user_id: requester.id,
      start_time: '2026-04-07T08:00:00.000Z',
      end_time: '2026-04-07T09:00:00.000Z',
    });
    facilitiesRepo.createReservation(northRoom.id, {
      title: 'North Lunch',
      requester_name: requester.name,
      requester_user_id: requester.id,
      created_by_user_id: requester.id,
      start_time: '2026-04-07T12:00:00.000Z',
      end_time: '2026-04-07T13:00:00.000Z',
    });
    facilitiesRepo.createReservation(southRoom.id, {
      title: 'South Lunch',
      requester_name: requester.name,
      requester_user_id: requester.id,
      created_by_user_id: requester.id,
      start_time: '2026-04-07T12:00:00.000Z',
      end_time: '2026-04-07T13:00:00.000Z',
    });

    const northCampus = facilitiesRepo.findReservations({
      building: 'North Campus',
    });
    expect(northCampus.map((reservation) => reservation.title)).toEqual([
      'North Breakfast',
      'North Lunch',
    ]);

    const middayNorthRoom = facilitiesRepo.findReservations({
      facilityId: northRoom.id,
      start: '2026-04-07T11:30:00.000Z',
      end: '2026-04-07T12:30:00.000Z',
    });
    expect(middayNorthRoom.map((reservation) => reservation.title)).toEqual([
      'North Lunch',
    ]);
  });

  it('allows a facilities manager to create a reservation on behalf of another person by name', () => {
    const controller = new FacilitiesController();
    const manager = usersRepo.create({
      name: 'Facilities Manager',
      email: 'facilities@example.com',
      isFacilitiesManager: true,
    });
    const facility = facilitiesRepo.create({
      name: 'North Room',
      building: 'North Campus',
    });
    const req = {
      params: { id: String(facility.id) },
      body: {
        title: 'Leadership Meeting',
        requester_name: 'Pastor Sam',
        start_time: '2026-04-08T16:00:00.000Z',
        end_time: '2026-04-08T17:00:00.000Z',
      },
      auth: { user: manager },
    } as never;
    let statusCode = 200;
    let payload: unknown;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(value: unknown) {
        payload = value;
        return this;
      },
    } as never;
    let forwardedError: unknown;

    controller.createReservation(req, res, (error?: unknown) => {
      forwardedError = error;
    });

    expect(forwardedError).toBeUndefined();
    expect(statusCode).toBe(201);
    expect(payload).toMatchObject({
      title: 'Leadership Meeting',
      requesterName: 'Pastor Sam',
      requesterUserId: null,
      createdByUserId: manager.id,
    });
  });

  it('creates multi-room reservation groups and groups the overview by logical event', () => {
    const controller = new FacilitiesController();
    const manager = usersRepo.create({
      name: 'Facilities Manager',
      email: 'facilities@example.com',
      isFacilitiesManager: true,
    });
    const northRoom = facilitiesRepo.create({
      name: 'North Room',
      building: 'North Campus',
    });
    const southRoom = facilitiesRepo.create({
      name: 'South Room',
      building: 'South Campus',
    });
    const req = {
      params: { id: String(northRoom.id) },
      query: { grouped: 'true' },
      body: {
        title: 'Women\'s Bible Study',
        facility_ids: [northRoom.id, southRoom.id],
        requester_name: 'Bible Study Leader',
        start_time: '2026-04-08T18:00:00.000Z',
        end_time: '2026-04-08T20:00:00.000Z',
      },
      auth: { user: manager },
    } as never;
    let statusCode = 200;
    let createPayload: unknown;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(value: unknown) {
        createPayload = value;
        return this;
      },
    } as never;
    let forwardedError: unknown;

    controller.createReservation(req, res, (error?: unknown) => {
      forwardedError = error;
    });

    expect(forwardedError).toBeUndefined();
    expect(statusCode).toBe(201);
    expect(createPayload).toMatchObject({
      group: {
        title: 'Women\'s Bible Study',
      },
      reservations: [
        expect.objectContaining({
          facilityId: northRoom.id,
        }),
        expect.objectContaining({
          facilityId: southRoom.id,
        }),
      ],
      conflicts: [],
    });

    const grouped = facilitiesRepo.findReservationGroups({
      start: '2026-04-08T00:00:00.000Z',
      end: '2026-04-08T23:59:59.000Z',
    });
    expect(grouped).toHaveLength(1);
    expect(grouped[0].facilities.map((facility) => facility.name)).toEqual([
      'North Room',
      'South Room',
    ]);
    expect(grouped[0].reservations).toHaveLength(2);
  });

  it('updates and deletes a linked reservation group together', () => {
    const controller = new FacilitiesController();
    const manager = usersRepo.create({
      name: 'Facilities Manager',
      email: 'facilities@example.com',
      isFacilitiesManager: true,
    });
    const northRoom = facilitiesRepo.create({
      name: 'North Room',
      building: 'North Campus',
    });
    const southRoom = facilitiesRepo.create({
      name: 'South Room',
      building: 'South Campus',
    });
    const created = facilitiesRepo.createReservationGroup({
      facility_ids: [northRoom.id, southRoom.id],
      title: 'Small Group',
      requester_name: 'Bible Study Leader',
      requester_user_id: null,
      created_by_user_id: manager.id,
      start_time: '2026-04-08T18:00:00.000Z',
      end_time: '2026-04-08T20:00:00.000Z',
    });

    const updateReq = {
      params: { id: String(northRoom.id), reservationId: String(created.reservations[0].id) },
      body: {
        title: 'Small Group Updated',
        start_time: '2026-04-08T18:30:00.000Z',
        end_time: '2026-04-08T20:30:00.000Z',
      },
      auth: { user: manager },
    } as never;
    let updateStatus = 200;
    let updatePayload: unknown;
    const updateRes = {
      status(code: number) {
        updateStatus = code;
        return this;
      },
      json(value: unknown) {
        updatePayload = value;
        return this;
      },
    } as never;
    controller.updateReservation(updateReq, updateRes, (error?: unknown) => {
      if (error) throw error;
    });

    expect(updateStatus).toBe(200);
    expect(updatePayload).toMatchObject({
      reservations: [
        expect.objectContaining({
          title: 'Small Group Updated',
        }),
        expect.objectContaining({
          title: 'Small Group Updated',
        }),
      ],
    });
    expect(
      facilitiesRepo.findReservationsByFacility(northRoom.id).map((item) => item.title),
    ).toEqual(['Small Group Updated']);
    expect(
      facilitiesRepo.findReservationsByFacility(southRoom.id).map((item) => item.title),
    ).toEqual(['Small Group Updated']);

    const updatedReservations = (updatePayload as { reservations?: { id: number }[] })
      .reservations ?? [];
    const reservationIdToDelete = updatedReservations[0]?.id ?? created.reservations[0].id;

    const deleteReq = {
      params: { id: String(northRoom.id), reservationId: String(reservationIdToDelete) },
      auth: { user: manager },
    } as never;
    let deleteForwardedError: unknown;
    const deleteRes = {
      status() {
        return this;
      },
      json() {
        return this;
      },
      send() {
        return this;
      },
    } as never;
    controller.deleteReservation(deleteReq, deleteRes, (error?: unknown) => {
      deleteForwardedError = error;
    });

    expect(deleteForwardedError).toBeUndefined();
    expect(facilitiesRepo.findReservationsByFacility(northRoom.id)).toHaveLength(0);
    expect(facilitiesRepo.findReservationsByFacility(southRoom.id)).toHaveLength(0);
  });

  it('allows creators and managers to mutate recurring series, but blocks other members', () => {
    const controller = new FacilitiesController();
    const bookingService = new FacilitiesBookingService();
    const creator = usersRepo.create({
      name: 'Series Creator',
      email: 'creator@example.com',
    });
    const otherMember = usersRepo.create({
      name: 'Other Member',
      email: 'other@example.com',
    });
    const facility = facilitiesRepo.create({
      name: 'North Room',
      building: 'North Campus',
    });
    const created = bookingService.createRecurringSeries({
      facility_id: facility.id,
      title: 'Monthly Leadership Meeting',
      requester_name: creator.name,
      requester_user_id: creator.id,
      created_by_user_id: creator.id,
      start_time: '2026-04-14T16:00:00.000Z',
      end_time: '2026-04-14T17:00:00.000Z',
      recurrence_type: 'monthly',
      start_date: '2026-04-14',
      end_date: '2026-06-30',
    });

    const updateReq = {
      params: { id: String(facility.id), seriesId: created.series.id },
      body: {
        title: 'Updated Leadership Meeting',
        start_time: '2026-04-14T16:00:00.000Z',
        end_time: '2026-04-14T17:00:00.000Z',
        recurrence_type: 'monthly',
        start_date: '2026-04-14',
        end_date: '2026-06-30',
      },
      auth: { user: creator },
    } as never;
    let updateStatus = 200;
    let updatePayload: unknown;
    const updateRes = {
      status(code: number) {
        updateStatus = code;
        return this;
      },
      json(value: unknown) {
        updatePayload = value;
        return this;
      },
    } as never;
    controller.updateReservationSeries(updateReq, updateRes, (error?: unknown) => {
      if (error) throw error;
    });

    expect(updateStatus).toBe(200);
    expect(updatePayload).toMatchObject({
      series: {
        title: 'Updated Leadership Meeting',
      },
    });

    const deleteReq = {
      params: { id: String(facility.id), seriesId: created.series.id },
      auth: { user: otherMember },
    } as never;
    let forwardedError: unknown;
    const deleteRes = {
      status() {
        return this;
      },
      json() {
        return this;
      },
      send() {
        return this;
      },
    } as never;

    controller.deleteReservationSeries(deleteReq, deleteRes, (error?: unknown) => {
      forwardedError = error;
    });

    expect(forwardedError).toBeInstanceOf(AppError);
    expect((forwardedError as AppError).statusCode).toBe(403);
  });
});
