import crypto from 'node:crypto';
import { getDb } from '../database/db';
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
  created_by_rhythm: number;
  is_conflicted: number;
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
    createdByRhythm: row.created_by_rhythm === 1,
    isConflicted: row.is_conflicted === 1,
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

  findAll(): Facility[] {
    const rows = getDb()
      .prepare('SELECT * FROM facilities ORDER BY name ASC')
      .all() as FacilityRow[];
    return rows.map(rowToFacility);
  }

  findById(id: number): Facility {
    const row = getDb()
      .prepare('SELECT * FROM facilities WHERE id = ?')
      .get(id) as FacilityRow | undefined;
    if (!row) throw AppError.notFound('Facility');
    return rowToFacility(row);
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

  delete(id: number): void {
    const result = getDb().prepare('DELETE FROM facilities WHERE id = ?').run(id);
    if (result.changes === 0) throw AppError.notFound('Facility');
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

  findReservationGroupById(id: string): ReservationGroup {
    const row = getDb()
      .prepare(`${RESERVATION_GROUP_SELECT} WHERE id = ?`)
      .get(id) as ReservationGroupRow | undefined;
    if (!row) throw AppError.notFound('ReservationGroup');
    return rowToReservationGroup(row);
  }

  findReservationGroupDetailById(id: string): ReservationGroupDetail {
    return {
      group: this.findReservationGroupById(id),
      reservations: this.findReservationsByGroupId(id),
    };
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

  findReservationSeriesByFacility(facilityId: number): ReservationSeries[] {
    this.findById(facilityId);
    const rows = getDb()
      .prepare(
        'SELECT * FROM reservation_series WHERE facility_id = ? ORDER BY created_at DESC',
      )
      .all(facilityId) as ReservationSeriesRow[];
    return rows.map(rowToReservationSeries);
  }

  findReservationSeriesById(id: string): ReservationSeries {
    const row = getDb()
      .prepare('SELECT * FROM reservation_series WHERE id = ?')
      .get(id) as ReservationSeriesRow | undefined;
    if (!row) throw AppError.notFound('ReservationSeries');
    return rowToReservationSeries(row);
  }

  findReservationSeriesDetailById(id: string): ReservationSeriesDetail {
    return {
      series: this.findReservationSeriesById(id),
      reservations: this.findReservationsBySeriesId(id),
    };
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

  deleteReservationsBySeriesId(seriesId: string): Reservation[] {
    const deleted = this.findReservationsBySeriesId(seriesId);
    this.deleteReservationGroupsBySeriesId(seriesId);
    return deleted;
  }

  deleteReservationSeriesById(id: string): ReservationSeries {
    const series = this.findReservationSeriesById(id);
    getDb()
      .prepare('DELETE FROM reservation_series WHERE id = ?')
      .run(id);
    return series;
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

  deleteReservationGroup(groupId: string): ReservationGroupDetail {
    const deleted = this.findReservationGroupDetailById(groupId);
    getDb()
      .prepare('DELETE FROM reservation_groups WHERE id = ?')
      .run(groupId);
    return deleted;
  }

  deleteReservationGroupsBySeriesId(seriesId: string): void {
    getDb()
      .prepare('DELETE FROM reservation_groups WHERE series_id = ?')
      .run(seriesId);
  }
}
