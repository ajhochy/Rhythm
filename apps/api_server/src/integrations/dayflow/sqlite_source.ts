import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, statSync } from 'node:fs';

import Database from 'better-sqlite3';

import type { QualifiedDayflowSnapshot } from './cli_source';
import { normalizeDayflowV260TimelineDetailed } from './normalize';
import type { DayflowFixtureExport, DayflowSource } from './types';

const REQUIRED_COLUMNS = [
  'id', 'start_ts', 'end_ts', 'title', 'summary', 'detailed_summary',
  'category', 'subcategory', 'metadata', 'is_deleted',
] as const;
const MAX_CARDS = 1_000;
const MAX_TEXT_BYTES = 16 * 1024;

export class DayflowSqliteSourceError extends Error {}

/**
 * A private, server-side binding for a selected Dayflow journal. The path is
 * deliberately omitted from all public DTOs.
 */
export interface VerifiedDayflowJournal {
  canonicalPath: string;
  fileIdentity: string;
  schemaFingerprint: string;
}

export interface DayflowJournalVerifier {
  verify(journalPath: string): VerifiedDayflowJournal;
}

type CardRow = {
  id: unknown;
  start_ts: unknown;
  end_ts: unknown;
  title: unknown;
  summary: unknown;
  detailed_summary: unknown;
  category: unknown;
  subcategory: unknown;
  metadata: unknown;
  text_overflow: unknown;
};

/**
 * Validates only the selected SQLite file's identity and table shape. It never
 * reads activity rows. The normal SQLite open (rather than immutable=1) keeps
 * a journal's current WAL visible to later explicit reads.
 */
export function verifyDayflowJournal(journalPath: string): VerifiedDayflowJournal {
  if (!journalPath || journalPath.length > 4096) {
    throw new DayflowSqliteSourceError('Dayflow journal selection is invalid.');
  }
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(journalPath);
    if (!lstatSync(canonicalPath).isFile()) throw new Error('not a file');
  } catch {
    throw new DayflowSqliteSourceError('Dayflow journal is missing.');
  }

  const db = openReadOnly(canonicalPath);
  try {
    const columns = new Set(
      (db.pragma('table_info(timeline_cards)') as Array<{ name?: unknown }>)
        .map((column) => column.name)
        .filter((name): name is string => typeof name === 'string'),
    );
    if (REQUIRED_COLUMNS.some((column) => !columns.has(column))) {
      throw new DayflowSqliteSourceError('Dayflow journal schema is unsupported.');
    }
    const stat = statSync(canonicalPath);
    return {
      canonicalPath,
      fileIdentity: `${stat.dev}:${stat.ino}`,
      schemaFingerprint: createHash('sha256')
        .update([...columns].sort().join('\u0000'))
        .digest('hex'),
    };
  } catch (error) {
    if (error instanceof DayflowSqliteSourceError) throw error;
    throw new DayflowSqliteSourceError('Dayflow journal could not be verified.');
  } finally {
    db.close();
  }
}

/**
 * First-party, bounded reader for the documented v2.6.0 SQLite schema. This
 * is intentionally not a CLI wrapper: it has no child process, telemetry, or
 * environment inheritance, and opens the selected journal read-only.
 */
export class DayflowSqliteSource implements DayflowSource {
  constructor(private readonly journal?: VerifiedDayflowJournal) {}

  hasVerifiedBinding(): boolean {
    return this.journal !== undefined;
  }

  async read(): Promise<DayflowFixtureExport> {
    throw new DayflowSqliteSourceError('A dated Dayflow journal read is required.');
  }

