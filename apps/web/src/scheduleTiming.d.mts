export function validScheduleTimeZone(value: string): boolean;
export function validCronExpression(value: string): boolean;
export function validateScheduleTiming(schedule: {
  enabled?: boolean; scheduleType: string; runAt?: string | null; scheduledTime?: string | null;
  scheduledDay?: number | null; cronExpression?: string | null; timezone?: string | null;
}, now?: number): string | null;
export function isConsumedOnceSchedule(schedule: {
  scheduleType: string; runAt?: string | null; lastRunAt?: string | null;
  lastRunStatus?: string | null;
}): boolean;
export function scheduleTimeZones(current?: string): string[];
export function formatLocalDateTime(value: string | null): string;
export function localDateTimeToIso(value: string, originalValue?: string, originalIso?: string | null): string | null;
