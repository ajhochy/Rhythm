/**
 * #904 — Background loops: activity log per scheduled task run.
 *
 * Criteria covered:
 *   - GET /agent-sessions?scheduledTaskId=<id> returns only that task's runs
 *     (is_system=1 rows, normally excluded from the default list), most
 *     recent first.
 *   - AgentRunner records a preview of what a run actually did
 *     (last_preview) on both success and failure, not just run/no-run status.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const {
  mockCreateSession,
  mockPrompt,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    abortSession: vi.fn().mockResolvedValue(true),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedScheduledTask(id: string) {
  getDb()
    .prepare(`INSERT INTO agent_scheduled_tasks (id, name, prompt) VALUES (?, ?, ?)`)
    .run(id, `Task ${id}`, 'do the thing');
}

describe('#904 — GET /agent-sessions?scheduledTaskId=', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    setDb(makeDb());
    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Test', email: 'test@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}` };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('returns only the given scheduled task\'s runs, excluded from the default list', async () => {
    seedScheduledTask('sched-1');
    const repo = new AgentSessionsRepository();
    const run1 = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'Run 1',
      scheduledTaskId: 'sched-1',
      isSystem: true,
    });

    const filtered = await fetch(
      `${baseUrl}/agent-sessions?scheduledTaskId=sched-1`,
      { headers: authHeaders },
    );
    expect(filtered.status).toBe(200);
    const filteredBody = (await filtered.json()) as { sessions: Array<{ id: string }> };
    expect(filteredBody.sessions.map((s) => s.id)).toEqual([run1.id]);

    const defaultList = await fetch(`${baseUrl}/agent-sessions`, {
      headers: authHeaders,
    });
    const defaultBody = (await defaultList.json()) as { sessions: unknown[] };
    expect(defaultBody.sessions).toEqual([]);
  });

  it('returns an empty array for a scheduled task with no runs', async () => {
    seedScheduledTask('sched-empty');
    const res = await fetch(
      `${baseUrl}/agent-sessions?scheduledTaskId=sched-empty`,
      { headers: authHeaders },
    );
    const body = (await res.json()) as { sessions: unknown[] };
    expect(body.sessions).toEqual([]);
  });
});

describe('#904 — AgentRunner records a preview of what happened', () => {
  beforeEach(() => {
    setDb(makeDb());
    vi.clearAllMocks();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records the assistant output as last_preview on success', async () => {
    mockPrompt.mockResolvedValue({
      info: { sessionID: 'sdk-session-1' },
      parts: [{ type: 'text', text: 'Staffing complete, no gaps found.' }],
    });

    const { run } = await import('../services/agent_runner');
    const result = await run({ prompt: 'Check staffing' });
    expect(result.status).toBe('done');

    const repo = new AgentSessionsRepository();
    const session = repo.findById(result.sessionId);
    expect(session?.lastPreview).toContain('Staffing complete');
  });

  it('records the error reason as last_preview on timeout', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '50';
    mockPrompt.mockReturnValue(new Promise(() => {}));

    const { run } = await import('../services/agent_runner');
    const result = await run({ prompt: 'Check staffing' });
    expect(result.status).toBe('error');

    const repo = new AgentSessionsRepository();
    const session = repo.findById(result.sessionId);
    expect(session?.lastPreview).toMatch(/timed out/i);

    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });
});