  async readDay(
    request: { date: string; timeZone: string; sourceNamespace: string },
    signal?: AbortSignal,
  ): Promise<QualifiedDayflowSnapshot> {
    if (!this.journal) throw new DayflowSqliteSourceError('Dayflow journal is not selected.');
    throwIfAborted(signal);
    const revalidated = verifyDayflowJournal(this.journal.canonicalPath);
    if (
      revalidated.fileIdentity !== this.journal.fileIdentity ||
      revalidated.schemaFingerprint !== this.journal.schemaFingerprint
    ) {
      throw new DayflowSqliteSourceError('Dayflow journal changed.');
    }

    const { start, end } = dayWindow(request.date, request.timeZone);
    const db = openReadOnly(this.journal.canonicalPath);
    try {
      // This is the upstream v2.6.0 start-based, 04:00-window query. A
      // read-only URI/open with immutable=1 is deliberately not used because
      // it can hide a journal's active WAL.
      // Project the fixed-size marker before each text value. SQLite returns
      // NULL instead of materializing an oversized value into Node, while the
      // marker makes that loss fail closed rather than look like an empty card.
      const rows = db.prepare(`
        SELECT id, start_ts, end_ts,
          CASE WHEN title IS NULL OR (typeof(title) = 'text' AND length(CAST(title AS BLOB)) <= ?) THEN title ELSE NULL END AS title,
          CASE WHEN summary IS NULL OR (typeof(summary) = 'text' AND length(CAST(summary AS BLOB)) <= ?) THEN summary ELSE NULL END AS summary,
          CASE WHEN detailed_summary IS NULL OR (typeof(detailed_summary) = 'text' AND length(CAST(detailed_summary AS BLOB)) <= ?) THEN detailed_summary ELSE NULL END AS detailed_summary,
          CASE WHEN category IS NULL OR (typeof(category) = 'text' AND length(CAST(category AS BLOB)) <= ?) THEN category ELSE NULL END AS category,
          CASE WHEN subcategory IS NULL OR (typeof(subcategory) = 'text' AND length(CAST(subcategory AS BLOB)) <= ?) THEN subcategory ELSE NULL END AS subcategory,
          CASE WHEN metadata IS NULL OR (typeof(metadata) = 'text' AND length(CAST(metadata AS BLOB)) <= ?) THEN metadata ELSE NULL END AS metadata,
          CASE WHEN
            (title IS NOT NULL AND (typeof(title) != 'text' OR length(CAST(title AS BLOB)) > ?)) OR
            (summary IS NOT NULL AND (typeof(summary) != 'text' OR length(CAST(summary AS BLOB)) > ?)) OR
            (detailed_summary IS NOT NULL AND (typeof(detailed_summary) != 'text' OR length(CAST(detailed_summary AS BLOB)) > ?)) OR
            (category IS NOT NULL AND (typeof(category) != 'text' OR length(CAST(category AS BLOB)) > ?)) OR
            (subcategory IS NOT NULL AND (typeof(subcategory) != 'text' OR length(CAST(subcategory AS BLOB)) > ?)) OR
            (metadata IS NOT NULL AND (typeof(metadata) != 'text' OR length(CAST(metadata AS BLOB)) > ?))
          THEN 1 ELSE 0 END AS text_overflow
        FROM timeline_cards
        WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0
        ORDER BY start_ts ASC
        LIMIT ?
      `).all(
        MAX_TEXT_BYTES, MAX_TEXT_BYTES, MAX_TEXT_BYTES, MAX_TEXT_BYTES, MAX_TEXT_BYTES, MAX_TEXT_BYTES,
        MAX_TEXT_BYTES, MAX_TEXT_BYTES, MAX_TEXT_BYTES, MAX_TEXT_BYTES, MAX_TEXT_BYTES, MAX_TEXT_BYTES,
        start, end, MAX_CARDS + 1,
      ) as CardRow[];
      throwIfAborted(signal);
      if (rows.length > MAX_CARDS) {
        throw new DayflowSqliteSourceError('Dayflow journal exceeds the card limit.');
      }
      const cards = rows.map((row) => {
        if (row.text_overflow !== 0) throw new DayflowSqliteSourceError('Dayflow journal contains oversized or unsupported text.');
        return cardFromRow(row);
      });
      const ids = new Set(cards.map((card) => card.record_id));
      if (ids.size !== cards.length) {
        throw new DayflowSqliteSourceError('Dayflow journal contains duplicate card IDs.');
      }
      const raw = {
        schema_version: 1,
        date: request.date,
        time_zone: request.timeZone,
        day_boundary_hour: 4,
        cards,
      };
      const observations = normalizeDayflowV260TimelineDetailed(raw, request.sourceNamespace);
      throwIfAborted(signal);
      return {
        request: structuredClone(request),
        schemaVersion: 1,
        dayBoundaryHour: 4,
        cardCount: cards.length,
        qualified: true,
        raw,
        observations,
      };
    } catch (error) {
      if (error instanceof DayflowSqliteSourceError) throw error;
      throw new DayflowSqliteSourceError('Dayflow journal could not be read.');
    } finally {
      db.close();
    }
  }
}

