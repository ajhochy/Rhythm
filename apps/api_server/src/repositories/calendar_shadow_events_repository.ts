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

export interface CalendarLocalWindowInput {
  /** Required exact owner; a missing/invalid owner never reads anything. */
  ownerId: number;
  /** Half-open window [startMs, endMs) as normalized instants. */
  startMs: number;
  endMs: number;
  /** The same window as civil days in the coordinator zone: [startDay, endDayExclusive). */
  startDay: string;
  endDayExclusive: string;
  /** Null = no selection filter (default-all at sync time); otherwise only these calendars. */
  calendarIds: string[] | null;
  limit: number;
  /** Midnight instant of a civil day in the coordinator zone (all-day ordering). */
  dayStartMs: (day: string) => number;
}

export interface CalendarLocalWindowEvent {
  id: string;
  calendarId: string;
  title: string;
  startAt: string;
  endAt: string | null;
  isAllDay: boolean;
  startMs: number;
}

export interface CalendarLocalWindowResult {
  events: CalendarLocalWindowEvent[];
  /** More qualifying rows existed than `limit` (one-row lookahead). */
  hasMore: boolean;
  /** The candidate scan hit its cap: there may be more rows than examined. */
  scanLimited: boolean;
  /** Rows with unparseable times were skipped, never treated as events. */
  invalidRows: number;
}

const WINDOW_SCAN_CAP = 1_000;
const TIMED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function shiftDay(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10);
}

export class CalendarShadowEventsRepository {
  /**
   * Read-only, owner-exact window over the CACHED local mirror. Never contacts a
   * provider, never mutates. Timed rows overlap by normalized instants (so an
   * event spanning the window start is eligible and offsets are equivalent);
   * all-day rows use civil days with an exclusive end date. Ordering is
   * normalized start then id — never raw ISO string order across offsets. Only
   * the columns needed for the observation are read (no description/location).
   */
  findLocalWindowObservations(input: CalendarLocalWindowInput): CalendarLocalWindowResult {
    if (env.dbClient === 'postgres') throw new Error('local calendar window is SQLite-only');
    if (!Number.isSafeInteger(input.ownerId) || input.ownerId <= 0) throw new Error('owner required');
    const filter = input.calendarIds === null ? '' : input.calendarIds.length === 0
      ? ' AND 0'
      : ` AND calendar_id IN (${input.calendarIds.map(() => '?').join(', ')})`;
    // Coarse date-prefix prefilter with a one-day margin (offsets shift a local
    // date by at most a day); the exact decision below uses normalized values.
    const rows = getDb().prepare(
      `SELECT id, calendar_id, title, start_at, end_at, is_all_day FROM calendar_shadow_events
        WHERE owner_id = ?${filter}
          AND substr(start_at, 1, 10) <= ?
          AND (end_at IS NULL OR substr(end_at, 1, 10) >= ?)
        LIMIT ?`,
    ).all(
      input.ownerId,
      ...(input.calendarIds ?? []),
      shiftDay(input.endDayExclusive, 1),
      shiftDay(input.startDay, -1),
      WINDOW_SCAN_CAP + 1,
    ) as Array<{ id: string; calendar_id: string; title: string; start_at: string; end_at: string | null; is_all_day: number | boolean }>;
    const scanLimited = rows.length > WINDOW_SCAN_CAP;
    let invalidRows = 0;
    const matched: CalendarLocalWindowEvent[] = [];
    for (const row of rows.slice(0, WINDOW_SCAN_CAP)) {
      const allDay = typeof row.is_all_day === 'boolean' ? row.is_all_day : row.is_all_day === 1;
      const base = { id: row.id, calendarId: row.calendar_id, title: row.title, startAt: row.start_at, endAt: row.end_at, isAllDay: allDay };
      if (allDay) {
        if (!DATE_ONLY.test(row.start_at) || Number.isNaN(Date.parse(`${row.start_at}T00:00:00Z`))) { invalidRows += 1; continue; }
        const endExclusive = row.end_at !== null && DATE_ONLY.test(row.end_at) && row.end_at > row.start_at
          ? row.end_at : shiftDay(row.start_at, 1);
        if (row.start_at < input.endDayExclusive && endExclusive > input.startDay) {
          matched.push({ ...base, startMs: input.dayStartMs(row.start_at) });
        }
        continue;
      }
      if (!TIMED.test(row.start_at) || Number.isNaN(Date.parse(row.start_at))) { invalidRows += 1; continue; }
      const startMs = Date.parse(row.start_at);
      const parsedEnd = row.end_at !== null && TIMED.test(row.end_at) ? Date.parse(row.end_at) : Number.NaN;
      const endMs = Number.isNaN(parsedEnd) || parsedEnd < startMs ? startMs : parsedEnd;
      const overlaps = endMs > startMs
        ? startMs < input.endMs && endMs > input.startMs
        : startMs >= input.startMs && startMs < input.endMs;
      if (overlaps) matched.push({ ...base, startMs });
    }
    matched.sort((left, right) => left.startMs - right.startMs || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    return {
      events: matched.slice(0, input.limit),
      hasMore: matched.length > input.limit,
      scanLimited,
      invalidRows,
    };
  }

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
