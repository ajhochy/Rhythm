import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { RecurrenceService } from '../services/recurrence_service';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('Recurring rules and recurrence generation', () => {
  let usersRepo: UsersRepository;
  let rulesRepo: RecurringTaskRulesRepository;
  let tasksRepo: TasksRepository;
  let service: RecurrenceService;
  let ownerId: number;
  let assigneeId: number;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
    rulesRepo = new RecurringTaskRulesRepository();
    tasksRepo = new TasksRepository();
    service = new RecurrenceService();
    ownerId = usersRepo.create({ name: 'Alice', email: 'alice@example.com' }).id;
    assigneeId = usersRepo.create({ name: 'Bob', email: 'bob@example.com' }).id;
  });

  it('persists workflow steps on recurring rules', () => {
    const rule = rulesRepo.create({
      title: 'Weekly workflow',
      frequency: 'weekly',
      dayOfWeek: 1,
      ownerId,
      steps: [
        { id: 'prep', title: 'Prep', assigneeId: ownerId },
        { id: 'lead', title: 'Lead', assigneeId },
      ],
    });

    const reloaded = rulesRepo.findById(rule.id);
    expect(reloaded.steps).toHaveLength(2);
    expect(reloaded.steps.map((step) => step.title)).toEqual(['Prep', 'Lead']);
    expect(reloaded.steps[0].assigneeId).toBe(ownerId);
    expect(reloaded.steps[1].assigneeId).toBe(assigneeId);
  });

  it('generates one task per step per recurrence date and preserves legacy rules', async () => {
    const stepRule = rulesRepo.create({
      title: 'Weekly workflow',
      frequency: 'weekly',
      dayOfWeek: 1,
      ownerId,
      steps: [
        { id: 'prep', title: 'Prep', assigneeId: ownerId },
        { id: 'lead', title: 'Lead', assigneeId: assigneeId },
      ],
    });

    const legacyRule = rulesRepo.create({
      title: 'Legacy rhythm',
      frequency: 'weekly',
      dayOfWeek: 1,
      ownerId,
    });

    const from = new Date('2026-03-23T00:00:00.000Z');
    const to = new Date('2026-03-23T23:59:59.999Z');

    await service.generateInstances(stepRule, from, to);
    await service.generateInstances(legacyRule, from, to);

    const generated = tasksRepo.findAll().filter((task) => task.sourceType === 'recurring_rule');
    expect(generated).toHaveLength(3);
    expect(generated.map((task) => task.title).sort()).toEqual([
      'Lead',
      'Legacy rhythm',
      'Prep',
    ]);
    expect(
      generated.find((task) => task.title === 'Prep')?.sourceId,
    ).toBe(`${stepRule.id}:prep`);
    expect(
      generated.find((task) => task.title === 'Lead')?.sourceId,
    ).toBe(`${stepRule.id}:lead`);
    expect(
      generated.find((task) => task.title === 'Legacy rhythm')?.sourceId,
    ).toBe(legacyRule.id);
    expect(
      generated.find((task) => task.title === 'Prep')?.ownerId,
    ).toBe(ownerId);
    expect(
      generated.find((task) => task.title === 'Lead')?.ownerId,
    ).toBe(assigneeId);
  });
});