function openReadOnly(journalPath: string): Database.Database {
  try {
    const db = new Database(journalPath, {
      readonly: true,
      fileMustExist: true,
      timeout: 2_500,
    });
    // Defense in depth: the handle is already readonly, and this additionally
    // refuses writes from statements prepared in this module.
    db.pragma('query_only = ON');
    return db;
  } catch {
    throw new DayflowSqliteSourceError('Dayflow journal is unavailable.');
  }
}

function cardFromRow(row: CardRow): {
  record_id: number;
  start: string;
  end: string;
  title: string;
  summary: string;
  category?: string;
} {
  if (
    !Number.isSafeInteger(row.id) || Number(row.id) <= 0 ||
    !Number.isSafeInteger(row.start_ts) || !Number.isSafeInteger(row.end_ts) ||
    Number(row.end_ts) < Number(row.start_ts)
  ) {
    throw new DayflowSqliteSourceError('Dayflow journal contains an invalid card row.');
  }
  const start = secondTimestamp(Number(row.start_ts));
  const end = secondTimestamp(Number(row.end_ts));
  const title = boundedText(row.title, 'title');
  const summary = boundedText(row.summary, 'summary');
  // Read and bound every upstream-selected text column even though only the
  // documented title/summary fallback reaches the normalizer or memory path.
  boundedText(row.detailed_summary, 'detailed summary');
  boundedText(row.subcategory, 'subcategory');
  boundedText(row.metadata, 'metadata');
  const category = boundedText(row.category, 'category');
  return {
    record_id: Number(row.id),
    start,
    end,
    title,
    summary,
    ...(category ? { category } : {}),
  };
}

function boundedText(value: unknown, field: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) {
    throw new DayflowSqliteSourceError(`Dayflow ${field} is invalid or too large.`);
  }
  return value;
}

function secondTimestamp(value: number): string {
  const instant = new Date(value * 1_000);
  if (Number.isNaN(instant.valueOf())) {
    throw new DayflowSqliteSourceError('Dayflow timestamp is invalid.');
  }
  return instant.toISOString().replace('.000Z', 'Z');
}

function dayWindow(date: string, timeZone: string): { start: number; end: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new DayflowSqliteSourceError('Dayflow date is invalid.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    throw new DayflowSqliteSourceError('Dayflow date is invalid.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new DayflowSqliteSourceError('Dayflow timezone is invalid.');
  }
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: localFourAmEpoch(year, month, day, timeZone),
    end: localFourAmEpoch(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
  };
}

/** Convert a real local 04:00 boundary to seconds without treating it as UTC. */
function localFourAmEpoch(year: number, month: number, day: number, timeZone: string): number {
  const wanted = Date.UTC(year, month - 1, day, 4, 0, 0);
  let guess = wanted;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let attempts = 0; attempts < 4; attempts += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    const observed = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const delta = wanted - observed;
    if (delta === 0) return Math.floor(guess / 1_000);
    guess += delta;
  }
  throw new DayflowSqliteSourceError('Dayflow timezone boundary is invalid.');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DayflowSqliteSourceError('Dayflow journal read was cancelled.');
}
