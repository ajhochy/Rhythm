import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import type { RecurringTaskRule } from '../models/recurring_task_rule';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import { RecurrenceService } from './recurrence_service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testOwnerId: number;

function makeRule(overrides: Partial<RecurringTaskRule> = {}): RecurringTaskRule {
  return {
    id: 'rule-1',
    title: 'Test Rhythm',
    frequency: 'weekly',
    dayOfWeek: 1, // Monday
    dayOfMonth: null,
    month: null,
    enabled: true,
    sequential: false,
    ownerId: testOwnerId,
    steps: [],
    collaborators: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  // Create a real user so that tasks can satisfy the FK constraint on owner_id.
  const usersRepo = new UsersRepository();
  const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
  testOwnerId = user.id;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecurrenceService', () => {
  const service = new RecurrenceService();

  // -------------------------------------------------------------------------
  // 0-step rhythms — backward-compatibility
  // -------------------------------------------------------------------------

  describe('0-step rhythm (legacy / no steps)', () => {
    test('weekly: produces one task per week on the specified day of week', async () => {
      const rule = makeRule({ frequency: 'weekly', dayOfWeek: 3 }); // Wednesday
      // 2026-05-04 (Mon) → 2026-05-18 (Mon) — should hit Wed May 6 and Wed May 13
      const from = new Date('2026-05-04T00:00:00Z');
      const to = new Date('2026-05-18T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].dueDate).toBe('2026-05-06');
      expect(tasks[1].dueDate).toBe('2026-05-13');
    });

    test('monthly: produces one task per month on the specified day', async () => {
      const rule = makeRule({ frequency: 'monthly', dayOfMonth: 15 });
      const from = new Date('2026-05-01T00:00:00Z');
      const to = new Date('2026-06-30T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].dueDate).toBe('2026-05-15');
      expect(tasks[1].dueDate).toBe('2026-06-15');
    });

    test('annual: produces one task per year on the specified date', async () => {
      const rule = makeRule({ frequency: 'annual', month: 3, dayOfMonth: 10 });
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2027-12-31T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].dueDate).toBe('2026-03-10');
      expect(tasks[1].dueDate).toBe('2027-03-10');
    });

    test('idempotent: repeated calls produce no duplicates', async () => {
      const rule = makeRule({ frequency: 'weekly', dayOfWeek: 1 });
      const from = new Date('2026-05-04T00:00:00Z');
      const to = new Date('2026-05-10T23:59:59Z');

      const first = await service.generateInstances(rule, from, to);
      expect(first).toHaveLength(1);

      const second = await service.generateInstances(rule, from, to);
      expect(second).toHaveLength(0); // already exists — skip

      // Verify only one task exists in the DB by calling findAllAsync with the real owner id.
      const tasksRepo = new TasksRepository();
      const all = await tasksRepo.findAllAsync(testOwnerId);
      expect(all).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Weekly per-step
  // -------------------------------------------------------------------------

  describe('weekly rhythm with steps (Mon / Wed / Fri)', () => {
    function makeWeeklyRule(): RecurringTaskRule {
      return makeRule({
        frequency: 'weekly',
        dayOfWeek: 1, // rhythm-level fallback
        steps: [
          { id: 'step-1', title: 'Monday Task', assigneeId: null, dayOfWeek: 1 },
          { id: 'step-2', title: 'Wednesday Task', assigneeId: null, dayOfWeek: 3 },
          { id: 'step-3', title: 'Friday Task', assigneeId: null, dayOfWeek: 5 },
        ],
      });
    }

    test('generates 3 tasks per week with correct individual due dates', async () => {
      const rule = makeWeeklyRule();
      // One week: Mon 2026-05-04 → Sun 2026-05-10
      const from = new Date('2026-05-04T00:00:00Z');
      const to = new Date('2026-05-10T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(3);

      const dueDates = tasks.map((t) => t.dueDate).sort();
      expect(dueDates).toEqual(['2026-05-04', '2026-05-06', '2026-05-08']);
    });

    test('generates 6 tasks over two weeks', async () => {
      const rule = makeWeeklyRule();
      const from = new Date('2026-05-04T00:00:00Z');
      const to = new Date('2026-05-17T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(6);
    });

    test('idempotent: second call within same window creates nothing new', async () => {
      const rule = makeWeeklyRule();
      const from = new Date('2026-05-04T00:00:00Z');
      const to = new Date('2026-05-10T23:59:59Z');

      await service.generateInstances(rule, from, to);
      const second = await service.generateInstances(rule, from, to);
      expect(second).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Monthly per-step
  // -------------------------------------------------------------------------

  describe('monthly rhythm with steps (day 5, day 20)', () => {
    function makeMonthlyRule(): RecurringTaskRule {
      return makeRule({
        frequency: 'monthly',
        dayOfMonth: 1, // rhythm-level fallback
        steps: [
          { id: 'step-1', title: 'Early Month', assigneeId: null, dayOfMonth: 5 },
          { id: 'step-2', title: 'Late Month', assigneeId: null, dayOfMonth: 20 },
        ],
      });
    }

    test('generates 2 tasks per month with correct dates', async () => {
      const rule = makeMonthlyRule();
      const from = new Date('2026-05-01T00:00:00Z');
      const to = new Date('2026-05-31T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(2);

      const dueDates = tasks.map((t) => t.dueDate).sort();
      expect(dueDates).toEqual(['2026-05-05', '2026-05-20']);
    });

    test('generates 4 tasks over two months', async () => {
      const rule = makeMonthlyRule();
      const from = new Date('2026-05-01T00:00:00Z');
      const to = new Date('2026-06-30T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  // Annual per-step
  // -------------------------------------------------------------------------

  describe('annual rhythm with steps (Jan 15, Mar 1)', () => {
    function makeAnnualRule(): RecurringTaskRule {
      return makeRule({
        frequency: 'annual',
        month: 1,
        dayOfMonth: 1, // rhythm-level fallbacks
        steps: [
          { id: 'step-1', title: 'January Task', assigneeId: null, month: 1, dayOfMonth: 15 },
          { id: 'step-2', title: 'March Task', assigneeId: null, month: 3, dayOfMonth: 1 },
        ],
      });
    }

    test('generates 2 tasks per year on their respective dates', async () => {
      const rule = makeAnnualRule();
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-12-31T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(2);

      const dueDates = tasks.map((t) => t.dueDate).sort();
      expect(dueDates).toEqual(['2026-01-15', '2026-03-01']);
    });

    test('generates 4 tasks over two years', async () => {
      const rule = makeAnnualRule();
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2027-12-31T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(4);

      const dueDates = tasks.map((t) => t.dueDate).sort();
      expect(dueDates).toEqual(['2026-01-15', '2026-03-01', '2027-01-15', '2027-03-01']);
    });
  });

  // -------------------------------------------------------------------------
  // Fallback: step missing day field falls back to rhythm-level field
  // -------------------------------------------------------------------------

  describe('fallback to rhythm-level fields when step day is null', () => {
    test('weekly step with null dayOfWeek falls back to rule.dayOfWeek', async () => {
      const rule = makeRule({
        frequency: 'weekly',
        dayOfWeek: 2, // Tuesday
        steps: [
          { id: 'step-1', title: 'Fallback Step', assigneeId: null, dayOfWeek: null },
        ],
      });
      const from = new Date('2026-05-04T00:00:00Z'); // Monday
      const to = new Date('2026-05-10T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].dueDate).toBe('2026-05-05'); // Tuesday
    });

    test('monthly step with null dayOfMonth falls back to rule.dayOfMonth', async () => {
      const rule = makeRule({
        frequency: 'monthly',
        dayOfMonth: 10,
        steps: [
          { id: 'step-1', title: 'Fallback Step', assigneeId: null, dayOfMonth: null },
        ],
      });
      const from = new Date('2026-05-01T00:00:00Z');
      const to = new Date('2026-05-31T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].dueDate).toBe('2026-05-10');
    });

    test('annual step with null month/dayOfMonth falls back to rule-level fields', async () => {
      const rule = makeRule({
        frequency: 'annual',
        month: 6,
        dayOfMonth: 21,
        steps: [
          { id: 'step-1', title: 'Fallback Step', assigneeId: null, month: null, dayOfMonth: null },
        ],
      });
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-12-31T23:59:59Z');

      const tasks = await service.generateInstances(rule, from, to);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].dueDate).toBe('2026-06-21');
    });
  });

  // -------------------------------------------------------------------------
  // Dates outside [from, to] are skipped
  // -------------------------------------------------------------------------

  test('step dates outside the lookahead window are not created', async () => {
    const rule = makeRule({
      frequency: 'weekly',
      dayOfWeek: 1,
      steps: [
        // Step falls on a day-of-week that is before the start of `from`
        { id: 'step-1', title: 'Past Step', assigneeId: null, dayOfWeek: 0 }, // Sunday
      ],
    });
    // from is Monday 2026-05-04, so Sunday May 3 is before the window
    const from = new Date('2026-05-04T00:00:00Z');
    const to = new Date('2026-05-10T23:59:59Z');

    const tasks = await service.generateInstances(rule, from, to);
    // Sunday May 3 is out of range; Sunday May 10 IS in range
    expect(tasks).toHaveLength(1);
    expect(tasks[0].dueDate).toBe('2026-05-10');
  });

  // -------------------------------------------------------------------------
  // Rule with no ownerId — produce nothing
  // -------------------------------------------------------------------------

  test('returns empty array when rule has no ownerId', async () => {
    const rule = makeRule({ ownerId: null });
    const tasks = await service.generateInstances(
      rule,
      new Date('2026-05-04T00:00:00Z'),
      new Date('2026-05-10T23:59:59Z'),
    );
    expect(tasks).toHaveLength(0);
  });
});
