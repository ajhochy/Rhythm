import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { ProjectTemplatesRepository } from '../repositories/project_templates_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import { ProjectGenerationService } from './project_generation_service';
import { RhythmSignalGeneratorService } from './rhythm_signal_generator_service';

describe('RhythmSignalGeneratorService', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('generateTaskDueSignals returns signals for open tasks within lookahead window', () => {
    const tasksRepo = new TasksRepository();
    const generator = new RhythmSignalGeneratorService();

    tasksRepo.create({ title: 'Due today', dueDate: '2026-04-01' });
    tasksRepo.create({ title: 'Due in 3 days', dueDate: '2026-04-04' });
    tasksRepo.create({ title: 'Due in 8 days', dueDate: '2026-04-09' });

    const signals = generator.generateTaskDueSignals(7);

    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.payload.title)).toEqual(
      expect.arrayContaining(['Due today', 'Due in 3 days']),
    );
    expect(signals.every((s) => s.signalType === 'task_due')).toBe(true);
    expect(signals.every((s) => s.provider === 'rhythm')).toBe(true);
  });

  test('generateTaskDueSignals excludes completed tasks', () => {
    const tasksRepo = new TasksRepository();
    const generator = new RhythmSignalGeneratorService();

    const task = tasksRepo.create({ title: 'Done task', dueDate: '2026-04-02' });
    tasksRepo.update(task.id, { status: 'done' });

    const signals = generator.generateTaskDueSignals(7);
    expect(signals).toHaveLength(0);
  });

  test('generateProjectStepDueSignals returns signals for open steps within lookahead', () => {
    const templatesRepo = new ProjectTemplatesRepository();
    const genService = new ProjectGenerationService();
    const generator = new RhythmSignalGeneratorService();
    const owner = new UsersRepository().create({
      name: 'Owner',
      email: 'owner@example.com',
    });

    const template = templatesRepo.create({
      name: 'Easter',
      anchorType: 'date',
      ownerId: owner.id,
    });
    templatesRepo.addStep(template.id, {
      title: 'Print bulletins',
      offsetDays: -3,
      sortOrder: 0,
    });
    templatesRepo.addStep(template.id, {
      title: 'Far future step',
      offsetDays: 30,
      sortOrder: 1,
    });
    genService.generate(template.id, '2026-04-04', 'Easter 2026', owner.id);

    const signals = generator.generateProjectStepDueSignals(7);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.payload.title).toBe('Print bulletins');
    expect(signals[0]?.signalType).toBe('project_step_due');
  });

  test('daysUntilDue payload is correct', () => {
    const tasksRepo = new TasksRepository();
    const generator = new RhythmSignalGeneratorService();

    tasksRepo.create({ title: 'Three days out', dueDate: '2026-04-04' });

    const signals = generator.generateTaskDueSignals(7);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.payload.daysUntilDue).toBe(3);
  });
});
