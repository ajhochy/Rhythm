import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { FacilitiesRepository } from './facilities_repository';
import { UsersRepository } from './users_repository';

describe('FacilitiesRepository — automation reservation methods', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
  });

  test('insertSingleReservationAsync creates a reservation with external_source set', async () => {
    const repo = new FacilitiesRepository();
    const usersRepo = new UsersRepository();
    const owner = usersRepo.create({ name: 'Alice', email: 'a@example.com' });
    const facility = await repo.createAsync({ name: 'Office Staff Workroom' });

    const created = await repo.insertSingleReservationAsync({
      facility_id: facility.id,
      title: 'Worship Committee Meeting',
      requester_name: 'Alice',
      requester_user_id: owner.id,
      created_by_user_id: owner.id,
      start_time: '2026-05-15T14:00:00.000Z',
      end_time: '2026-05-15T15:00:00.000Z',
      notes: null,
      external_event_id: 'rule-1:cal-1:event-1',
      external_source: 'automation_rule',
    });

    expect(created.title).toBe('Worship Committee Meeting');
    expect(created.externalEventId).toBe('rule-1:cal-1:event-1');
    expect(created.externalSource).toBe('automation_rule');
    expect(created.createdByRhythm).toBe(true);
    expect(created.facilityId).toBe(facility.id);
  });

  test('insertSingleReservationAsync sets group_id and series_id to null', async () => {
    const repo = new FacilitiesRepository();
    const usersRepo = new UsersRepository();
    const owner = usersRepo.create({ name: 'Bob', email: 'b@example.com' });
    const facility = await repo.createAsync({ name: 'Fellowship Hall' });

    const created = await repo.insertSingleReservationAsync({
      facility_id: facility.id,
      title: 'Board Meeting',
      requester_name: 'Bob',
      requester_user_id: owner.id,
      created_by_user_id: owner.id,
      start_time: '2026-06-01T09:00:00.000Z',
      end_time: '2026-06-01T10:00:00.000Z',
      external_event_id: 'rule-2:cal-1:event-2',
      external_source: 'automation_rule',
    });

    expect(created.groupId).toBeNull();
    expect(created.seriesId).toBeNull();
    expect(created.isConflicted).toBe(false);
    expect(created.conflictReason).toBeNull();
  });

  test('findByExternalEventIdAsync returns null when no match', async () => {
    const repo = new FacilitiesRepository();
    const result = await repo.findByExternalEventIdAsync('nonexistent');
    expect(result).toBeNull();
  });

  test('findByExternalEventIdAsync returns the reservation when match exists', async () => {
    const repo = new FacilitiesRepository();
    const usersRepo = new UsersRepository();
    const owner = usersRepo.create({ name: 'Alice', email: 'a@example.com' });
    const facility = await repo.createAsync({ name: 'Conf Room A' });

    await repo.insertSingleReservationAsync({
      facility_id: facility.id,
      title: 'Test',
      requester_name: 'Alice',
      requester_user_id: owner.id,
      created_by_user_id: owner.id,
      start_time: '2026-05-15T14:00:00.000Z',
      end_time: '2026-05-15T15:00:00.000Z',
      external_event_id: 'rule-1:event-abc',
      external_source: 'automation_rule',
    });

    const found = await repo.findByExternalEventIdAsync('rule-1:event-abc');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Test');
  });
});
