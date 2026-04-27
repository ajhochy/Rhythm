import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { RecurrenceService } from '../services/recurrence_service';
import { runRecurrenceGenerationOnce } from '../jobs/recurrence_generation_job';

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

    const generated = tasksRepo
      .findAllIncludingLegacy()
      .filter((task) => task.sourceType === 'recurring_rule');
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

  it('does not generate tasks from null-owned legacy recurring rules', async () => {
    const legacyRule = rulesRepo.create({
      title: 'Legacy null-owned rhythm',
      frequency: 'weekly',
      dayOfWeek: 1,
      ownerId: null,
      steps: [
        { id: 'assigned', title: 'Assigned legacy step', assigneeId },
      ],
    });

    const from = new Date('2026-03-23T00:00:00.000Z');
    const to = new Date('2026-03-23T23:59:59.999Z');

    const created = await service.generateInstances(legacyRule, from, to);

    expect(created).toHaveLength(0);
    expect(tasksRepo.findAllIncludingLegacy()).toHaveLength(0);
  });

  it('only returns enabled owned rules for background generation', async () => {
    const ownedRule = rulesRepo.create({
      title: 'Owned rhythm',
      frequency: 'weekly',
      dayOfWeek: 1,
      ownerId,
    });
    rulesRepo.create({
      title: 'Legacy null-owned rhythm',
      frequency: 'weekly',
      dayOfWeek: 1,
      ownerId: null,
    });
    rulesRepo.create({
      title: 'Disabled owned rhythm',
      frequency: 'weekly',
      dayOfWeek: 1,
      ownerId,
      enabled: false,
    });

    expect(
      rulesRepo.findEnabledForGeneration().map((rule) => rule.id),
    ).toEqual([ownedRule.id]);
    expect(rulesRepo.findAllIncludingLegacy()).toHaveLength(3);
  });

  it('background recurrence generation skips null-owned legacy rules and generates owned rules', async () => {
    const ownedRule = rulesRepo.create({
      title: 'Owned rhythm',
      frequency: 'weekly',
      dayOfWeek: 1,
      ownerId,
    });
    rulesRepo.create({
      title: 'Legacy null-owned rhythm',
      frequency: 'weekly',
      dayOfWeek: 1,
      ownerId: null,
      steps: [
        { id: 'assigned', title: 'Assigned legacy step', assigneeId },
      ],
    });

    const result = await runRecurrenceGenerationOnce(
      new Date('2026-03-23T00:00:00.000Z'),
      new Date('2026-03-23T23:59:59.999Z'),
    );

    const generated = tasksRepo
      .findAllIncludingLegacy()
      .filter((task) => task.sourceType === 'recurring_rule');
    expect(result).toEqual({ ruleCount: 1, createdCount: 1 });
    expect(generated).toHaveLength(1);
    expect(generated[0].sourceId).toBe(ownedRule.id);
    expect(generated[0].ownerId).toBe(ownerId);
  });
});
