import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { AppError } from '../errors/app_error';
import { runMigrations } from '../database/migrations';
import type { Reservation } from '../models/facility';
import { FacilitiesRepository } from '../repositories/facilities_repository';
import { UsersRepository } from '../repositories/users_repository';
import { FacilitiesBookingService } from './facilities_booking_service';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('FacilitiesBookingService', () => {
  let usersRepo: UsersRepository;
  let facilitiesRepo: FacilitiesRepository;
  let service: FacilitiesBookingService;
  let facilityId: number;
  let secondaryFacilityId: number;
  let userId: number;

  beforeEach(() => {
    setDb(makeDb());
    usersRepo = new UsersRepository();
    facilitiesRepo = new FacilitiesRepository();
    service = new FacilitiesBookingService();
    userId = usersRepo.create({
      name: 'Alice',
      email: 'alice@example.com',
    }).id;
    facilityId = facilitiesRepo.create({ name: 'North Room' }).id;
    secondaryFacilityId = facilitiesRepo.create({ name: 'South Room' }).id;
  });

  it('creates weekly recurring reservations and stores series metadata', async () => {
    const result = await service.createRecurringSeries({
      facility_id: facilityId,
      title: 'Weekly Prayer',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-06T18:00:00.000Z',
      end_time: '2026-04-06T19:00:00.000Z',
      recurrence_type: 'weekly',
      recurrence_interval: 1,
      start_date: '2026-04-06',
      end_date: '2026-04-20',
    });

    expect(result.series.recurrenceType).toBe('weekly');
    expect(result.createdReservations).toHaveLength(3);
    expect(result.conflicts).toHaveLength(0);
    expect(result.createdReservations.map((item: Reservation) => item.seriesId)).toEqual([
      result.series.id,
      result.series.id,
      result.series.id,
    ]);
  });

  it('creates multi-room recurring reservations with a linked group per occurrence', async () => {
    const result = await service.createRecurringSeries({
      facility_id: facilityId,
      facility_ids: [facilityId, secondaryFacilityId],
      title: 'Weekly Bible Study',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-06T18:00:00.000Z',
      end_time: '2026-04-06T19:00:00.000Z',
      recurrence_type: 'weekly',
      recurrence_interval: 1,
      start_date: '2026-04-06',
      end_date: '2026-04-20',
    });

    expect(result.createdGroups).toHaveLength(3);
    expect(result.createdReservations).toHaveLength(6);
    const counts = new Map<string, number>();
    for (const reservation of result.createdReservations) {
      counts.set(reservation.groupId ?? 'missing', (counts.get(reservation.groupId ?? 'missing') ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([2, 2, 2]);
  });

  it('creates biweekly recurring reservations', async () => {
    const result = await service.createRecurringSeries({
      facility_id: facilityId,
      title: 'Biweekly Team Dinner',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-07T18:00:00.000Z',
      end_time: '2026-04-07T20:00:00.000Z',
      recurrence_type: 'biweekly',
      start_date: '2026-04-07',
      end_date: '2026-05-05',
    });

    expect(result.createdReservations).toHaveLength(3);
    expect(
      result.createdReservations.map((item: Reservation) =>
        item.startTime.slice(0, 10),
      ),
    ).toEqual([
      '2026-04-07',
      '2026-04-21',
      '2026-05-05',
    ]);
  });

  it('creates monthly reservations using the same weekday pattern', async () => {
    const result = await service.createRecurringSeries({
      facility_id: facilityId,
      title: 'Monthly Leadership Breakfast',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-14T15:00:00.000Z',
      end_time: '2026-04-14T16:00:00.000Z',
      recurrence_type: 'monthly',
      start_date: '2026-04-14',
      end_date: '2026-06-30',
    });

    expect(
      result.createdReservations.map((item: Reservation) =>
        item.startTime.slice(0, 10),
      ),
    ).toEqual(['2026-04-14', '2026-05-12', '2026-06-09']);
  });

  it('creates custom-date series and reports conflicts per occurrence', async () => {
    facilitiesRepo.createReservation(facilityId, {
      title: 'Existing Event',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-10T18:00:00.000Z',
      end_time: '2026-04-10T19:00:00.000Z',
    });

    const result = await service.createRecurringSeries({
      facility_id: facilityId,
      title: 'Special Gatherings',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-08T18:00:00.000Z',
      end_time: '2026-04-08T19:00:00.000Z',
      recurrence_type: 'custom',
      custom_dates: ['2026-04-08', '2026-04-10', '2026-04-15'],
      start_date: '2026-04-08',
      end_date: '2026-04-15',
    });

    expect(result.series.recurrenceType).toBe('custom');
    expect(result.series.customDates).toEqual([
      '2026-04-08',
      '2026-04-10',
      '2026-04-15',
    ]);
    expect(
      result.createdReservations.map((item: Reservation) =>
        item.startTime.slice(0, 10),
      ),
    ).toEqual(['2026-04-08', '2026-04-15']);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].date).toBe('2026-04-10');
  });

  it('keeps multi-room recurring reservations when only one room conflicts on an occurrence', async () => {
    facilitiesRepo.createReservation(secondaryFacilityId, {
      title: 'Existing Room Hold',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-13T18:00:00.000Z',
      end_time: '2026-04-13T19:00:00.000Z',
    });

    const result = await service.createRecurringSeries({
      facility_id: facilityId,
      facility_ids: [facilityId, secondaryFacilityId],
      title: 'Weekly Bible Study',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-06T18:00:00.000Z',
      end_time: '2026-04-06T19:00:00.000Z',
      recurrence_type: 'weekly',
      recurrence_interval: 1,
      start_date: '2026-04-06',
      end_date: '2026-04-20',
    });

    expect(result.createdReservations).toHaveLength(5);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      date: '2026-04-13',
      facilityId: secondaryFacilityId,
    });
  });

  it('updates a recurring series by regenerating linked occurrences and reporting partial conflicts', async () => {
    const created = await service.createRecurringSeries({
      facility_id: facilityId,
      title: 'Weekly Prayer',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-06T18:00:00.000Z',
      end_time: '2026-04-06T19:00:00.000Z',
      recurrence_type: 'weekly',
      recurrence_interval: 1,
      start_date: '2026-04-06',
      end_date: '2026-04-20',
    });

    facilitiesRepo.createReservation(facilityId, {
      title: 'Competing Booking',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-13T20:00:00.000Z',
      end_time: '2026-04-13T21:00:00.000Z',
    });

    const result = await service.updateRecurringSeries(created.series.id, {
      title: 'Weekly Prayer Updated',
      requester_name: 'Alice',
      requester_user_id: userId,
      start_time: '2026-04-06T20:00:00.000Z',
      end_time: '2026-04-06T21:00:00.000Z',
      recurrence_type: 'weekly',
      recurrence_interval: 1,
      start_date: '2026-04-06',
      end_date: '2026-04-20',
    });

    expect(result.series.title).toBe('Weekly Prayer Updated');
    expect(result.createdReservations).toHaveLength(2);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      date: '2026-04-13',
    });
    expect(
      facilitiesRepo
        .findReservationsBySeriesId(created.series.id)
        .map((item: Reservation) => item.startTime.slice(0, 10)),
    ).toEqual(['2026-04-06', '2026-04-20']);
  });

  it('deletes a recurring series and its linked reservations', async () => {
    const created = await service.createRecurringSeries({
      facility_id: facilityId,
      title: 'Recurring Lunch',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-07T18:00:00.000Z',
      end_time: '2026-04-07T19:00:00.000Z',
      recurrence_type: 'weekly',
      recurrence_interval: 1,
      start_date: '2026-04-07',
      end_date: '2026-04-21',
    });

    facilitiesRepo.createReservation(facilityId, {
      title: 'Independent Event',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-08T18:00:00.000Z',
      end_time: '2026-04-08T19:00:00.000Z',
    });

    const deleted = await service.deleteRecurringSeries(created.series.id);

    expect(deleted.series.id).toBe(created.series.id);
    expect(deleted.deletedReservations).toHaveLength(3);
    expect(() => facilitiesRepo.findReservationSeriesById(created.series.id)).toThrowError(
      AppError,
    );
    expect(
      facilitiesRepo.findReservationsByFacility(facilityId).map((item) => item.title),
    ).toEqual(['Independent Event']);
  });
});
