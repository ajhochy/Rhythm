import { createHash } from 'node:crypto';
import { redactSummary } from './redact';
import type { DayflowFixtureExport, DayflowObservation } from './types';

const offsetTimestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/;
const recordId = /^(?:[1-9]\d{0,18}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;

function partsAt(instant: Date, timezone: string): Record<string, string> {
  try {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(instant).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  } catch { throw new Error('Dayflow timezone is invalid.'); }
}

function dayKey(start: string, timezone: string): string {
  if (!offsetTimestamp.test(start)) throw new Error('Dayflow timestamps require an explicit offset to avoid ambiguous local instants.');
  const instant = new Date(start);
  if (Number.isNaN(instant.valueOf())) throw new Error('Dayflow timestamp is invalid.');
  const p = partsAt(instant, timezone);
  const localDay = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  if (Number(p.hour) < 4) localDay.setUTCDate(localDay.getUTCDate() - 1);
  return localDay.toISOString().slice(0, 10);
}

function validTimestamp(value: string, field: string): Date {
  const match = offsetTimestamp.exec(value); if (!match) throw new Error(`Dayflow ${field} requires a whole-second explicit offset.`);
  const [, y, m, d, hh, mm, ss, zone] = match;
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31 || +hh > 23 || +mm > 59 || +ss > 59 || (zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4, 6) > 59))) throw new Error(`Dayflow ${field} is invalid.`);
  const calendar = new Date(Date.UTC(+y, +m - 1, +d));
  if (calendar.getUTCFullYear() !== +y || calendar.getUTCMonth() !== +m - 1 || calendar.getUTCDate() !== +d) throw new Error(`Dayflow ${field} is invalid.`);
  const date = new Date(value); if (Number.isNaN(date.valueOf())) throw new Error(`Dayflow ${field} is invalid.`); return date;
}

function validCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3];
}

export function normalizeFixtureExport(raw: unknown, timezone = 'UTC'): DayflowObservation[] {
  const result = normalizeFixtureExportDetailed(raw, timezone); if (result.rejected.length) throw new Error(`Dayflow record withheld: ${result.rejected[0].reason}`); return result.observations;
}

/** A withheld card is rejected alone; it cannot erase safe siblings from a preview. */
export function normalizeFixtureExportDetailed(raw: unknown, timezone = 'UTC'): { observations: DayflowObservation[]; rejected: Array<{ recordIndex: number; reason: string }> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Dayflow export is malformed.');
  const exportData = raw as DayflowFixtureExport;
  if (exportData.contractVersion !== 'fixture-v1') throw new Error('Unsupported Dayflow fixture schema.');
  if (typeof exportData.sourceInstanceId !== 'string' || !exportData.sourceInstanceId.trim()) throw new Error('Dayflow source identity is missing.');
  if (!Array.isArray(exportData.records)) throw new Error('Dayflow records are malformed.');
  const observations: DayflowObservation[] = []; const rejected: Array<{ recordIndex: number; reason: string }> = [];
  exportData.records.forEach((record, recordIndex) => {
    try {
    if (typeof record.id !== 'string' || !recordId.test(record.id)) throw new Error('Dayflow record identity is invalid.');
    if (typeof record.start !== 'string') throw new Error('Dayflow observed start is missing.');
    if (record.end !== undefined && typeof record.end !== 'string') throw new Error('Dayflow observed end is malformed.');
    if (typeof record.summary !== 'string') throw new Error('Dayflow summary is missing.');
    const redacted = redactSummary(record.summary);
    if (redacted.withheld) { rejected.push({ recordIndex, reason: redacted.reason ?? 'sensitive content' }); return; }
    const observedStart = record.start; const startDate = validTimestamp(observedStart, 'observed start');
    const observedEnd = record.end;
    if (observedEnd !== undefined && validTimestamp(observedEnd, 'observed end') < startDate) throw new Error('Dayflow observed end precedes start.');
    const revisionHash = createHash('sha256').update(JSON.stringify({ observedStart, observedEnd, summary: redacted.summary, category: record.category })).digest('hex');
    observations.push({ sourceInstanceId: exportData.sourceInstanceId, recordId: record.id, revisionHash, observedStart, observedEnd, dayKey: dayKey(observedStart, timezone), summary: redacted.summary, category: typeof record.category === 'string' ? record.category : undefined, exportVersion: 'fixture-v1' });
    } catch (error) { throw error; }
  });
  return { observations, rejected };
}

/** Offline parser for the researched v2.6.0 JSON shape. It does not execute Dayflow. */
export function normalizeDayflowV260Timeline(raw: unknown, sourceInstanceId: string): DayflowObservation[] {
  return normalizeDayflowV260TimelineDetailed(raw, sourceInstanceId).observations;
}

export function normalizeDayflowV260TimelineDetailed(raw: unknown, sourceInstanceId: string): { observations: DayflowObservation[]; rejected: Array<{ recordIndex: number; reason: string }> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Dayflow timeline is malformed.');
  const timeline = raw as { schema_version?: unknown; date?: unknown; time_zone?: unknown; day_boundary_hour?: unknown; cards?: unknown; detail_available?: unknown; aggregated?: unknown; incomplete?: unknown };
  if (timeline.schema_version !== 1 || typeof timeline.time_zone !== 'string' || timeline.day_boundary_hour !== 4 || !Array.isArray(timeline.cards)) throw new Error('Unsupported Dayflow v2.6.0 timeline schema.');
  if (!validCalendarDay(timeline.date)) throw new Error('Dayflow timeline date is invalid.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: timeline.time_zone }); } catch { throw new Error('Dayflow timeline timezone is invalid.'); }
  // `detail_available` is inverted by the pinned detailed exporter. It is an
  // analysis-detail hint, not evidence that a successful single-day snapshot
  // is incomplete. Card absence never authorizes deletion inference.
  if (timeline.aggregated === true || timeline.incomplete === true) throw new Error('Incomplete Dayflow data cannot establish snapshot completeness.');
  if (timeline.cards.length > 1000) throw new Error('Dayflow timeline exceeds the safety record limit.');
  const fixture = { contractVersion: 'fixture-v1' as const, sourceInstanceId, records: timeline.cards.map((card) => {
    const c = card as { record_id?: unknown; start?: unknown; end?: unknown; summary?: unknown; title?: unknown; category?: unknown };
    return { id: typeof c.record_id === 'string' || typeof c.record_id === 'number' ? String(c.record_id) : c.record_id, start: c.start, end: c.end, summary: typeof c.summary === 'string' && c.summary.trim() ? c.summary : c.title, category: c.category };
  }) };
  const result = normalizeFixtureExportDetailed(fixture, timeline.time_zone);
  return { observations: result.observations.map((item) => ({ ...item, exportVersion: 'v2.6.0' as const })), rejected: result.rejected };
}
