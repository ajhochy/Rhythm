/**
 * Acceptance-contract tests for issue #674
 * "Bug: Weekly Planner tasks added to a day land in backlog (POST /tasks drops scheduledDate)"
 *
 * c1: POST /tasks with { title, scheduledDate } persists scheduled_date and
 *     returns it in the response JSON (and on subsequent GET /tasks/:id).
 * c2: A task created with a scheduledDate inside a week appears in that day's
 *     column of GET /weekly-plan and NOT in the backlog.
 * c3: POST /tasks without scheduledDate still lands in the weekly-plan backlog.
 * c4: dueDate-only creation behavior is unchanged (dueDate persists,
 *     scheduledDate stays null).
 *
 * c1 and c2 MUST FAIL on the current tasks_controller.ts (create() never
 * destructures scheduledDate) and PASS after the fix.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listProviders: vi.fn().mockResolvedValue([]),
    listAuthedProviders: vi.fn().mockResolvedValue([]),
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-674' }),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    ensureReady: vi.fn().mockResolvedValue(true),
  };
  return { opencodeClient: mockClient, opencodeSessionMap: new Map<string, string>() };
});

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    dispose: vi.fn(),
    clearPendingPermission: vi.fn(),
  },
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
}));

import { createApp } from '../app';

// 2026-06-16 is the Tuesday of ISO week 2026-W25 (week starts Mon 2026-06-15).
const WEEK_LABEL = '2026-W25';
const DAY_IN_WEEK = '2026-06-16';

interface TaskJson {
  id: string;
  title: string;
  scheduledDate: string | null;
  dueDate: string | null;
}

interface WeeklyPlanJson {
  weekStart: string;
  days: Array<{ date: string; tasks: TaskJson[] }>;
  backlog: TaskJson[];
}

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('tasks_controller create — issue #674: scheduledDate round-trip', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());

    const user = new UsersRepository().create({
      name: 'Test',
      email: 'test674@example.com',
    });
    const authSession = await new SessionsRepository().createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${authSession.token}`,
      'Content-Type': 'application/json',
    };

    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    closeServer = () =>
      new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  async function createTask(body: Record<string, unknown>): Promise<TaskJson> {
    const res = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as TaskJson;
  }

  async function getPlan(): Promise<WeeklyPlanJson> {
    const res = await fetch(`${baseUrl}/weekly-plan?week=${WEEK_LABEL}`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as WeeklyPlanJson;
  }

  it('issue-674-c1: POST /tasks with scheduledDate persists and returns it', async () => {
    const created = await createTask({ title: 'X', scheduledDate: DAY_IN_WEEK });
    expect(created.scheduledDate).toBe(DAY_IN_WEEK);

    const res = await fetch(`${baseUrl}/tasks/${created.id}`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const fetched = (await res.json()) as TaskJson;
    expect(fetched.scheduledDate).toBe(DAY_IN_WEEK);
  });

  it("issue-674-c2: scheduled task appears in that day's weekly-plan column, not backlog", async () => {
    const created = await createTask({
      title: 'Planner day task',
      scheduledDate: DAY_IN_WEEK,
    });

    const plan = await getPlan();
    const day = plan.days.find((d) => d.date === DAY_IN_WEEK);
    expect(day, `weekly plan has a column for ${DAY_IN_WEEK}`).toBeDefined();
    expect(day!.tasks.map((t) => t.id)).toContain(created.id);
    expect(plan.backlog.map((t) => t.id)).not.toContain(created.id);
  });

  it('issue-674-c3: POST /tasks without scheduledDate still lands in backlog', async () => {
    const created = await createTask({ title: 'Backlog task' });
    expect(created.scheduledDate).toBeNull();

    const plan = await getPlan();
    expect(plan.backlog.map((t) => t.id)).toContain(created.id);
    for (const day of plan.days) {
      expect(day.tasks.map((t) => t.id)).not.toContain(created.id);
    }
  });

  it('issue-674-c4: dueDate-only creation behavior is unchanged', async () => {
    const created = await createTask({ title: 'Due only', dueDate: DAY_IN_WEEK });
    expect(created.dueDate).toBe(DAY_IN_WEEK);
    expect(created.scheduledDate).toBeNull();
  });
});
