import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
import type { CalendarShadowEvent } from '../models/calendar_shadow_event';

interface CalendarShadowEventRow {
  id: string;
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
  return {
    id: row.id,
    provider: row.provider as 'google_calendar',
    externalId: row.external_id,
    calendarId: row.calendar_id,
    sourceName: row.source_name,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.start_at,
    endAt: row.end_at,
    isAllDay: row.is_all_day === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CalendarShadowEventsRepository {
  upsertMany(
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

    const existingStmt = db.prepare(
      'SELECT * FROM calendar_shadow_events WHERE external_id = ?',
    );
    const insertStmt = db.prepare(
      `INSERT INTO calendar_shadow_events (
        id, provider, external_id, calendar_id, source_name, title,
        description, location, start_at, end_at, is_all_day, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateStmt = db.prepare(
      `UPDATE calendar_shadow_events
       SET provider = ?, calendar_id = ?, source_name = ?, title = ?, description = ?,
           location = ?, start_at = ?, end_at = ?, is_all_day = ?, updated_at = ?
       WHERE id = ?`,
    );

    db.transaction(() => {
      for (const event of events) {
        const existing = existingStmt.get(
          event.externalId,
        ) as CalendarShadowEventRow | undefined;

        if (existing) {
          updateStmt.run(
            event.provider,
            event.calendarId,
            event.sourceName,
            event.title,
            event.description,
            event.location,
            event.startAt,
            event.endAt,
            event.isAllDay ? 1 : 0,
            now,
            existing.id,
          );
        } else {
          insertStmt.run(
            uuidv4(),
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
      }
    })();

    const rows = db
      .prepare(
        `SELECT * FROM calendar_shadow_events
         WHERE external_id IN (${events.map(() => '?').join(', ')})`,
      )
      .all(...events.map((event) => event.externalId)) as CalendarShadowEventRow[];
    return rows.map(rowToEvent);
  }

  findByRange(startAt: string, endAt: string): CalendarShadowEvent[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM calendar_shadow_events
         WHERE start_at BETWEEN ? AND ?
         ORDER BY start_at ASC`,
      )
      .all(startAt, endAt) as CalendarShadowEventRow[];
    return rows.map(rowToEvent);
  }
}
