import { describe, expect, it } from 'vitest';
import { computeNextRun } from '../services/agentSchedulerService';

const TZ = 'America/Los_Angeles';
const CRON = '30 6 * * 1-5';

function localWall(iso: string, timeZone = TZ): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('weekday')} ${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}

describe('computeNextRun cron timezone handling (#1089)', () => {
  it('uses PDT wall-clock time in summer', () => {
    const next = computeNextRun({
      scheduleType: 'cron',
      cronExpression: CRON,
      timezone: TZ,
      after: new Date('2026-07-02T19:00:00Z'),
    });
    expect(next).toBe('2026-07-03T13:30:00.000Z');
    expect(localWall(next!)).toBe('Fri 7/3 06:30');
  });

  it('uses PST wall-clock time in winter', () => {
    const next = computeNextRun({
      scheduleType: 'cron',
      cronExpression: CRON,
      timezone: TZ,
      after: new Date('2026-01-08T20:00:00Z'),
    });
    expect(next).toBe('2026-01-09T14:30:00.000Z');
    expect(localWall(next!)).toBe('Fri 1/9 06:30');
  });

  it('is correct immediately before spring-forward', () => {
    const next = computeNextRun({
      scheduleType: 'cron',
      cronExpression: CRON,
      timezone: TZ,
      after: new Date('2026-03-06T15:00:00Z'),
    });
    expect(next).toBe('2026-03-09T13:30:00.000Z');
    expect(localWall(next!)).toBe('Mon 3/9 06:30');
  });

  it('is correct immediately after spring-forward', () => {
    const next = computeNextRun({
      scheduleType: 'cron',
      cronExpression: CRON,
      timezone: TZ,
      after: new Date('2026-03-09T19:00:00Z'),
    });
    expect(next).toBe('2026-03-10T13:30:00.000Z');
    expect(localWall(next!)).toBe('Tue 3/10 06:30');
  });

  it('is correct immediately before fall-back', () => {
    const next = computeNextRun({
      scheduleType: 'cron',
      cronExpression: CRON,
      timezone: TZ,
      after: new Date('2026-10-30T14:00:00Z'),
    });
    expect(next).toBe('2026-11-02T14:30:00.000Z');
    expect(localWall(next!)).toBe('Mon 11/2 06:30');
  });

  it('is correct immediately after fall-back', () => {
    const next = computeNextRun({
      scheduleType: 'cron',
      cronExpression: CRON,
      timezone: TZ,
      after: new Date('2026-11-02T20:00:00Z'),
    });
    expect(next).toBe('2026-11-03T14:30:00.000Z');
    expect(localWall(next!)).toBe('Tue 11/3 06:30');
  });

  it('normalizes dow 7 to Sunday', () => {
    const next = computeNextRun({
      scheduleType: 'cron',
      cronExpression: '0 12 * * 7',
      timezone: TZ,
      after: new Date('2026-07-03T19:00:00Z'),
    });
    expect(next).toBe('2026-07-05T19:00:00.000Z');
    expect(localWall(next!)).toBe('Sun 7/5 12:00');
  });

  it('defaults cron timezone to America/Los_Angeles', () => {
    const explicit = computeNextRun({
      scheduleType: 'cron',
      cronExpression: CRON,
      timezone: TZ,
      after: new Date('2026-07-02T19:00:00Z'),
    });
    const implicit = computeNextRun({
      scheduleType: 'cron',
      cronExpression: CRON,
      after: new Date('2026-07-02T19:00:00Z'),
    });
    expect(implicit).toBe(explicit);
  });
});

describe('computeNextRun non-cron schedules unchanged (#1089 guard)', () => {
  it('keeps once behavior', () => {
    expect(computeNextRun({
      scheduleType: 'once',
      runAt: '2026-07-04T18:00:00.000Z',
      after: new Date('2026-07-02T00:00:00Z'),
    })).toBe('2026-07-04T18:00:00.000Z');

    expect(computeNextRun({
      scheduleType: 'once',
      runAt: '2026-01-01T00:00:00.000Z',
      after: new Date('2026-07-02T00:00:00Z'),
    })).toBeNull();
  });

  it('keeps daily behavior', () => {
    const next = computeNextRun({
      scheduleType: 'daily',
      scheduledTime: '09:00',
      timezone: TZ,
      after: new Date('2026-07-02T19:00:00Z'),
    });
    expect(next).not.toBeNull();
    expect(localWall(next!)).toContain('09:00');
  });

  it('keeps weekly behavior', () => {
    const next = computeNextRun({
      scheduleType: 'weekly',
      scheduledTime: '10:00',
      scheduledDay: 1,
      timezone: TZ,
      after: new Date('2026-07-02T19:00:00Z'),
    });
    expect(next).not.toBeNull();
    expect(localWall(next!)).toMatch(/^Mon .* 10:00$/);
  });

  it('keeps monthly behavior', () => {
    const next = computeNextRun({
      scheduleType: 'monthly',
      scheduledTime: '08:00',
      scheduledDay: 15,
      timezone: TZ,
      after: new Date('2026-07-02T19:00:00Z'),
    });
    expect(next).not.toBeNull();
    expect(localWall(next!)).toMatch(/^\w+ \d+\/15 08:00$/);
  });
});
