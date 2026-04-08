import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
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
  });

  it('creates weekly recurring reservations and stores series metadata', () => {
    const result = service.createRecurringSeries({
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

  it('creates biweekly recurring reservations', () => {
    const result = service.createRecurringSeries({
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

  it('creates monthly reservations using the same weekday pattern', () => {
    const result = service.createRecurringSeries({
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

  it('creates custom-date series and reports conflicts per occurrence', () => {
    facilitiesRepo.createReservation(facilityId, {
      title: 'Existing Event',
      requester_name: 'Alice',
      requester_user_id: userId,
      created_by_user_id: userId,
      start_time: '2026-04-10T18:00:00.000Z',
      end_time: '2026-04-10T19:00:00.000Z',
    });

    const result = service.createRecurringSeries({
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
});
