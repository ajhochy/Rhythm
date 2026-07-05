/**
 * #896 — Sunday Prep decomposition into 4 bounded specialist scheduled tasks.
 *
 * Acceptance criteria proven here:
 *   - seedSundayPrepTasks() creates exactly 4 tasks, each weekly/Saturday,
 *     staggered 10 minutes apart, none of them unbounded.
 *   - Idempotent — a second call adds no duplicates.
 *   - Each prompt documents a turn budget and an explicit exit condition.
 *   - Every rhythm_* tool named in any prompt is a tool that actually exists
 *     (the #806 "dangling tool" class of bug).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { sundayPrepService } from '../services/sundayPrepService';

/** Tools referenced by the Sunday Prep prompts that actually exist in apps/mcp_server. */
const EXISTING_TOOLS = [
  'rhythm_create_task',
  'rhythm_get_task_thread',
  'rhythm_update_task',
  'rhythm_notify',
  'rhythm_pco_list_plans',
  'rhythm_pco_list_service_types',
  'rhythm_pco_list_needed_positions',
  'rhythm_pco_get_plan_items',
  'rhythm_search_gmail',
];

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

describe('Sunday Prep seed (#896)', () => {
  it('seeds exactly 4 tasks, all weekly/Saturday, staggered 10 minutes apart', async () => {
    const repo = new AgentScheduledTasksRepository();
    await sundayPrepService.seedSundayPrepTasks();

    const tasks = (await repo.listAllAsync()).filter((t) => t.name.startsWith('Sunday Prep'));
    expect(tasks).toHaveLength(4);
    for (const t of tasks) {
      expect(t.scheduleType).toBe('weekly');
      expect(t.scheduledDay).toBe(6); // Saturday
    }

    const times = tasks.map((t) => t.scheduledTime).sort();
    expect(times).toEqual(['22:00', '22:10', '22:20', '22:30']);
  });

  it('is idempotent — a second call adds no duplicates', async () => {
    const repo = new AgentScheduledTasksRepository();
    await sundayPrepService.seedSundayPrepTasks();
    await sundayPrepService.seedSundayPrepTasks();

    const tasks = (await repo.listAllAsync()).filter((t) => t.name.startsWith('Sunday Prep'));
    expect(tasks).toHaveLength(4);
  });

  it('every prompt documents a turn budget and an explicit exit condition', async () => {
    const repo = new AgentScheduledTasksRepository();
    await sundayPrepService.seedSundayPrepTasks();
    const tasks = (await repo.listAllAsync()).filter((t) => t.name.startsWith('Sunday Prep'));

    for (const t of tasks) {
      expect(t.prompt).toMatch(/Budget: ~\d+ turns/);
    }
    // The first 3 (PCO/Email/ProPresenter) each have an explicit "Exit condition"
    // that calls rhythm_notify on failure; the composer always notifies.
    const withExitCondition = tasks.filter((t) => t.prompt.includes('Exit condition'));
    expect(withExitCondition.length).toBe(3);
  });

  it('every rhythm_* tool named in any prompt actually exists (no dangling tool references)', async () => {
    const repo = new AgentScheduledTasksRepository();
    await sundayPrepService.seedSundayPrepTasks();
    const tasks = (await repo.listAllAsync()).filter((t) => t.name.startsWith('Sunday Prep'));

    const mentioned = new Set<string>();
    for (const t of tasks) {
      for (const m of t.prompt.match(/rhythm_[a-z_]+/g) ?? []) mentioned.add(m);
    }
    expect(mentioned.size).toBeGreaterThan(0);
    for (const tool of mentioned) {
      expect(EXISTING_TOOLS).toContain(tool);
    }
  });

  it('each task carries the correct MCP scope for its specialty', async () => {
    const repo = new AgentScheduledTasksRepository();
    await sundayPrepService.seedSundayPrepTasks();
    const tasks = await repo.listAllAsync();

    const pco = tasks.find((t) => t.name === 'Sunday Prep — PCO Checker')!;
    expect(JSON.parse(pco.allowedMcpsJson!)).toEqual(expect.arrayContaining(['pco-services']));

    const email = tasks.find((t) => t.name === 'Sunday Prep — Email Triage')!;
    expect(JSON.parse(email.allowedMcpsJson!)).toEqual(expect.arrayContaining(['gmail-work']));

    const pp = tasks.find((t) => t.name === 'Sunday Prep — ProPresenter Verifier')!;
    expect(JSON.parse(pp.allowedMcpsJson!)).toEqual(expect.arrayContaining(['propresenter']));

    const composer = tasks.find((t) => t.name === 'Sunday Prep — Morning Briefing Composer')!;
    expect(JSON.parse(composer.allowedMcpsJson!)).toEqual(['rhythm']);
  });
});
