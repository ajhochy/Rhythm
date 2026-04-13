import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getPostgresPool } from '../database/db';
import type { CalendarShadowEvent } from '../models/calendar_shadow_event';

interface CalendarShadowEventRow {
  id: string;
  owner_id: number | null;
  provider: string;
  external_id: string;
  calendar_id: string;
  source_name: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  is_all_day: number;
  created_at: string;
  updated_at: string;
}

function rowToEvent(row: CalendarShadowEventRow): CalendarShadowEvent {
  const isAllDay =
    typeof row.is_all_day === 'boolean' ? row.is_all_day : row.is_all_day === 1;

  return {
    id: row.id,
    ownerId: row.owner_id,
    provider: row.provider as 'google_calendar',
    externalId: row.external_id,
    calendarId: row.calendar_id,
    sourceName: row.source_name,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.start_at,
    endAt: row.end_at,
    isAllDay,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CalendarShadowEventsRepository {
  async findByRangeAsync(
    startAt: string,
    endAt: string,
    ownerId?: number,
  ): Promise<CalendarShadowEvent[]> {
    if (env.dbClient === 'postgres') {
      const result =
        ownerId != null
          ? await getPostgresPool().query<CalendarShadowEventRow>(
              `SELECT * FROM calendar_shadow_events
               WHERE owner_id = $1
                 AND start_at BETWEEN $2 AND $3
               ORDER BY start_at ASC`,
              [ownerId, startAt, endAt],
            )
          : await getPostgresPool().query<CalendarShadowEventRow>(
              `SELECT * FROM calendar_shadow_events
               WHERE start_at BETWEEN $1 AND $2
               ORDER BY start_at ASC`,
              [startAt, endAt],
            );
      return result.rows.map(rowToEvent);
    }

    return this.findByRange(startAt, endAt, ownerId);
  }

  replaceForOwner(
    ownerId: number,
    events: Array<{
      provider: 'google_calendar';
      externalId: string;
      calendarId: string;
      sourceName: string | null;
      title: string;
      description: string | null;
      location: string | null;
      startAt: string;
      endAt: string | null;
      isAllDay: boolean;
    }>,
  ): CalendarShadowEvent[] {
    const now = new Date().toISOString();
    const db = getDb();
    const deleteStmt = db.prepare(
      'DELETE FROM calendar_shadow_events WHERE owner_id = ?',
    );
    const insertStmt = db.prepare(
      `INSERT INTO calendar_shadow_events (
        id, owner_id, provider, external_id, calendar_id, source_name, title,
        description, location, start_at, end_at, is_all_day, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    db.transaction(() => {
      deleteStmt.run(ownerId);
      for (const event of events) {
        insertStmt.run(
          uuidv4(),
          ownerId,
          event.provider,
          event.externalId,
          event.calendarId,
          event.sourceName,
          event.title,
          event.description,
          event.location,
          event.startAt,
          event.endAt,
          event.isAllDay ? 1 : 0,
          now,
          now,
        );
      }
    })();

    if (events.length == 0) {
      return [];
    }

    const rows = db
      .prepare(
        `SELECT * FROM calendar_shadow_events
         WHERE owner_id = ?
           AND external_id IN (${events.map(() => '?').join(', ')})`,
      )
      .all(ownerId, ...events.map((event) => event.externalId)) as CalendarShadowEventRow[];
    return rows.map(rowToEvent);
  }

  findByRange(startAt: string, endAt: string, ownerId?: number): CalendarShadowEvent[] {
    const rows =
      ownerId != null
        ? ((getDb()
            .prepare(
              `SELECT * FROM calendar_shadow_events
               WHERE owner_id = ?
                 AND start_at BETWEEN ? AND ?
               ORDER BY start_at ASC`,
            )
            .all(ownerId, startAt, endAt)) as CalendarShadowEventRow[])
        : ((getDb()
            .prepare(
              `SELECT * FROM calendar_shadow_events
               WHERE start_at BETWEEN ? AND ?
               ORDER BY start_at ASC`,
            )
            .all(startAt, endAt)) as CalendarShadowEventRow[]);
    return rows.map(rowToEvent);
  }

  async replaceForOwnerAsync(
    ownerId: number,
    events: Array<{
      provider: 'google_calendar';
      externalId: string;
      calendarId: string;
      sourceName: string | null;
      title: string;
      description: string | null;
      location: string | null;
      startAt: string;
      endAt: string | null;
      isAllDay: boolean;
    }>,
  ): Promise<CalendarShadowEvent[]> {
    if (env.dbClient === 'postgres') {
      const now = new Date().toISOString();
      await getPostgresPool().query(
        'DELETE FROM calendar_shadow_events WHERE owner_id = $1',
        [ownerId],
      );

      for (const event of events) {
        await getPostgresPool().query(
          `INSERT INTO calendar_shadow_events (
            id, owner_id, provider, external_id, calendar_id, source_name, title,
            description, location, start_at, end_at, is_all_day, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            uuidv4(),
            ownerId,
            event.provider,
            event.externalId,
            event.calendarId,
            event.sourceName,
            event.title,
            event.description,
            event.location,
            event.startAt,
            event.endAt,
            event.isAllDay,
            now,
            now,
          ],
        );
      }

      return this.findByRangeAsync('0000-01-01T00:00:00Z', '9999-12-31T23:59:59Z', ownerId);
    }

    return this.replaceForOwner(ownerId, events);
  }
}
