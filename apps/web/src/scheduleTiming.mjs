const pad = value => String(value).padStart(2, '0');

export function validScheduleTimeZone(value) {
  if (typeof value !== 'string' || !value) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; }
  catch { return false; }
}

export function validCronExpression(value) {
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return fields.every((field, index) => field.split(',').every(part => {
    const pieces = part.split('/');
    if (pieces.length > 2 || (pieces.length === 2 && (!/^\d+$/.test(pieces[1]) || Number(pieces[1]) < 1))) return false;
    const base = pieces[0];
    if (base === '*') return true;
    const range = base.split('-');
    if (range.length > 2 || range.some(value => !/^\d+$/.test(value))) return false;
    const [min, max] = bounds[index];
    return range.every(value => Number(value) >= min && Number(value) <= max)
      && (range.length === 1 || Number(range[0]) <= Number(range[1]));
  }));
}

export function validateScheduleTiming(schedule, now = Date.now()) {
  if (!schedule.enabled) return null;
  if (schedule.scheduleType === 'once') {
    if (!schedule.runAt) return 'Run at is required for an enabled one-time schedule.';
    const timestamp = Date.parse(schedule.runAt);
    if (!Number.isFinite(timestamp)) return 'Enter a valid local date and time for this one-time schedule.';
    if (timestamp <= now) return 'Choose a future local date and time for an enabled one-time schedule.';
    return null;
  }
  if (!validScheduleTimeZone(schedule.timezone)) return 'Choose a valid IANA timezone.';
  if (schedule.scheduleType === 'cron') return validCronExpression(schedule.cronExpression ?? '')
    ? null : 'Enter a valid five-field cron expression for an enabled schedule.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.scheduledTime ?? '')) return 'Time is required for an enabled recurring schedule.';
  if (schedule.scheduleType === 'weekly') {
    const day = schedule.scheduledDay;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) return 'Choose the scheduled weekday.';
  }
  if (schedule.scheduleType === 'monthly') {
    const day = schedule.scheduledDay;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31) return 'Choose the scheduled day of month.';
  }
  return null;
}

export function scheduleTimeZones(current) {
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const zones = new Set(['UTC', ...supported]);
  if (validScheduleTimeZone(current)) zones.add(current);
  return ['UTC', ...[...zones].filter(zone => zone !== 'UTC').sort()];
}

export function formatLocalDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const milliseconds = date.getMilliseconds();
  if (milliseconds) return `${base}:${pad(date.getSeconds())}.${String(milliseconds).padStart(3, '0')}`;
  if (date.getSeconds()) return `${base}:${pad(date.getSeconds())}`;
  return base;
}

export function localDateTimeToIso(value, originalValue = '', originalIso = null) {
  if (!value) return null;
  if (value === originalValue && originalIso && Number.isFinite(new Date(originalIso).getTime())) return originalIso;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
