import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  CreateFacilityDto,
  CreateReservationDto,
  Facility,
  Reservation,
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
}
