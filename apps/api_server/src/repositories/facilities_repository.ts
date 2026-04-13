import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  CreateFacilityDto,
  CreateReservationDto,
  CreateReservationSeriesDto,
  Facility,
  ReservationGroup,
  ReservationGroupConflict,
  ReservationGroupDetail,
  ReservationGroupOverview,
  ReservationGroupResult,
  Reservation,
  ReservationSeriesDetail,
  ReservationSeries,
  UpdateReservationDto,
  UpdateFacilityDto,
} from '../models/facility';

interface FacilityRow {
  id: number;
  name: string;
  description: string | null;
  capacity: number | null;
  location: string | null;
  building: string | null;
  created_at: string;
  updated_at: string;
}

interface ReservationRow {
  id: number;
  facility_id: number;
  group_id: string | null;
  series_id: string | null;
  title: string;
  reserved_by: string;
  reserved_by_user_id: number | null;
  created_by_name: string | null;
  created_by_user_id: number | null;
  start_time: string;
  end_time: string;
  notes: string | null;
  external_event_id: string | null;
  external_source: string | null;
  created_by_rhythm: number | boolean;
  is_conflicted: number | boolean;
  conflict_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface ReservationGroupRow {
  id: string;
  series_id: string | null;
  title: string;
  requester_name: string;
  requester_user_id: number | null;
  created_by_user_id: number | null;
  notes: string | null;
  start_time: string;
  end_time: string;
  occurrence_date: string | null;
  created_at: string;
  updated_at: string;
}

interface ReservationSeriesRow {
  id: string;
  facility_id: number;
  title: string;
  requester_name: string;
  requester_user_id: number | null;
  created_by_user_id: number | null;
  notes: string | null;
  recurrence_type: ReservationSeries['recurrenceType'];
  recurrence_interval: number | null;
  weekday_pattern_json: string | null;
  custom_dates_json: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

function rowToFacility(row: FacilityRow): Facility {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    capacity: row.capacity,
    location: row.location,
    building: row.building,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RESERVATION_SELECT = `
  SELECT
    reservations.*,
    creator.name AS created_by_name
  FROM reservations
  LEFT JOIN users creator
  ON creator.id = reservations.created_by_user_id
`;

const RESERVATION_GROUP_SELECT = `
  SELECT *
  FROM reservation_groups
`;

function rowToReservation(row: ReservationRow): Reservation {
  const createdByRhythm =
    typeof row.created_by_rhythm === 'boolean'
      ? row.created_by_rhythm
      : row.created_by_rhythm === 1;
  const isConflicted =
    typeof row.is_conflicted === 'boolean'
      ? row.is_conflicted
      : row.is_conflicted === 1;

  return {
    id: row.id,
    facilityId: row.facility_id,
    groupId: row.group_id,
    seriesId: row.series_id,
    title: row.title,
    requesterName: row.reserved_by,
    requesterUserId: row.reserved_by_user_id,
    createdByName: row.created_by_name,
    createdByUserId: row.created_by_user_id,
    startTime: row.start_time,
    endTime: row.end_time,
    notes: row.notes,
    externalEventId: row.external_event_id,
    externalSource: row.external_source,
    createdByRhythm,
    isConflicted,
    conflictReason: row.conflict_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToReservationGroup(row: ReservationGroupRow): ReservationGroup {
  return {
    id: row.id,
    seriesId: row.series_id,
    title: row.title,
    requesterName: row.requester_name,
    requesterUserId: row.requester_user_id,
    createdByUserId: row.created_by_user_id,
    notes: row.notes,
    startTime: row.start_time,
    endTime: row.end_time,
    occurrenceDate: row.occurrence_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToReservationSeries(row: ReservationSeriesRow): ReservationSeries {
  return {
    id: row.id,
    facilityId: row.facility_id,
    title: row.title,
    requesterName: row.requester_name,
    requesterUserId: row.requester_user_id,
    createdByUserId: row.created_by_user_id,
    notes: row.notes,
    recurrenceType: row.recurrence_type,
    recurrenceInterval: row.recurrence_interval,
    weekdayPattern: row.weekday_pattern_json
      ? (JSON.parse(row.weekday_pattern_json) as ReservationSeries['weekdayPattern'])
      : null,
    customDates: row.custom_dates_json
      ? (JSON.parse(row.custom_dates_json) as string[])
      : [],
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class FacilitiesRepository {
  private normalizeFacilityIds(facilityIds: number[]): number[] {
    const seen = new Set<number>();
    const normalized: number[] = [];
    for (const facilityId of facilityIds) {
      if (!Number.isFinite(facilityId)) continue;
      if (seen.has(facilityId)) continue;
      seen.add(facilityId);
      normalized.push(facilityId);
    }
    return normalized;
  }

  private insertReservation(data: {
    facility_id: number;
    group_id: string | null;
    series_id: string | null;
    title: string;
    requester_name: string;
    requester_user_id: number | null;
    created_by_user_id: number | null;
    start_time: string;
    end_time: string;
    notes?: string | null;
    external_event_id?: string | null;
    external_source?: string | null;
    created_by_rhythm?: boolean;
    is_conflicted?: boolean;
    conflict_reason?: string | null;
  }): Reservation {
    const result = getDb()
      .prepare(
        `INSERT INTO reservations (
           facility_id, group_id, title, reserved_by, reserved_by_user_id, created_by_user_id,
           series_id,
           start_time, end_time, notes, external_event_id, external_source,
           created_by_rhythm, is_conflicted, conflict_reason, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.facility_id,
        data.group_id ?? null,
        data.title,
        data.requester_name,
        data.requester_user_id ?? null,
        data.created_by_user_id ?? null,
        data.series_id ?? null,
        data.start_time,
        data.end_time,
        data.notes ?? null,
        data.external_event_id ?? null,
        data.external_source ?? null,
        data.created_by_rhythm === false ? 0 : 1,
        data.is_conflicted ? 1 : 0,
        data.conflict_reason ?? null,
        new Date().toISOString(),
      );
    const row = getDb()
      .prepare(`${RESERVATION_SELECT} WHERE reservations.id = ?`)
      .get(result.lastInsertRowid as number) as ReservationRow;
    return rowToReservation(row);
  }

  private async insertReservationAsync(
    data: {
      facility_id: number;
      group_id: string | null;
      series_id: string | null;
      title: string;
      requester_name: string;
      requester_user_id: number | null;
      created_by_user_id: number | null;
      start_time: string;
      end_time: string;
      notes?: string | null;
      external_event_id?: string | null;
      external_source?: string | null;
      created_by_rhythm?: boolean;
      is_conflicted?: boolean;
      conflict_reason?: string | null;
    },
    client?: PoolClient,
  ): Promise<Reservation> {
    if (env.dbClient === 'postgres') {
      const executor = client ?? getPostgresPool();
      const result = await executor.query<ReservationRow>(
        `INSERT INTO reservations (
           facility_id, group_id, title, reserved_by, reserved_by_user_id, created_by_user_id,
           series_id,
           start_time, end_time, notes, external_event_id, external_source,
           created_by_rhythm, is_conflicted, conflict_reason, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id, facility_id, group_id, series_id, title,
                   reserved_by, reserved_by_user_id, NULL::text as created_by_name,
                   created_by_user_id, start_time, end_time, notes, external_event_id,
                   external_source, created_by_rhythm, is_conflicted, conflict_reason,
                   created_at, updated_at`,
        [
          data.facility_id,
          data.group_id ?? null,
          data.title,
          data.requester_name,
          data.requester_user_id ?? null,
          data.created_by_user_id ?? null,
          data.series_id ?? null,
          data.start_time,
          data.end_time,
          data.notes ?? null,
          data.external_event_id ?? null,
          data.external_source ?? null,
          data.created_by_rhythm === false ? false : true,
          data.is_conflicted ?? false,
          data.conflict_reason ?? null,
          new Date().toISOString(),
        ],
      );
      return this.findReservationByIdAsync(result.rows[0].id);
    }
    return this.insertReservation(data);
  }

  private findReservationWindowConflict(
    facilityId: number,
    startTime: string,
    endTime: string,
    excludeReservationIds: number[] = [],
  ): { title: string; start_time: string; end_time: string } | null {
    const exclusionClause =
      excludeReservationIds.length > 0
        ? `AND id NOT IN (${excludeReservationIds.map(() => '?').join(', ')})`
        : '';
    const row = getDb()
      .prepare(
        `SELECT title, start_time, end_time
         FROM reservations
         WHERE facility_id = ?
           ${exclusionClause}
           AND start_time < ?
           AND end_time > ?
         LIMIT 1`,
      )
      .get(
        facilityId,
        ...excludeReservationIds,
        endTime,
        startTime,
      ) as
      | { title: string; start_time: string; end_time: string }
      | undefined;
    return row ?? null;
  }

  private async findReservationWindowConflictAsync(
    facilityId: number,
    startTime: string,
    endTime: string,
    excludeReservationIds: number[] = [],
  ): Promise<{ title: string; start_time: string; end_time: string } | null> {
    if (env.dbClient === 'postgres') {
      const exclusions =
        excludeReservationIds.length > 0
          ? `AND id NOT IN (${excludeReservationIds
              .map((_, index) => `$${index + 2}`)
              .join(', ')})`
          : '';
      const params: Array<string | number> = [facilityId, ...excludeReservationIds];
      params.push(endTime, startTime);
      const result = await getPostgresPool().query<{
        title: string;
        start_time: string;
        end_time: string;
      }>(
        `SELECT title, start_time, end_time
         FROM reservations
         WHERE facility_id = $1
           ${exclusions}
           AND start_time < $${params.length - 1}
           AND end_time > $${params.length}
         LIMIT 1`,
        params,
      );
      return result.rows[0] ?? null;
    }
    return this.findReservationWindowConflict(
      facilityId,
      startTime,
      endTime,
      excludeReservationIds,
    );
  }

  private assertReservationWindowAvailable(
    facilityId: number,
    startTime: string,
    endTime: string,
    excludeReservationId?: number,
  ): void {
    const conflict = this.findReservationWindowConflict(
      facilityId,
      startTime,
      endTime,
      excludeReservationId != null ? [excludeReservationId] : [],
    );
    if (conflict) {
      throw AppError.conflict(
        `Conflicts with "${conflict.title}" from ${conflict.start_time} to ${conflict.end_time}. Choose a different room or time.`,
      );
    }
  }

  async findAllAsync(): Promise<Facility[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<FacilityRow>(
        'SELECT * FROM facilities ORDER BY name ASC',
      );
      return result.rows.map(rowToFacility);
    }
    return this.findAll();
  }

  findAll(): Facility[] {
    const rows = getDb()
      .prepare('SELECT * FROM facilities ORDER BY name ASC')
      .all() as FacilityRow[];
    return rows.map(rowToFacility);
  }

  async findByIdAsync(id: number): Promise<Facility> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<FacilityRow>(
        'SELECT * FROM facilities WHERE id = $1',
        [id],
      );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('Facility');
      return rowToFacility(row);
    }
    return this.findById(id);
  }

  findById(id: number): Facility {
    const row = getDb()
      .prepare('SELECT * FROM facilities WHERE id = ?')
      .get(id) as FacilityRow | undefined;
    if (!row) throw AppError.notFound('Facility');
    return rowToFacility(row);
  }

  async createAsync(data: CreateFacilityDto): Promise<Facility> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<FacilityRow>(
        `INSERT INTO facilities (name, description, capacity, location, building)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          data.name,
          data.description ?? null,
          data.capacity ?? null,
          data.location ?? null,
          data.building ?? null,
        ],
      );
      return rowToFacility(result.rows[0]);
    }
    return this.create(data);
  }

  create(data: CreateFacilityDto): Facility {
    const result = getDb()
      .prepare(
        `INSERT INTO facilities (name, description, capacity, location, building) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.description ?? null,
        data.capacity ?? null,
        data.location ?? null,
        data.building ?? null,
      );
    return this.findById(result.lastInsertRowid as number);
  }

  async updateAsync(id: number, data: UpdateFacilityDto): Promise<Facility> {
    if (env.dbClient === 'postgres') {
      const existing = await this.findByIdAsync(id);
      const now = new Date().toISOString();
      const result = await getPostgresPool().query<FacilityRow>(
        `UPDATE facilities
         SET name = $1, description = $2, capacity = $3, location = $4, building = $5, updated_at = $6
         WHERE id = $7
         RETURNING *`,
        [
          data.name ?? existing.name,
          data.description !== undefined ? data.description : existing.description,
          data.capacity !== undefined ? data.capacity : existing.capacity,
          data.location !== undefined ? data.location : existing.location,
          data.building !== undefined ? data.building : existing.building,
          now,
          id,
        ],
      );
      return rowToFacility(result.rows[0]);
    }
    return this.update(id, data);
  }

  update(id: number, data: UpdateFacilityDto): Facility {
    const existing = this.findById(id);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE facilities SET name = ?, description = ?, capacity = ?, location = ?, building = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        data.name ?? existing.name,
        data.description !== undefined ? data.description : existing.description,
        data.capacity !== undefined ? data.capacity : existing.capacity,
        data.location !== undefined ? data.location : existing.location,
        data.building !== undefined ? data.building : existing.building,
        now,
        id,
      );
    return this.findById(id);
  }

  async deleteAsync(id: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        'DELETE FROM facilities WHERE id = $1',
        [id],
      );
      if (result.rowCount === 0) throw AppError.notFound('Facility');
      return;
    }
    this.delete(id);
  }

  delete(id: number): void {
    const result = getDb().prepare('DELETE FROM facilities WHERE id = ?').run(id);
    if (result.changes === 0) throw AppError.notFound('Facility');
  }

  async findReservationsByFacilityAsync(
    facilityId: number,
  ): Promise<Reservation[]> {
    if (env.dbClient === 'postgres') {
      await this.findByIdAsync(facilityId);
      const result = await getPostgresPool().query<ReservationRow>(
        `${RESERVATION_SELECT}
         WHERE reservations.facility_id = $1
         ORDER BY reservations.start_time ASC`,
        [facilityId],
      );
      return result.rows.map(rowToReservation);
    }
    return this.findReservationsByFacility(facilityId);
  }

  findReservationsByFacility(facilityId: number): Reservation[] {
    // Ensure facility exists
    this.findById(facilityId);
    const rows = getDb()
      .prepare(
        `${RESERVATION_SELECT}
         WHERE reservations.facility_id = ?
         ORDER BY reservations.start_time ASC`,
      )
      .all(facilityId) as ReservationRow[];
    return rows.map(rowToReservation);
  }

  async findReservationsAsync(filters?: {
    start?: string;
    end?: string;
    facilityId?: number;
    building?: string;
  }): Promise<Reservation[]> {
    if (env.dbClient === 'postgres') {
      const clauses: string[] = [];
      const params: Array<string | number> = [];

      if (filters?.facilityId != null) {
        await this.findByIdAsync(filters.facilityId);
        clauses.push(`reservations.facility_id = $${params.length + 1}`);
        params.push(filters.facilityId);
      }

      if (filters?.building != null && filters.building.trim().length > 0) {
        clauses.push(`facilities.building = $${params.length + 1}`);
        params.push(filters.building.trim());
      }

      if (filters?.start != null && filters.start.trim().length > 0) {
        clauses.push(`reservations.end_time >= $${params.length + 1}`);
        params.push(filters.start.trim());
      }

      if (filters?.end != null && filters.end.trim().length > 0) {
        clauses.push(`reservations.start_time <= $${params.length + 1}`);
        params.push(filters.end.trim());
      }

      const whereClause =
        clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const result = await getPostgresPool().query<ReservationRow>(
        `${RESERVATION_SELECT}
         LEFT JOIN facilities
           ON facilities.id = reservations.facility_id
         ${whereClause}
         ORDER BY reservations.start_time ASC`,
        params,
      );
      return result.rows.map(rowToReservation);
    }
    return this.findReservations(filters);
  }

  findReservations(filters?: {
    start?: string;
    end?: string;
    facilityId?: number;
    building?: string;
  }): Reservation[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters?.facilityId != null) {
      this.findById(filters.facilityId);
      clauses.push('reservations.facility_id = ?');
      params.push(filters.facilityId);
    }

    if (filters?.building != null && filters.building.trim().length > 0) {
      clauses.push('facilities.building = ?');
      params.push(filters.building.trim());
    }

    if (filters?.start != null && filters.start.trim().length > 0) {
      clauses.push('reservations.end_time >= ?');
      params.push(filters.start.trim());
    }

    if (filters?.end != null && filters.end.trim().length > 0) {
      clauses.push('reservations.start_time <= ?');
      params.push(filters.end.trim());
    }

    const whereClause =
      clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = getDb()
      .prepare(
        `${RESERVATION_SELECT}
         LEFT JOIN facilities
           ON facilities.id = reservations.facility_id
         ${whereClause}
         ORDER BY reservations.start_time ASC`,
      )
      .all(...params) as ReservationRow[];
    return rows.map(rowToReservation);
  }

  async findReservationGroupByIdAsync(id: string): Promise<ReservationGroup> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<ReservationGroupRow>(
        `${RESERVATION_GROUP_SELECT} WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('ReservationGroup');
      return rowToReservationGroup(row);
    }
    return this.findReservationGroupById(id);
  }

  findReservationGroupById(id: string): ReservationGroup {
    const row = getDb()
      .prepare(`${RESERVATION_GROUP_SELECT} WHERE id = ?`)
      .get(id) as ReservationGroupRow | undefined;
    if (!row) throw AppError.notFound('ReservationGroup');
    return rowToReservationGroup(row);
  }

  async findReservationGroupDetailByIdAsync(
    id: string,
  ): Promise<ReservationGroupDetail> {
    if (env.dbClient === 'postgres') {
      return {
        group: await this.findReservationGroupByIdAsync(id),
        reservations: await this.findReservationsByGroupIdAsync(id),
      };
    }
    return this.findReservationGroupDetailById(id);
  }

  findReservationGroupDetailById(id: string): ReservationGroupDetail {
    return {
      group: this.findReservationGroupById(id),
      reservations: this.findReservationsByGroupId(id),
    };
  }

  async findReservationsByGroupIdAsync(groupId: string): Promise<Reservation[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<ReservationRow>(
        `${RESERVATION_SELECT}
         WHERE reservations.group_id = $1
         ORDER BY reservations.start_time ASC, reservations.id ASC`,
        [groupId],
      );
      return result.rows.map(rowToReservation);
    }
    return this.findReservationsByGroupId(groupId);
  }

  findReservationsByGroupId(groupId: string): Reservation[] {
    const rows = getDb()
      .prepare(
        `${RESERVATION_SELECT}
         WHERE reservations.group_id = ?
         ORDER BY reservations.start_time ASC, reservations.id ASC`,
      )
      .all(groupId) as ReservationRow[];
    return rows.map(rowToReservation);
  }

  async findReservationGroupsAsync(filters?: {
    start?: string;
    end?: string;
    facilityId?: number;
    building?: string;
  }): Promise<ReservationGroupOverview[]> {
    if (env.dbClient === 'postgres') {
      const reservations = await this.findReservationsAsync(filters);
      const facilityById = new Map<number, Facility>(
        (await this.findAllAsync()).map((facility) => [facility.id, facility]),
      );
      const groups = new Map<
        string,
        { group: ReservationGroup; reservations: Reservation[]; facilities: Facility[] }
      >();

      for (const reservation of reservations) {
        const groupKey = reservation.groupId ?? `reservation:${reservation.id}`;
        const existing = groups.get(groupKey);
        if (existing) {
          existing.reservations.push(reservation);
          const facility = facilityById.get(reservation.facilityId);
          if (facility && !existing.facilities.some((item) => item.id === facility.id)) {
            existing.facilities.push(facility);
          }
          continue;
        }

        const groupRow =
          reservation.groupId != null
            ? await this.findReservationGroupByIdAsync(reservation.groupId)
            : {
                id: groupKey,
                seriesId: reservation.seriesId,
                title: reservation.title,
                requesterName: reservation.requesterName,
                requesterUserId: reservation.requesterUserId,
                createdByUserId: reservation.createdByUserId,
                notes: reservation.notes,
                startTime: reservation.startTime,
                endTime: reservation.endTime,
                occurrenceDate: reservation.startTime.slice(0, 10),
                createdAt: reservation.createdAt,
                updatedAt: reservation.updatedAt,
              };
        const facility = facilityById.get(reservation.facilityId);
        groups.set(groupKey, {
          group: groupRow,
          reservations: [reservation],
          facilities: facility ? [facility] : [],
        });
      }

      return [...groups.values()]
        .map((entry) => ({
          ...entry,
          reservations: [...entry.reservations].sort(
            (a, b) => a.startTime.localeCompare(b.startTime) || a.id - b.id,
          ),
          facilities: [...entry.facilities].sort((a, b) => a.name.localeCompare(b.name)),
          conflictCount: entry.reservations.filter((item) => item.isConflicted).length,
        }))
        .sort(
          (a, b) =>
            a.group.startTime.localeCompare(b.group.startTime) ||
            a.group.title.localeCompare(b.group.title),
        );
    }
    return this.findReservationGroups(filters);
  }

  findReservationGroups(filters?: {
    start?: string;
    end?: string;
    facilityId?: number;
    building?: string;
  }): ReservationGroupOverview[] {
    const reservations = this.findReservations(filters);
    const facilityById = new Map<number, Facility>(
      this.findAll().map((facility) => [facility.id, facility]),
    );
    const groups = new Map<
      string,
      { group: ReservationGroup; reservations: Reservation[]; facilities: Facility[] }
    >();

    for (const reservation of reservations) {
      const groupKey = reservation.groupId ?? `reservation:${reservation.id}`;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.reservations.push(reservation);
        const facility = facilityById.get(reservation.facilityId);
        if (facility && !existing.facilities.some((item) => item.id === facility.id)) {
          existing.facilities.push(facility);
        }
        continue;
      }

      const groupRow =
        reservation.groupId != null
          ? (getDb()
              .prepare(`${RESERVATION_GROUP_SELECT} WHERE id = ?`)
              .get(reservation.groupId) as ReservationGroupRow | undefined)
          : undefined;
      const group = groupRow
        ? rowToReservationGroup(groupRow)
        : {
            id: groupKey,
            seriesId: reservation.seriesId,
            title: reservation.title,
            requesterName: reservation.requesterName,
            requesterUserId: reservation.requesterUserId,
            createdByUserId: reservation.createdByUserId,
            notes: reservation.notes,
            startTime: reservation.startTime,
            endTime: reservation.endTime,
            occurrenceDate: reservation.startTime.slice(0, 10),
            createdAt: reservation.createdAt,
            updatedAt: reservation.updatedAt,
          };
      const facility = facilityById.get(reservation.facilityId);
      groups.set(groupKey, {
        group,
        reservations: [reservation],
        facilities: facility ? [facility] : [],
      });
    }

    return [...groups.values()]
      .map((entry) => ({
        ...entry,
        reservations: [...entry.reservations].sort(
          (a, b) => a.startTime.localeCompare(b.startTime) || a.id - b.id,
        ),
        facilities: [...entry.facilities].sort((a, b) => a.name.localeCompare(b.name)),
        conflictCount: entry.reservations.filter((item) => item.isConflicted).length,
      }))
      .sort(
        (a, b) =>
          a.group.startTime.localeCompare(b.group.startTime) ||
          a.group.title.localeCompare(b.group.title),
      );
  }

  createReservation(facilityId: number, data: CreateReservationDto): Reservation {
    const result = this.createReservationGroup({
      facility_ids: data.facility_ids ?? [facilityId],
      title: data.title,
      requester_name: data.requester_name,
      requester_user_id: data.requester_user_id ?? null,
      created_by_user_id: data.created_by_user_id ?? null,
      start_time: data.start_time,
      end_time: data.end_time,
      notes: data.notes ?? null,
      series_id: data.series_id ?? null,
    });
    if (result.reservations.length === 0) {
      throw AppError.conflict(
        result.conflicts[0]?.reason ??
          'No rooms were available for this reservation',
      );
    }
    return result.reservations[0];
  }

  async createReservationAsync(
    facilityId: number,
    data: CreateReservationDto,
  ): Promise<Reservation> {
    if (env.dbClient === 'postgres') {
      const result = await this.createReservationGroupAsync({
        facility_ids: data.facility_ids ?? [facilityId],
        title: data.title,
        requester_name: data.requester_name,
        requester_user_id: data.requester_user_id ?? null,
        created_by_user_id: data.created_by_user_id ?? null,
        start_time: data.start_time,
        end_time: data.end_time,
        notes: data.notes ?? null,
        series_id: data.series_id ?? null,
      });
      if (result.reservations.length === 0) {
        throw AppError.conflict(
          result.conflicts[0]?.reason ??
            'No rooms were available for this reservation',
        );
      }
      return result.reservations[0];
    }
    return this.createReservation(facilityId, data);
  }

  createReservationGroup(data: {
    facility_ids: number[];
    title: string;
    requester_name: string;
    requester_user_id: number | null;
    created_by_user_id: number | null;
    start_time: string;
    end_time: string;
    notes?: string | null;
    series_id?: string | null;
    occurrence_date?: string | null;
  }): ReservationGroupResult {
    const facilityIds = this.normalizeFacilityIds(data.facility_ids);
    if (facilityIds.length === 0) {
      throw AppError.badRequest('facility_ids is required');
    }

    const conflicts: ReservationGroupConflict[] = [];
    const availableFacilityIds: number[] = [];

    for (const facilityId of facilityIds) {
      const facility = this.findById(facilityId);
      const conflict = this.findReservationWindowConflict(
        facilityId,
        data.start_time,
        data.end_time,
      );
      if (conflict) {
        conflicts.push({
          facilityId,
          facilityName: facility.name,
          reason: `Conflicts with "${conflict.title}" from ${conflict.start_time} to ${conflict.end_time}. Choose a different room or time.`,
        });
        continue;
      }
      availableFacilityIds.push(facilityId);
    }

    if (availableFacilityIds.length === 0) {
      throw AppError.conflict(
        conflicts[0]?.reason ?? 'No rooms were available for this reservation',
      );
    }

    const groupId = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .transaction(() => {
        getDb()
          .prepare(
            `INSERT INTO reservation_groups (
               id, series_id, title, requester_name, requester_user_id, created_by_user_id,
               notes, start_time, end_time, occurrence_date, created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            groupId,
            data.series_id ?? null,
            data.title,
            data.requester_name,
            data.requester_user_id ?? null,
            data.created_by_user_id ?? null,
            data.notes ?? null,
            data.start_time,
            data.end_time,
            data.occurrence_date ?? null,
            now,
            now,
          );

        for (const facilityId of availableFacilityIds) {
          this.insertReservation({
            facility_id: facilityId,
            group_id: groupId,
            series_id: data.series_id ?? null,
            title: data.title,
            requester_name: data.requester_name,
            requester_user_id: data.requester_user_id ?? null,
            created_by_user_id: data.created_by_user_id ?? null,
            start_time: data.start_time,
            end_time: data.end_time,
            notes: data.notes ?? null,
          });
        }
      })();

    return {
      group: this.findReservationGroupById(groupId),
      reservations: this.findReservationsByGroupId(groupId),
      conflicts,
    };
  }

  async createReservationGroupAsync(data: {
    facility_ids: number[];
    title: string;
    requester_name: string;
    requester_user_id: number | null;
    created_by_user_id: number | null;
    start_time: string;
    end_time: string;
    notes?: string | null;
    series_id?: string | null;
    occurrence_date?: string | null;
  }): Promise<ReservationGroupResult> {
    if (env.dbClient === 'postgres') {
      const facilityIds = this.normalizeFacilityIds(data.facility_ids);
      if (facilityIds.length === 0) {
        throw AppError.badRequest('facility_ids is required');
      }

      const conflicts: ReservationGroupConflict[] = [];
      const availableFacilityIds: number[] = [];

      for (const facilityId of facilityIds) {
        const facility = await this.findByIdAsync(facilityId);
        const conflict = await this.findReservationWindowConflictAsync(
          facilityId,
          data.start_time,
          data.end_time,
        );
        if (conflict) {
          conflicts.push({
            facilityId,
            facilityName: facility.name,
            reason: `Conflicts with "${conflict.title}" from ${conflict.start_time} to ${conflict.end_time}. Choose a different room or time.`,
          });
          continue;
        }
        availableFacilityIds.push(facilityId);
      }

      if (availableFacilityIds.length === 0) {
        throw AppError.conflict(
          conflicts[0]?.reason ?? 'No rooms were available for this reservation',
        );
      }

      const groupId = crypto.randomUUID();
      const now = new Date().toISOString();
      const client = await getPostgresPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO reservation_groups (
             id, series_id, title, requester_name, requester_user_id, created_by_user_id,
             notes, start_time, end_time, occurrence_date, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            groupId,
            data.series_id ?? null,
            data.title,
            data.requester_name,
            data.requester_user_id ?? null,
            data.created_by_user_id ?? null,
            data.notes ?? null,
            data.start_time,
            data.end_time,
            data.occurrence_date ?? null,
            now,
            now,
          ],
        );

        for (const facilityId of availableFacilityIds) {
          await this.insertReservationAsync(
            {
              facility_id: facilityId,
              group_id: groupId,
              series_id: data.series_id ?? null,
              title: data.title,
              requester_name: data.requester_name,
              requester_user_id: data.requester_user_id ?? null,
              created_by_user_id: data.created_by_user_id ?? null,
              start_time: data.start_time,
              end_time: data.end_time,
              notes: data.notes ?? null,
            },
            client,
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      return {
        group: await this.findReservationGroupByIdAsync(groupId),
        reservations: await this.findReservationsByGroupIdAsync(groupId),
        conflicts,
      };
    }
    return this.createReservationGroup(data);
  }

  createReservationSeries(data: CreateReservationSeriesDto): ReservationSeries {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    getDb()
      .prepare(
        `INSERT INTO reservation_series (
           id, facility_id, title, requester_name, requester_user_id, created_by_user_id,
           notes, recurrence_type, recurrence_interval, weekday_pattern_json, custom_dates_json,
           start_date, end_date, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.facility_id,
        data.title,
        data.requester_name,
        data.requester_user_id ?? null,
        data.created_by_user_id ?? null,
        data.notes ?? null,
        data.recurrence_type,
        data.recurrence_interval ?? null,
        data.weekday_pattern ? JSON.stringify(data.weekday_pattern) : null,
        JSON.stringify(data.custom_dates ?? []),
        data.start_date,
        data.end_date ?? null,
        now,
        now,
      );
    return this.findReservationSeriesById(id);
  }

  async createReservationSeriesAsync(
    data: CreateReservationSeriesDto,
  ): Promise<ReservationSeries> {
    if (env.dbClient === 'postgres') {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await getPostgresPool().query(
        `INSERT INTO reservation_series (
           id, facility_id, title, requester_name, requester_user_id, created_by_user_id,
           notes, recurrence_type, recurrence_interval, weekday_pattern_json, custom_dates_json,
           start_date, end_date, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          id,
          data.facility_id,
          data.title,
          data.requester_name,
          data.requester_user_id ?? null,
          data.created_by_user_id ?? null,
          data.notes ?? null,
          data.recurrence_type,
          data.recurrence_interval ?? null,
          data.weekday_pattern ? JSON.stringify(data.weekday_pattern) : null,
          JSON.stringify(data.custom_dates ?? []),
          data.start_date,
          data.end_date ?? null,
          now,
          now,
        ],
      );
      return this.findReservationSeriesByIdAsync(id);
    }
    return this.createReservationSeries(data);
  }

  async findReservationSeriesByFacilityAsync(
    facilityId: number,
  ): Promise<ReservationSeries[]> {
    if (env.dbClient === 'postgres') {
      await this.findByIdAsync(facilityId);
      const result = await getPostgresPool().query<ReservationSeriesRow>(
        'SELECT * FROM reservation_series WHERE facility_id = $1 ORDER BY created_at DESC',
        [facilityId],
      );
      return result.rows.map(rowToReservationSeries);
    }
    return this.findReservationSeriesByFacility(facilityId);
  }

  findReservationSeriesByFacility(facilityId: number): ReservationSeries[] {
    this.findById(facilityId);
    const rows = getDb()
      .prepare(
        'SELECT * FROM reservation_series WHERE facility_id = ? ORDER BY created_at DESC',
      )
      .all(facilityId) as ReservationSeriesRow[];
    return rows.map(rowToReservationSeries);
  }

  async findReservationSeriesByIdAsync(id: string): Promise<ReservationSeries> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<ReservationSeriesRow>(
        'SELECT * FROM reservation_series WHERE id = $1',
        [id],
      );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('ReservationSeries');
      return rowToReservationSeries(row);
    }
    return this.findReservationSeriesById(id);
  }

  findReservationSeriesById(id: string): ReservationSeries {
    const row = getDb()
      .prepare('SELECT * FROM reservation_series WHERE id = ?')
      .get(id) as ReservationSeriesRow | undefined;
    if (!row) throw AppError.notFound('ReservationSeries');
    return rowToReservationSeries(row);
  }

  async findReservationSeriesDetailByIdAsync(
    id: string,
  ): Promise<ReservationSeriesDetail> {
    if (env.dbClient === 'postgres') {
      return {
        series: await this.findReservationSeriesByIdAsync(id),
        reservations: await this.findReservationsBySeriesIdAsync(id),
      };
    }
    return this.findReservationSeriesDetailById(id);
  }

  findReservationSeriesDetailById(id: string): ReservationSeriesDetail {
    return {
      series: this.findReservationSeriesById(id),
      reservations: this.findReservationsBySeriesId(id),
    };
  }

  async findReservationsBySeriesIdAsync(
    seriesId: string,
  ): Promise<Reservation[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<ReservationRow>(
        `${RESERVATION_SELECT}
         WHERE reservations.series_id = $1
         ORDER BY reservations.start_time ASC`,
        [seriesId],
      );
      return result.rows.map(rowToReservation);
    }
    return this.findReservationsBySeriesId(seriesId);
  }

  findReservationsBySeriesId(seriesId: string): Reservation[] {
    const rows = getDb()
      .prepare(
        `${RESERVATION_SELECT}
         WHERE reservations.series_id = ?
         ORDER BY reservations.start_time ASC`,
      )
      .all(seriesId) as ReservationRow[];
    return rows.map(rowToReservation);
  }

  updateReservationSeries(
    id: string,
    data: {
      title: string;
      requester_name: string;
      requester_user_id: number | null;
      created_by_user_id: number | null;
      notes: string | null;
      recurrence_type: ReservationSeries['recurrenceType'];
      recurrence_interval: number | null;
      weekday_pattern: ReservationSeries['weekdayPattern'];
      custom_dates: string[];
      start_date: string;
      end_date: string | null;
    },
  ): ReservationSeries {
    this.findReservationSeriesById(id);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE reservation_series
         SET title = ?, requester_name = ?, requester_user_id = ?, created_by_user_id = ?,
             notes = ?, recurrence_type = ?, recurrence_interval = ?, weekday_pattern_json = ?,
             custom_dates_json = ?, start_date = ?, end_date = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        data.title,
        data.requester_name,
        data.requester_user_id,
        data.created_by_user_id,
        data.notes,
        data.recurrence_type,
        data.recurrence_interval,
        data.weekday_pattern ? JSON.stringify(data.weekday_pattern) : null,
        JSON.stringify(data.custom_dates),
        data.start_date,
        data.end_date,
        now,
        id,
      );
    return this.findReservationSeriesById(id);
  }

  async updateReservationSeriesAsync(
    id: string,
    data: {
      title: string;
      requester_name: string;
      requester_user_id: number | null;
      created_by_user_id: number | null;
      notes: string | null;
      recurrence_type: ReservationSeries['recurrenceType'];
      recurrence_interval: number | null;
      weekday_pattern: ReservationSeries['weekdayPattern'];
      custom_dates: string[];
      start_date: string;
      end_date: string | null;
    },
  ): Promise<ReservationSeries> {
    if (env.dbClient === 'postgres') {
      await this.findReservationSeriesByIdAsync(id);
      const now = new Date().toISOString();
      await getPostgresPool().query(
        `UPDATE reservation_series
         SET title = $1, requester_name = $2, requester_user_id = $3, created_by_user_id = $4,
             notes = $5, recurrence_type = $6, recurrence_interval = $7, weekday_pattern_json = $8,
             custom_dates_json = $9, start_date = $10, end_date = $11, updated_at = $12
         WHERE id = $13`,
        [
          data.title,
          data.requester_name,
          data.requester_user_id,
          data.created_by_user_id,
          data.notes,
          data.recurrence_type,
          data.recurrence_interval,
          data.weekday_pattern ? JSON.stringify(data.weekday_pattern) : null,
          JSON.stringify(data.custom_dates),
          data.start_date,
          data.end_date,
          now,
          id,
        ],
      );
      return this.findReservationSeriesByIdAsync(id);
    }
    return this.updateReservationSeries(id, data);
  }

  deleteReservationsBySeriesId(seriesId: string): Reservation[] {
    const deleted = this.findReservationsBySeriesId(seriesId);
    this.deleteReservationGroupsBySeriesId(seriesId);
    return deleted;
  }

  async deleteReservationsBySeriesIdAsync(seriesId: string): Promise<Reservation[]> {
    if (env.dbClient === 'postgres') {
      const deleted = await this.findReservationsBySeriesIdAsync(seriesId);
      await this.deleteReservationGroupsBySeriesIdAsync(seriesId);
      return deleted;
    }
    return this.deleteReservationsBySeriesId(seriesId);
  }

  deleteReservationSeriesById(id: string): ReservationSeries {
    const series = this.findReservationSeriesById(id);
    getDb()
      .prepare('DELETE FROM reservation_series WHERE id = ?')
      .run(id);
    return series;
  }

  async deleteReservationSeriesByIdAsync(id: string): Promise<ReservationSeries> {
    if (env.dbClient === 'postgres') {
      const series = await this.findReservationSeriesByIdAsync(id);
      await getPostgresPool().query(
        'DELETE FROM reservation_series WHERE id = $1',
        [id],
      );
      return series;
    }
    return this.deleteReservationSeriesById(id);
  }

  async findReservationByIdAsync(id: number): Promise<Reservation> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<ReservationRow>(
        `${RESERVATION_SELECT} WHERE reservations.id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('Reservation');
      return rowToReservation(row);
    }
    return this.findReservationById(id);
  }

  findReservationById(id: number): Reservation {
    const row = getDb()
      .prepare(`${RESERVATION_SELECT} WHERE reservations.id = ?`)
      .get(id) as ReservationRow | undefined;
    if (!row) throw AppError.notFound('Reservation');
    return rowToReservation(row);
  }

  findReservationGroupByReservationId(reservationId: number): ReservationGroup | null {
    const reservation = this.findReservationById(reservationId);
    if (reservation.groupId == null) {
      return null;
    }
    return this.findReservationGroupById(reservation.groupId);
  }

  updateReservation(
    facilityId: number,
    reservationId: number,
    data: UpdateReservationDto,
  ): Reservation {
    this.findById(facilityId);
    const existing = this.findReservationById(reservationId);
    if (existing.facilityId !== facilityId) {
      throw AppError.notFound('Reservation');
    }

    if (existing.groupId != null) {
      const result = this.updateReservationGroup(existing.groupId, {
        title: data.title ?? existing.title,
        requester_name: data.requester_name ?? existing.requesterName,
        requester_user_id:
          data.requester_user_id !== undefined
            ? data.requester_user_id
            : existing.requesterUserId,
        created_by_user_id: existing.createdByUserId,
        start_time: data.start_time ?? existing.startTime,
        end_time: data.end_time ?? existing.endTime,
        notes: data.notes !== undefined ? data.notes : existing.notes,
        facility_ids: data.facility_ids ?? undefined,
        external_event_id: data.external_event_id,
        external_source: data.external_source,
        created_by_rhythm: data.created_by_rhythm,
        is_conflicted: data.is_conflicted,
        conflict_reason: data.conflict_reason,
      });
      return result.reservations[0] ?? this.findReservationById(reservationId);
    }

    const nextStart = data.start_time ?? existing.startTime;
    const nextEnd = data.end_time ?? existing.endTime;
    this.assertReservationWindowAvailable(
      facilityId,
      nextStart,
      nextEnd,
      reservationId,
    );

    getDb()
      .prepare(
        `UPDATE reservations
         SET title = ?, reserved_by = ?, reserved_by_user_id = ?, start_time = ?, end_time = ?, notes = ?,
             external_event_id = ?, external_source = ?, created_by_rhythm = ?,
             is_conflicted = ?, conflict_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        data.title ?? existing.title,
        data.requester_name ?? existing.requesterName,
        data.requester_user_id !== undefined
            ? data.requester_user_id
            : existing.requesterUserId,
        data.start_time ?? existing.startTime,
        data.end_time ?? existing.endTime,
        data.notes !== undefined ? data.notes : existing.notes,
        data.external_event_id !== undefined
            ? data.external_event_id
            : existing.externalEventId,
        data.external_source !== undefined
            ? data.external_source
            : existing.externalSource,
        data.created_by_rhythm !== undefined
            ? (data.created_by_rhythm ? 1 : 0)
            : (existing.createdByRhythm ? 1 : 0),
        data.is_conflicted !== undefined
            ? (data.is_conflicted ? 1 : 0)
            : (existing.isConflicted ? 1 : 0),
        data.conflict_reason !== undefined
            ? data.conflict_reason
            : existing.conflictReason,
        new Date().toISOString(),
        reservationId,
      );

    return this.findReservationById(reservationId);
  }

  async updateReservationAsync(
    facilityId: number,
    reservationId: number,
    data: UpdateReservationDto,
  ): Promise<Reservation> {
    if (env.dbClient === 'postgres') {
      await this.findByIdAsync(facilityId);
      const existing = await this.findReservationByIdAsync(reservationId);
      if (existing.facilityId !== facilityId) {
        throw AppError.notFound('Reservation');
      }

      if (existing.groupId != null) {
        const result = await this.updateReservationGroupAsync(existing.groupId, {
          title: data.title ?? existing.title,
          requester_name: data.requester_name ?? existing.requesterName,
          requester_user_id:
            data.requester_user_id !== undefined
              ? data.requester_user_id
              : existing.requesterUserId,
          created_by_user_id: existing.createdByUserId,
          start_time: data.start_time ?? existing.startTime,
          end_time: data.end_time ?? existing.endTime,
          notes: data.notes !== undefined ? data.notes : existing.notes,
          facility_ids: data.facility_ids ?? undefined,
          external_event_id: data.external_event_id,
          external_source: data.external_source,
          created_by_rhythm: data.created_by_rhythm,
          is_conflicted: data.is_conflicted,
          conflict_reason: data.conflict_reason,
        });
        return (
          result.reservations.find((item) => item.id === reservationId) ??
          result.reservations[0] ??
          this.findReservationByIdAsync(reservationId)
        );
      }

      const nextStart = data.start_time ?? existing.startTime;
      const nextEnd = data.end_time ?? existing.endTime;
      const conflict = await this.findReservationWindowConflictAsync(
        facilityId,
        nextStart,
        nextEnd,
        [reservationId],
      );
      if (conflict) {
        throw AppError.conflict(
          `Conflicts with "${conflict.title}" from ${conflict.start_time} to ${conflict.end_time}. Choose a different room or time.`,
        );
      }

      await getPostgresPool().query(
        `UPDATE reservations
         SET title = $1, reserved_by = $2, reserved_by_user_id = $3, start_time = $4, end_time = $5, notes = $6,
             external_event_id = $7, external_source = $8, created_by_rhythm = $9,
             is_conflicted = $10, conflict_reason = $11, updated_at = $12
         WHERE id = $13`,
        [
          data.title ?? existing.title,
          data.requester_name ?? existing.requesterName,
          data.requester_user_id !== undefined
            ? data.requester_user_id
            : existing.requesterUserId,
          nextStart,
          nextEnd,
          data.notes !== undefined ? data.notes : existing.notes,
          data.external_event_id !== undefined
            ? data.external_event_id
            : existing.externalEventId,
          data.external_source !== undefined
            ? data.external_source
            : existing.externalSource,
          data.created_by_rhythm !== undefined
            ? data.created_by_rhythm
            : existing.createdByRhythm,
          data.is_conflicted !== undefined
            ? data.is_conflicted
            : existing.isConflicted,
          data.conflict_reason !== undefined
            ? data.conflict_reason
            : existing.conflictReason,
          new Date().toISOString(),
          reservationId,
        ],
      );

      return this.findReservationByIdAsync(reservationId);
    }
    return this.updateReservation(facilityId, reservationId, data);
  }

  updateReservationGroup(
    groupId: string,
    data: {
      title?: string;
      requester_name?: string;
      requester_user_id?: number | null;
      created_by_user_id?: number | null;
      start_time?: string;
      end_time?: string;
      notes?: string | null;
      facility_ids?: number[] | null;
      external_event_id?: string | null;
      external_source?: string | null;
      created_by_rhythm?: boolean;
      is_conflicted?: boolean;
      conflict_reason?: string | null;
    },
  ): ReservationGroupResult {
    const existingGroup = this.findReservationGroupDetailById(groupId);
    const existingReservationIds = existingGroup.reservations.map((item) => item.id);
    const requestedFacilityIds = this.normalizeFacilityIds(
      data.facility_ids ?? existingGroup.reservations.map((item) => item.facilityId),
    );
    if (requestedFacilityIds.length === 0) {
      throw AppError.badRequest('facility_ids is required');
    }

    const nextStart = data.start_time ?? existingGroup.group.startTime;
    const nextEnd = data.end_time ?? existingGroup.group.endTime;
    const conflicts: ReservationGroupConflict[] = [];
    const availableFacilityIds: number[] = [];

    for (const facilityId of requestedFacilityIds) {
      const facility = this.findById(facilityId);
      const conflict = this.findReservationWindowConflict(
        facilityId,
        nextStart,
        nextEnd,
        existingReservationIds,
      );
      if (conflict) {
        conflicts.push({
          facilityId,
          facilityName: facility.name,
          reason: `Conflicts with "${conflict.title}" from ${conflict.start_time} to ${conflict.end_time}. Choose a different room or time.`,
        });
        continue;
      }
      availableFacilityIds.push(facilityId);
    }

    if (availableFacilityIds.length === 0) {
      throw AppError.conflict(
        conflicts[0]?.reason ?? 'No rooms were available for this reservation',
      );
    }

    const now = new Date().toISOString();
    getDb()
      .transaction(() => {
        getDb()
          .prepare(
            `UPDATE reservation_groups
             SET title = ?, requester_name = ?, requester_user_id = ?, created_by_user_id = ?,
                 notes = ?, start_time = ?, end_time = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            data.title ?? existingGroup.group.title,
            data.requester_name ?? existingGroup.group.requesterName,
            data.requester_user_id !== undefined
              ? data.requester_user_id
              : existingGroup.group.requesterUserId,
            data.created_by_user_id !== undefined
              ? data.created_by_user_id
              : existingGroup.group.createdByUserId,
            data.notes !== undefined ? data.notes : existingGroup.group.notes,
            nextStart,
            nextEnd,
            now,
            groupId,
          );

        getDb()
          .prepare('DELETE FROM reservations WHERE group_id = ?')
          .run(groupId);

        for (const facilityId of availableFacilityIds) {
          this.insertReservation({
            facility_id: facilityId,
            group_id: groupId,
            series_id: existingGroup.group.seriesId,
            title: data.title ?? existingGroup.group.title,
            requester_name: data.requester_name ?? existingGroup.group.requesterName,
            requester_user_id:
              data.requester_user_id !== undefined
                ? data.requester_user_id
                : existingGroup.group.requesterUserId,
            created_by_user_id:
              data.created_by_user_id !== undefined
                ? data.created_by_user_id
                : existingGroup.group.createdByUserId,
            start_time: nextStart,
            end_time: nextEnd,
            notes: data.notes !== undefined ? data.notes : existingGroup.group.notes,
            external_event_id: data.external_event_id,
            external_source: data.external_source,
            created_by_rhythm: data.created_by_rhythm,
            is_conflicted: data.is_conflicted,
            conflict_reason: data.conflict_reason,
          });
        }
      })();

    return {
      group: this.findReservationGroupById(groupId),
      reservations: this.findReservationsByGroupId(groupId),
      conflicts,
    };
  }

  async updateReservationGroupAsync(
    groupId: string,
    data: {
      title?: string;
      requester_name?: string;
      requester_user_id?: number | null;
      created_by_user_id?: number | null;
      start_time?: string;
      end_time?: string;
      notes?: string | null;
      facility_ids?: number[] | null;
      external_event_id?: string | null;
      external_source?: string | null;
      created_by_rhythm?: boolean;
      is_conflicted?: boolean;
      conflict_reason?: string | null;
    },
  ): Promise<ReservationGroupResult> {
    if (env.dbClient === 'postgres') {
      const existingGroup = await this.findReservationGroupDetailByIdAsync(groupId);
      const existingReservationIds = existingGroup.reservations.map((item) => item.id);
      const requestedFacilityIds = this.normalizeFacilityIds(
        data.facility_ids ?? existingGroup.reservations.map((item) => item.facilityId),
      );
      if (requestedFacilityIds.length === 0) {
        throw AppError.badRequest('facility_ids is required');
      }

      const nextStart = data.start_time ?? existingGroup.group.startTime;
      const nextEnd = data.end_time ?? existingGroup.group.endTime;
      const conflicts: ReservationGroupConflict[] = [];
      const availableFacilityIds: number[] = [];

      for (const facilityId of requestedFacilityIds) {
        const facility = await this.findByIdAsync(facilityId);
        const conflict = await this.findReservationWindowConflictAsync(
          facilityId,
          nextStart,
          nextEnd,
          existingReservationIds,
        );
        if (conflict) {
          conflicts.push({
            facilityId,
            facilityName: facility.name,
            reason: `Conflicts with "${conflict.title}" from ${conflict.start_time} to ${conflict.end_time}. Choose a different room or time.`,
          });
          continue;
        }
        availableFacilityIds.push(facilityId);
      }

      if (availableFacilityIds.length === 0) {
        throw AppError.conflict(
          conflicts[0]?.reason ?? 'No rooms were available for this reservation',
        );
      }

      const now = new Date().toISOString();
      const client = await getPostgresPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE reservation_groups
           SET title = $1, requester_name = $2, requester_user_id = $3, created_by_user_id = $4,
               notes = $5, start_time = $6, end_time = $7, updated_at = $8
           WHERE id = $9`,
          [
            data.title ?? existingGroup.group.title,
            data.requester_name ?? existingGroup.group.requesterName,
            data.requester_user_id !== undefined
              ? data.requester_user_id
              : existingGroup.group.requesterUserId,
            data.created_by_user_id !== undefined
              ? data.created_by_user_id
              : existingGroup.group.createdByUserId,
            data.notes !== undefined ? data.notes : existingGroup.group.notes,
            nextStart,
            nextEnd,
            now,
            groupId,
          ],
        );
        await client.query('DELETE FROM reservations WHERE group_id = $1', [groupId]);
        for (const facilityId of availableFacilityIds) {
          await this.insertReservationAsync(
            {
              facility_id: facilityId,
              group_id: groupId,
              series_id: existingGroup.group.seriesId,
              title: data.title ?? existingGroup.group.title,
              requester_name:
                data.requester_name ?? existingGroup.group.requesterName,
              requester_user_id:
                data.requester_user_id !== undefined
                  ? data.requester_user_id
                  : existingGroup.group.requesterUserId,
              created_by_user_id:
                data.created_by_user_id !== undefined
                  ? data.created_by_user_id
                  : existingGroup.group.createdByUserId,
              start_time: nextStart,
              end_time: nextEnd,
              notes:
                data.notes !== undefined ? data.notes : existingGroup.group.notes,
              external_event_id: data.external_event_id,
              external_source: data.external_source,
              created_by_rhythm: data.created_by_rhythm,
              is_conflicted: data.is_conflicted,
              conflict_reason: data.conflict_reason,
            },
            client,
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      return {
        group: await this.findReservationGroupByIdAsync(groupId),
        reservations: await this.findReservationsByGroupIdAsync(groupId),
        conflicts,
      };
    }
    return this.updateReservationGroup(groupId, data);
  }

  deleteReservation(facilityId: number, reservationId: number): Reservation {
    this.findById(facilityId);
    const existing = this.findReservationById(reservationId);
    if (existing.facilityId !== facilityId) {
      throw AppError.notFound('Reservation');
    }

    if (existing.groupId != null) {
      const deleted = this.deleteReservationGroup(existing.groupId);
      return deleted.reservations.find((item) => item.id === reservationId) ?? existing;
    }

    const result = getDb()
      .prepare('DELETE FROM reservations WHERE id = ?')
      .run(reservationId);
    if (result.changes === 0) {
      throw AppError.notFound('Reservation');
    }

    return existing;
  }

  async deleteReservationAsync(
    facilityId: number,
    reservationId: number,
  ): Promise<Reservation> {
    if (env.dbClient === 'postgres') {
      await this.findByIdAsync(facilityId);
      const existing = await this.findReservationByIdAsync(reservationId);
      if (existing.facilityId !== facilityId) {
        throw AppError.notFound('Reservation');
      }

      if (existing.groupId != null) {
        const deleted = await this.deleteReservationGroupAsync(existing.groupId);
        return deleted.reservations.find((item) => item.id === reservationId) ?? existing;
      }

      const result = await getPostgresPool().query(
        'DELETE FROM reservations WHERE id = $1',
        [reservationId],
      );
      if (result.rowCount === 0) {
        throw AppError.notFound('Reservation');
      }
      return existing;
    }
    return this.deleteReservation(facilityId, reservationId);
  }

  deleteReservationGroup(groupId: string): ReservationGroupDetail {
    const deleted = this.findReservationGroupDetailById(groupId);
    getDb()
      .prepare('DELETE FROM reservation_groups WHERE id = ?')
      .run(groupId);
    return deleted;
  }

  async deleteReservationGroupAsync(groupId: string): Promise<ReservationGroupDetail> {
    if (env.dbClient === 'postgres') {
      const deleted = await this.findReservationGroupDetailByIdAsync(groupId);
      await getPostgresPool().query(
        'DELETE FROM reservation_groups WHERE id = $1',
        [groupId],
      );
      return deleted;
    }
    return this.deleteReservationGroup(groupId);
  }

  deleteReservationGroupsBySeriesId(seriesId: string): void {
    getDb()
      .prepare('DELETE FROM reservation_groups WHERE series_id = ?')
      .run(seriesId);
  }

  async deleteReservationGroupsBySeriesIdAsync(seriesId: string): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        'DELETE FROM reservation_groups WHERE series_id = $1',
        [seriesId],
      );
      return;
    }
    this.deleteReservationGroupsBySeriesId(seriesId);
  }
}
