/**
 * #740 backend — Cookbook run endpoint
 *
 * POST /agent-cookbook/:id/run
 *  - loads recipe, compiles prompt, calls AgentRunner.run, returns { sessionId }
 *  - unknown id → 404
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// ── Hoist mock fns so factories can reference them ────────────────────────────

const { mockAgentRun } = vi.hoisted(() => ({
  mockAgentRun: vi.fn(),
}));

// ── Mock AgentRunner so nothing real launches ─────────────────────────────────

vi.mock('../services/agent_runner', () => ({
  run: mockAgentRun,
  _activeRunCount: () => 0,
}));

// ── Mock opencode_engine (needed transitively) ────────────────────────────────

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    promptAsync: vi.fn().mockResolvedValue(true),
    abortSession: vi.fn().mockResolvedValue(true),
    listMessages: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { startTestServer } from './helpers/real_server';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('#740 — POST /agent-cookbook/:id/run (authenticated)', () => {
  let baseUrl: string;
  let authHeader: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAgentRun.mockResolvedValue({
      sessionId: 'sdk-session-run-1',
      result: 'Done',
      status: 'done',
    });

    setDb(makeDb());

    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Chef', email: 'chef@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeader = { Authorization: `Bearer ${session.token}` };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('runs a recipe and returns sessionId', async () => {
    // Create a recipe first
    const createRes = await fetch(`${baseUrl}/agent-cookbook`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Weekly Summary',
        description: 'Generate a weekly summary',
        steps: [
          { action: 'prompt', text: 'List open tasks for this week' },
          { action: 'prompt', text: 'Summarise the week' },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const recipe = (await createRes.json()) as { id: string };

    // Run the recipe
    const runRes = await fetch(`${baseUrl}/agent-cookbook/${recipe.id}/run`, {
      method: 'POST',
      headers: authHeader,
    });

    expect(runRes.status).toBe(202);
    const body = (await runRes.json()) as Record<string, unknown>;
    expect(body.sessionId).toBe('sdk-session-run-1');
    expect(body.status).toBe('done');

    // AgentRunner.run was called with a prompt that includes the recipe content
    expect(mockAgentRun).toHaveBeenCalledOnce();
    const callArgs = mockAgentRun.mock.calls[0][0] as { prompt: string; outputTarget: string };
    expect(callArgs.outputTarget).toBe('session');
    // Prompt should contain the description and/or step text
    expect(callArgs.prompt.toLowerCase()).toContain('weekly summary');
    expect(callArgs.prompt).toContain('List open tasks');
  });

  it('returns 404 for unknown recipe id', async () => {
    const res = await fetch(`${baseUrl}/agent-cookbook/nonexistent-recipe-xyz/run`, {
      method: 'POST',
      headers: authHeader,
    });
    expect(res.status).toBe(404);
    expect(mockAgentRun).not.toHaveBeenCalled();
  });

  it('builds prompt from description + steps', async () => {
    const createRes = await fetch(`${baseUrl}/agent-cookbook`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Multi-step recipe',
        description: 'Process the backlog',
        steps: ['Step A', 'Step B', 'Step C'],
      }),
    });
    const recipe = (await createRes.json()) as { id: string };

    await fetch(`${baseUrl}/agent-cookbook/${recipe.id}/run`, {
      method: 'POST',
      headers: authHeader,
    });

    const callArgs = mockAgentRun.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain('Process the backlog');
    expect(callArgs.prompt).toContain('Step A');
    expect(callArgs.prompt).toContain('Step B');
    expect(callArgs.prompt).toContain('Step C');
  });
});

describe('#740 — POST /agent-cookbook/:id/run (unauthenticated)', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let recipeId: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_LOCAL', 'false');

    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);

    const { AgentCookbookRepository } = await import('../repositories/agent_cookbook_repository');
    const cookbookRepo = new AgentCookbookRepository();
    const recipe = await cookbookRepo.createAsync({
      title: 'for-auth-test',
      description: '',
      stepsJson: '[]',
    });
    recipeId = recipe.id;

    const { createApp } = await import('../app');
    const { startTestServer } = await import('./helpers/real_server');
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    if (closeServer) await closeServer();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/agent-cookbook/${recipeId}/run`, {
      method: 'POST',
      // no auth header
    });
    expect(res.status).toBe(401);
  });
});
