import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  CreateFacilityDto,
  CreateReservationDto,
  CreateReservationSeriesDto,
  Facility,
  Reservation,
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

function rowToReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    facilityId: row.facility_id,
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
  private assertReservationWindowAvailable(
    facilityId: number,
    startTime: string,
    endTime: string,
    excludeReservationId?: number,
  ): void {
    const conflict = getDb()
      .prepare(
        `SELECT title, start_time, end_time
         FROM reservations
         WHERE facility_id = ?
           AND (? IS NULL OR id != ?)
           AND start_time < ?
           AND end_time > ?
         LIMIT 1`,
      )
      .get(
        facilityId,
        excludeReservationId ?? null,
        excludeReservationId ?? null,
        endTime,
        startTime,
      ) as
      | { title: string; start_time: string; end_time: string }
      | undefined;

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

  createReservation(facilityId: number, data: CreateReservationDto): Reservation {
    // Ensure facility exists
    this.findById(facilityId);
    this.assertReservationWindowAvailable(
      facilityId,
      data.start_time,
      data.end_time,
    );
    const result = getDb()
      .prepare(
        `INSERT INTO reservations (
           facility_id, title, reserved_by, reserved_by_user_id, created_by_user_id,
           series_id,
           start_time, end_time, notes, external_event_id, external_source,
           created_by_rhythm, is_conflicted, conflict_reason, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        facilityId,
        data.title,
        data.requester_name,
        data.requester_user_id ?? null,
        data.created_by_user_id ?? null,
        data.series_id ?? null,
        data.start_time,
        data.end_time,
        data.notes ?? null,
        null,
        null,
        1,
        0,
        null,
        new Date().toISOString(),
      );
    const row = getDb()
      .prepare(`${RESERVATION_SELECT} WHERE reservations.id = ?`)
      .get(result.lastInsertRowid as number) as ReservationRow;
    return rowToReservation(row);
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

  findReservationById(id: number): Reservation {
    const row = getDb()
      .prepare(`${RESERVATION_SELECT} WHERE reservations.id = ?`)
      .get(id) as ReservationRow | undefined;
    if (!row) throw AppError.notFound('Reservation');
    return rowToReservation(row);
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

  deleteReservation(facilityId: number, reservationId: number): Reservation {
    this.findById(facilityId);
    const existing = this.findReservationById(reservationId);
    if (existing.facilityId !== facilityId) {
      throw AppError.notFound('Reservation');
    }

    const result = getDb()
      .prepare('DELETE FROM reservations WHERE id = ?')
      .run(reservationId);
    if (result.changes === 0) {
      throw AppError.notFound('Reservation');
    }

    return existing;
  }
}
