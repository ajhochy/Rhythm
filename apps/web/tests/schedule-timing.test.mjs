import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLocalDateTime, isConsumedOnceSchedule, localDateTimeToIso, scheduleTimeZones, validCronExpression, validScheduleTimeZone, validateScheduleTiming } from '../src/scheduleTiming.mjs';

test('schedule timing preserves the exact saved once instant when the local editor value is untouched', () => {
  const original = '2031-06-14T19:22:33.456Z';
  const local = formatLocalDateTime(original);
  assert.match(local, /T\d\d:\d\d:33\.456$/);
  assert.equal(localDateTimeToIso(local, local, original), original);
});

test('schedule timing converts an edited local once value to an ISO instant', () => {
  const value = '2031-06-14T12:22';
  assert.equal(localDateTimeToIso(value), new Date(value).toISOString());
  assert.equal(localDateTimeToIso('', '', null), null);
});

test('timezone choices include UTC and retain a valid stored IANA zone', () => {
  assert.equal(validScheduleTimeZone('UTC'), true);
  assert.equal(validScheduleTimeZone('America/Los_Angeles'), true);
  assert.equal(validScheduleTimeZone('Not/A_Timezone'), false);
  const choices = scheduleTimeZones('America/Los_Angeles');
  assert.equal(choices[0], 'UTC');
  assert.ok(choices.includes('America/Los_Angeles'));
});

test('cron timing accepts the scheduler five-field numeric form and rejects malformed ranges', () => {
  assert.equal(validCronExpression('15 9 * * 1-5'), true);
  assert.equal(validCronExpression('0 */2 * * *'), true);
  assert.equal(validCronExpression('60 9 * * *'), false);
  assert.equal(validCronExpression('0 9 * *'), false);
});

test('enabled schedule timing validation is shared by saves and the enable action', () => {
  const now = Date.parse('2031-01-01T00:00:00.000Z');
  assert.match(validateScheduleTiming({ enabled: true, scheduleType: 'once' }, now), /Run at is required/);
  assert.match(validateScheduleTiming({ enabled: true, scheduleType: 'daily', timezone: 'UTC' }, now), /Time is required/);
  assert.match(validateScheduleTiming({ enabled: true, scheduleType: 'weekly', timezone: 'UTC', scheduledTime: '09:00', scheduledDay: 7 }, now), /weekday/);
  assert.match(validateScheduleTiming({ enabled: true, scheduleType: 'monthly', timezone: 'UTC', scheduledTime: '09:00', scheduledDay: 0 }, now), /day of month/);
  assert.match(validateScheduleTiming({ enabled: true, scheduleType: 'cron', timezone: 'UTC', cronExpression: 'not cron' }, now), /cron expression/);
  assert.equal(validateScheduleTiming({ enabled: false, scheduleType: 'once' }, now), null);
  assert.equal(validateScheduleTiming({ enabled: true, scheduleType: 'weekly', timezone: 'UTC', scheduledTime: '09:00', scheduledDay: 0 }, now), null);
});

test('only an actually consumed successful Once suppresses the missing-next-run warning', () => {
  const due = '2035-01-01T12:00:00.000Z';
  const completedAt = '2035-01-01T12:00:02.000Z';
  const once = { scheduleType: 'once', runAt: due, lastRunAt: completedAt, lastRunStatus: 'completed_no_op' };
  assert.equal(isConsumedOnceSchedule(once), true);
  assert.equal(isConsumedOnceSchedule({ ...once, lastRunStatus: 'success' }), true);
  assert.equal(isConsumedOnceSchedule({ ...once, lastRunAt: due }), true);
  for (const changed of [
    { scheduleType: 'daily' }, { runAt: null }, { runAt: 'invalid' },
    { runAt: '2036-01-01T12:00:00.000Z' }, { lastRunAt: null },
    { lastRunAt: 'invalid' }, { lastRunStatus: null }, { lastRunStatus: 'error' },
  ]) assert.equal(isConsumedOnceSchedule({ ...once, ...changed }), false);
});
