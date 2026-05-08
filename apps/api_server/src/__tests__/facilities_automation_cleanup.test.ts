import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { FacilitiesController } from '../controllers/facilities_controller';
import { FacilitiesRepository } from '../repositories/facilities_repository';
import { UsersRepository } from '../repositories/users_repository';
import type { Request, Response, NextFunction } from 'express';

describe('Automation reservation cleanup', () => {
  let repo: FacilitiesRepository;
  let usersRepo: UsersRepository;
  let ownerId: number;

  beforeEach(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    runMigrations(db);
    setDb(db);
    repo = new FacilitiesRepository();
    usersRepo = new UsersRepository();
    const owner = usersRepo.create({ name: 'Alice', email: 'a@example.com' });
    ownerId = owner.id;
  });

  async function makeAutomationReservation(
    facilityId: number,
    eventId: string,
    startTime: string,
    endTime: string,
  ) {
    return repo.insertSingleReservationAsync({
      facility_id: facilityId,
      title: `Auto ${eventId}`,
      requester_name: 'Alice',
      requester_user_id: ownerId,
      created_by_user_id: ownerId,
      start_time: startTime,
      end_time: endTime,
      external_event_id: eventId,
      external_source: 'automation_rule',
    });
  }

  test('previewAutomationReservationsAsync groups by facility', async () => {
    const f1 = await repo.createAsync({ name: 'Workroom' });
    const f2 = await repo.createAsync({ name: 'Conf B' });
    await makeAutomationReservation(f1.id, 'e1', '2026-05-15T14:00:00Z', '2026-05-15T15:00:00Z');
    await makeAutomationReservation(f1.id, 'e2', '2026-05-16T14:00:00Z', '2026-05-16T15:00:00Z');
    await makeAutomationReservation(f2.id, 'e3', '2026-05-17T14:00:00Z', '2026-05-17T15:00:00Z');

    const preview = await repo.previewAutomationReservationsAsync({});
    expect(preview.total).toBe(3);
    expect(preview.byFacility).toHaveLength(2);
    const work = preview.byFacility.find((x) => x.facilityName === 'Workroom');
    expect(work?.count).toBe(2);
  });

  test('deleteAutomationReservationsAsync deletes only automation_rule rows', async () => {
    const f1 = await repo.createAsync({ name: 'Workroom' });
    await makeAutomationReservation(f1.id, 'e1', '2026-05-15T14:00:00Z', '2026-05-15T15:00:00Z');
    // a manual reservation that should survive
    await repo.insertSingleReservationAsync({
      facility_id: f1.id,
      title: 'Manual booking',
      requester_name: 'Alice',
      requester_user_id: ownerId,
      created_by_user_id: ownerId,
      start_time: '2026-05-20T14:00:00Z',
      end_time: '2026-05-20T15:00:00Z',
      external_event_id: 'manual-1',
      external_source: 'manual',
    });

    const result = await repo.deleteAutomationReservationsAsync({});
    expect(result.deleted).toBe(1);

    const remaining = await repo.findReservationsByFacilityAsync(f1.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe('Manual booking');
  });

  test('deleteAutomationReservationsAsync respects facilityId filter', async () => {
    const f1 = await repo.createAsync({ name: 'A' });
    const f2 = await repo.createAsync({ name: 'B' });
    await makeAutomationReservation(f1.id, 'e1', '2026-05-15T14:00:00Z', '2026-05-15T15:00:00Z');
    await makeAutomationReservation(f2.id, 'e2', '2026-05-15T14:00:00Z', '2026-05-15T15:00:00Z');

    const result = await repo.deleteAutomationReservationsAsync({ facilityId: f1.id });
    expect(result.deleted).toBe(1);

    const remaining = await repo.previewAutomationReservationsAsync({});
    expect(remaining.total).toBe(1);
    expect(remaining.byFacility[0].facilityName).toBe('B');
  });

  test('deleteAutomationReservationsAsync respects time range filters', async () => {
    const f1 = await repo.createAsync({ name: 'A' });
    await makeAutomationReservation(f1.id, 'past', '2026-04-01T14:00:00Z', '2026-04-01T15:00:00Z');
    await makeAutomationReservation(f1.id, 'mid', '2026-05-15T14:00:00Z', '2026-05-15T15:00:00Z');
    await makeAutomationReservation(f1.id, 'future', '2026-06-15T14:00:00Z', '2026-06-15T15:00:00Z');

    const result = await repo.deleteAutomationReservationsAsync({
      startAfter: '2026-05-01T00:00:00Z',
      endBefore: '2026-06-01T00:00:00Z',
    });
    expect(result.deleted).toBe(1);
  });

  test('previewAutomationReservationsAsync returns empty result when no automation rows exist', async () => {
    const preview = await repo.previewAutomationReservationsAsync({});
    expect(preview.total).toBe(0);
    expect(preview.byFacility).toHaveLength(0);
  });

  test('deleteAutomationReservations controller method requires facilities manager', async () => {
    const controller = new FacilitiesController();
    const member = usersRepo.create({
      name: 'Team Member',
      email: 'member@example.com',
      isFacilitiesManager: false,
    });

    const req = {
      query: {},
      auth: { user: member },
    } as unknown as Request;

    let forwardedError: unknown;
    const res = {
      json(_value: unknown) { return this; },
    } as unknown as Response;
    const next: NextFunction = (err?: unknown) => { forwardedError = err; };

    await controller.deleteAutomationReservations(req, res, next);

    expect(forwardedError).toBeDefined();
    // Should be a forbidden AppError
    const err = forwardedError as { statusCode?: number };
    expect(err.statusCode).toBe(403);
  });

  test('deleteAutomationReservations controller method succeeds for facilities manager', async () => {
    const manager = usersRepo.create({
      name: 'Facilities Manager',
      email: 'fm@example.com',
      isFacilitiesManager: true,
    });
    const f1 = await repo.createAsync({ name: 'Workroom' });
    await makeAutomationReservation(f1.id, 'e1', '2026-05-15T14:00:00Z', '2026-05-15T15:00:00Z');

    const controller = new FacilitiesController();
    const req = {
      query: {},
      auth: { user: manager },
    } as unknown as Request;

    let responsePayload: unknown;
    const res = {
      json(value: unknown) { responsePayload = value; return this; },
    } as unknown as Response;
    let forwardedError: unknown;
    const next: NextFunction = (err?: unknown) => { forwardedError = err; };

    await controller.deleteAutomationReservations(req, res, next);

    expect(forwardedError).toBeUndefined();
    expect(responsePayload).toMatchObject({ deleted: 1 });
  });

  test('previewAutomationReservations controller method is accessible to non-managers', async () => {
    const member = usersRepo.create({
      name: 'Team Member',
      email: 'member@example.com',
      isFacilitiesManager: false,
    });
    const f1 = await repo.createAsync({ name: 'Workroom' });
    await makeAutomationReservation(f1.id, 'e1', '2026-05-15T14:00:00Z', '2026-05-15T15:00:00Z');

    const controller = new FacilitiesController();
    const req = {
      query: {},
      auth: { user: member },
    } as unknown as Request;

    let responsePayload: unknown;
    const res = {
      json(value: unknown) { responsePayload = value; return this; },
    } as unknown as Response;
    let forwardedError: unknown;
    const next: NextFunction = (err?: unknown) => { forwardedError = err; };

    await controller.previewAutomationReservations(req, res, next);

    expect(forwardedError).toBeUndefined();
    expect(responsePayload).toMatchObject({ total: 1 });
  });
});
