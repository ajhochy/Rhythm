import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  CreateFacilityDto,
  CreateReservationDto,
  Facility,
  Reservation,
  UpdateReservationDto,
  UpdateFacilityDto,
} from '../models/facility';

interface FacilityRow {
  id: number;
  name: string;
  description: string | null;
  capacity: number | null;
  location: string | null;
  created_at: string;
  updated_at: string;
}

interface ReservationRow {
  id: number;
  facility_id: number;
  title: string;
  reserved_by: string;
  reserved_by_user_id: number | null;
  start_time: string;
  end_time: string;
  notes: string | null;
  created_at: string;
}

function rowToFacility(row: FacilityRow): Facility {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    capacity: row.capacity,
    location: row.location,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    facilityId: row.facility_id,
    title: row.title,
    reservedBy: row.reserved_by,
    reservedByUserId: row.reserved_by_user_id,
    startTime: row.start_time,
    endTime: row.end_time,
    notes: row.notes,
    createdAt: row.created_at,
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
        `INSERT INTO facilities (name, description, capacity, location) VALUES (?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.description ?? null,
        data.capacity ?? null,
        data.location ?? null,
      );
    return this.findById(result.lastInsertRowid as number);
  }

  update(id: number, data: UpdateFacilityDto): Facility {
    const existing = this.findById(id);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE facilities SET name = ?, description = ?, capacity = ?, location = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        data.name ?? existing.name,
        data.description !== undefined ? data.description : existing.description,
        data.capacity !== undefined ? data.capacity : existing.capacity,
        data.location !== undefined ? data.location : existing.location,
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
        'SELECT * FROM reservations WHERE facility_id = ? ORDER BY start_time ASC',
      )
      .all(facilityId) as ReservationRow[];
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
           facility_id, title, reserved_by, reserved_by_user_id, start_time, end_time, notes
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        facilityId,
        data.title,
        data.reserved_by,
        data.reserved_by_user_id ?? null,
        data.start_time,
        data.end_time,
        data.notes ?? null,
      );
    const row = getDb()
      .prepare('SELECT * FROM reservations WHERE id = ?')
      .get(result.lastInsertRowid as number) as ReservationRow;
    return rowToReservation(row);
  }

  findReservationById(id: number): Reservation {
    const row = getDb()
      .prepare('SELECT * FROM reservations WHERE id = ?')
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
         SET title = ?, reserved_by = ?, reserved_by_user_id = ?, start_time = ?, end_time = ?, notes = ?
         WHERE id = ?`,
      )
      .run(
        data.title ?? existing.title,
        data.reserved_by ?? existing.reservedBy,
        data.reserved_by_user_id !== undefined
            ? data.reserved_by_user_id
            : existing.reservedByUserId,
        data.start_time ?? existing.startTime,
        data.end_time ?? existing.endTime,
        data.notes !== undefined ? data.notes : existing.notes,
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
