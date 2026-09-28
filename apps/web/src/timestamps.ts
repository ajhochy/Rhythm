export type TimestampOptions = { now?: Date; locale?: string; timeZone?: string };
export type FormattedTimestamp = { iso: string; label: string; full: string };

// ponytail: reservation-only local wall clocks use the host zone; a future per-facility zone needs explicit disambiguation for DST gaps/folds.
export function wallClockInstant(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/.exec(value);
  if (!match) {
    if (!/(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(value)) return null;
    const zoned = formatTimestamp(value);
    return zoned ? new Date(zoned.iso) : null;
  }
  const [, year, month, day, hour, min, sec, fraction] = match;
  const [y, m, d, h, minute, second] = [year, month, day, hour, min, sec ?? '00'].map(Number);
  const date = new Date(0);
  date.setFullYear(y, m - 1, d);
  date.setHours(h, minute, second, Number((fraction ?? '').padEnd(3, '0').slice(0, 3)));
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === minute && date.getSeconds() === second ? date : null;
}

// ponytail: validate original fields before Date normalization; zoneless wire timestamps are UTC.
export function formatTimestamp(value: unknown, { now = new Date(), locale = 'en-US', timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: TimestampOptions = {}): FormattedTimestamp | null {
  if (Number.isNaN(now.getTime())) throw new RangeError('Invalid now');
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?([Zz]|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, minute, second = '00', fraction = '', zone = 'Z'] = match;
  const [year, month, day, hour, min, sec] = [y, m, d, h, minute, second].map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || min > 59 || sec > 59) return null;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(0, 0, 0, 0);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  let offset = 0;
  if (!/^[Zz]$/.test(zone)) {
    const digits = zone.slice(1).replace(':', '');
    const offsetHour = Number(digits.slice(0, 2));
    const offsetMinute = Number(digits.slice(2));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offset = (zone[0] === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  }
  const instant = calendar.getTime() + ((hour * 60 + min - offset) * 60 + sec) * 1000 + Number(fraction.padEnd(3, '0').slice(0, 3));
  if (!Number.isFinite(instant) || instant === 0) return null;
  const date = new Date(instant);
  const calendarParts = (item: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(item).map(part => [part.type, part.value]));
  const current = calendarParts(now);
  const target = calendarParts(date);
  const sameDay = current.year === target.year && current.month === target.month && current.day === target.day;
  const sameYear = current.year === target.year;
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
  const datePart = new Intl.DateTimeFormat(locale, { timeZone, month: 'short', day: 'numeric', ...(!sameYear ? { year: 'numeric' } : {}) }).format(date);
  const full = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'full', timeStyle: 'long', hour12: true }).format(date);
  return { iso: date.toISOString(), label: sameDay ? time : `${datePart}, ${time}`, full };
}

export function formatResetIn(value: unknown, options: Pick<TimestampOptions, 'now'> = {}): string | null {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new RangeError('Invalid now');
  const formatted = formatTimestamp(value, { now });
  if (!formatted) return null;
  const milliseconds = new Date(formatted.iso).getTime() - now.getTime();
  if (milliseconds <= 0) return 'resets now';
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes >= 60 * 24) return `resets ${Math.floor(minutes / (60 * 24))}d`;
  if (minutes >= 60) return `resets ${Math.floor(minutes / 60)}h`;
  return minutes > 0 ? `resets ${minutes}m` : 'resets now';
}
