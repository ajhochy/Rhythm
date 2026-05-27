/**
 * Contract tests for issue #48 — Refine PCO automation rule editor UX
 *
 * Covers the SEMANTIC backend changes (highest regression risk):
 *   c1 — triggerConfig.triggerKeys multi-value: rule fires for BOTH A and B
 *   c2 — actionConfig.targetDayOfWeek=4 with a Sunday service date → due on Thursday of same week
 *   c3 — backward-compat: old rule with only scalar trigger_key (no triggerKeys list) still fires
 *
 * Tests must FAIL before implementation and PASS after.
 * Run: cd apps/api_server && npx vitest run src/__tests__/issue_48_contract.test.ts
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import type { AutomationSignal } from '../models/automation_signal';
import { AutomationRulesRepository } from '../repositories/automation_rules_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import { AutomationEngineService } from '../services/automation_engine_service';

function makeSignal(
  overrides: Partial<AutomationSignal> & {
    signalType: string;
    provider: string;
    planDate?: string;
  },
): AutomationSignal {
  const { planDate, ...rest } = overrides;
  const base: AutomationSignal = {
    id: 'sig-test',
    externalId: 'ext-1',
    dedupeKey: `${overrides.provider}:${overrides.signalType}:ext-1`,
    occurredAt: '2026-05-25T12:00:00.000Z',
    syncedAt: '2026-05-25T12:00:00.000Z',
    sourceAccountId: null,
    sourceLabel: 'test',
    payload: {
      title: 'Sunday Worship',
      planDate: planDate ?? null,
      teamId: 'team-a',
      teamName: 'Worship',
      positionName: 'Vocals',
      daysUntil: 5,
    },
    createdAt: '2026-05-25T12:00:00.000Z',
    updatedAt: '2026-05-25T12:00:00.000Z',
    ...rest,
  };
  return base;
}

describe('issue-48 — automation engine contract', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
  });

  // -------------------------------------------------------------------
  // c1: triggerConfig.triggerKeys multi-value fires for BOTH signal types
  // -------------------------------------------------------------------
  test('issue-48-c1: triggerKeys multi-value fires for both trigger types', async () => {
    const usersRepo = new UsersRepository();
    const rulesRepo = new AutomationRulesRepository();
    const tasksRepo = new TasksRepository();
    const engine = new AutomationEngineService();

    const owner = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });

    // Rule uses multi-trigger: plan_upcoming OR plan_published
    const rule = rulesRepo.create({
      name: 'Multi-trigger rule',
      source: 'planning_center',
      triggerKey: 'planning_center.plan_upcoming', // scalar kept for backward-compat
      triggerConfig: {
        triggerKeys: [
          'planning_center.plan_upcoming',
          'planning_center.plan_published',
        ],
      },
      actionType: 'create_task',
      actionConfig: { titleTemplate: 'Task for {{title}}' },
      ownerId: owner.id,
    });

    // Signal A: plan_upcoming — should match
    const signalA = makeSignal({
      id: 'sig-a',
      provider: 'planning_center',
      signalType: 'plan_upcoming',
      dedupeKey: 'planning_center:plan_upcoming:sig-a',
    });

    // Signal B: plan_published — should also match (different signal type, same rule)
    const signalB = makeSignal({
      id: 'sig-b',
      provider: 'planning_center',
      signalType: 'plan_published',
      dedupeKey: 'planning_center:plan_published:sig-b',
    });

    // Signal C: service_item_updated — should NOT match (not in triggerKeys)
    const signalC = makeSignal({
      id: 'sig-c',
      provider: 'planning_center',
      signalType: 'service_item_updated',
      dedupeKey: 'planning_center:service_item_updated:sig-c',
    });

    const result = await engine.evaluateSignals('planning_center', [
      signalA,
      signalB,
      signalC,
    ]);

    expect(result.matchedRules).toBe(1);
    expect(result.executedActions).toBe(2); // A and B matched, C did not
    expect(result.matchesByRuleId[rule.id]).toBe(2);

    const tasks = tasksRepo.findAll(owner.id);
    expect(tasks).toHaveLength(2);
  });

  // -------------------------------------------------------------------
  // c2: targetDayOfWeek=4 with a Sunday service date → Thursday of same week
  //
  // ISO weekday mapping in scheduleToWeekdayInSameWeek:
  //   1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
  //
  // planDate '2026-05-31' is a Sunday (getUTCDay()=0, mapped to ISO 7).
  // targetDayOfWeek=4 → Thursday → '2026-05-28' (4 days before Sunday in same ISO week).
  // -------------------------------------------------------------------
  test('issue-48-c2: targetDayOfWeek=4 with Sunday service date yields Thursday of same service week', async () => {
    const usersRepo = new UsersRepository();
    const rulesRepo = new AutomationRulesRepository();
    const tasksRepo = new TasksRepository();
    const engine = new AutomationEngineService();

    const owner = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });

    rulesRepo.create({
      name: 'Thursday due rule',
      source: 'planning_center',
      triggerKey: 'planning_center.plan_upcoming',
      triggerConfig: {},
      actionType: 'create_task',
      actionConfig: {
        titleTemplate: 'Prep for {{title}}',
        targetDayOfWeek: 4, // Thursday (ISO)
      },
      ownerId: owner.id,
    });

    // 2026-05-31 is a Sunday
    const signal = makeSignal({
      provider: 'planning_center',
      signalType: 'plan_upcoming',
      planDate: '2026-05-31',
      payload: {
        title: 'Sunday Worship',
        planDate: '2026-05-31',
        daysUntil: 6,
      },
    });

    await engine.evaluateSignals('planning_center', [signal]);

    const tasks = tasksRepo.findAll(owner.id);
    expect(tasks).toHaveLength(1);

    // Thursday of the week containing Sunday 2026-05-31 is 2026-05-28
    expect(tasks[0]?.scheduledDate).toBe('2026-05-28');
  });

  // -------------------------------------------------------------------
  // c3: backward-compat — old rule with only scalar trigger_key still fires
  // -------------------------------------------------------------------
  test('issue-48-c3: scalar trigger_key backward-compat still fires', async () => {
    const usersRepo = new UsersRepository();
    const rulesRepo = new AutomationRulesRepository();
    const tasksRepo = new TasksRepository();
    const engine = new AutomationEngineService();

    const owner = usersRepo.create({ name: 'Carol', email: 'carol@example.com' });

    // Old-style rule: no triggerConfig.triggerKeys — only the scalar trigger_key column
    rulesRepo.create({
      name: 'Legacy rule',
      source: 'planning_center',
      triggerKey: 'planning_center.plan_upcoming',
      triggerConfig: {}, // no triggerKeys array at all
      actionType: 'create_task',
      actionConfig: { titleTemplate: 'Legacy task for {{title}}' },
      ownerId: owner.id,
    });

    const signal = makeSignal({
      provider: 'planning_center',
      signalType: 'plan_upcoming',
    });

    const result = await engine.evaluateSignals('planning_center', [signal]);

    expect(result.matchedRules).toBe(1);
    expect(result.executedActions).toBe(1);

    const tasks = tasksRepo.findAll(owner.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('Legacy task for Sunday Worship');
  });
});
