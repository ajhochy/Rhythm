/**
 * Acceptance-contract tests for issue #653 (server-side)
 * "Redesign: model-pick-first trigger bubble + composer prefill — eliminate __pending__ sessions"
 *
 * SERVER CONTRACT — only c1 and c2 are server-side:
 *   c1: POST /agent-sessions rejects requests where agentId === '__pending__'
 *       OR where agentId is null/empty (400 BadRequest). No code path can
 *       produce a __pending__ session anymore.
 *   c2: POST /agent-sessions with a valid agentId does NOT auto-seed a
 *       role='system' task-context message. The new design moves task context
 *       to a client-side composer prefill instead — the server should leave
 *       the transcript empty at insert time so what the user actually sends
 *       is the canonical first turn.
 *
 * Tests MUST FAIL on the current `agent_sessions_controller.ts` (which both
 * accepts null agentId and seeds a system message per #629) and PASS after
 * the redesign lands.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { startTestServer } from './helpers/real_server';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { TasksRepository } from '../repositories/tasks_repository';

// ---------------------------------------------------------------------------
// Mocks — match the #629 contract test mocks so the controller's opencode
// path is non-fatal during session creation.
// ---------------------------------------------------------------------------
const { promptAsyncSpy } = vi.hoisted(() => ({
  promptAsyncSpy: vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/opencode_engine', () => {
  let _ready = true;
  const mockClient = {
    get isReady() {
      return _ready;
    },
    set isReady(v: boolean) {
      _ready = v;
    },
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-653' }),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: promptAsyncSpy,
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    ensureReady: vi.fn().mockImplementation(async () => true),
  };
  return {
    opencodeClient: mockClient,
    opencodeSessionMap: new Map<string, string>(),
  };
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

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('agent_sessions_controller — issue #653: eliminate __pending__ sessions', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;
  let taskId: string;
  const TASK_TITLE = 'Add Annette Rip and Nate Rip to worship rotation';
  const TASK_NOTES = 'Use PCO MCP server to accomplish this task.';

  beforeEach(async () => {
    promptAsyncSpy.mockClear();
    setDb(makeDb());

    const user = new UsersRepository().create({
      name: 'Test',
      email: 'test653@example.com',
    });
    const authSession = await new SessionsRepository().createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${authSession.token}`,
      'Content-Type': 'application/json',
    };

    const task = new TasksRepository().create({
      title: TASK_TITLE,
      notes: TASK_NOTES,
      ownerId: user.id,
      status: 'open',
    });
    taskId = task.id;

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // c1 — POST /agent-sessions rejects '__pending__' sentinel.
  //
  // History: the #653 fix rejected agentId=null and agentId='' as well.
  // Issue #710 (instant new session) superseded that requirement:
  // null/empty agentId is now valid (creates an agent-less placeholder
  // session) so the client can open it immediately and configure the
  // agent later.  Only '__pending__' (the old ORM sentinel) is still
  // rejected with 400.
  // -------------------------------------------------------------------------

  it(
    'issue-653-c1a (updated for #710): POST accepts agentId=null and creates a placeholder session',
    async () => {
      const res = await fetch(`${baseUrl}/agent-sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          agentId: null,
          cwd: '/tmp',
          name: '',
          taskId,
        }),
      });
      // #710: null agentId is now valid — instant-create returns 201.
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id?: string };
      expect(typeof body.id).toBe('string');
    },
  );

  it("issue-653-c1b: POST rejects agentId='__pending__' with 400", async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: '__pending__',
        cwd: '/tmp',
        name: 'should-reject-pending',
        taskId,
      }),
    });
    expect(res.status).toBe(400);
  });

  it(
    'issue-653-c1c (updated for #710): POST accepts empty string agentId as instant-create',
    async () => {
      const res = await fetch(`${baseUrl}/agent-sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          agentId: '',
          cwd: '/tmp',
          name: '',
          taskId,
        }),
      });
      // #710: empty agentId is now valid — instant-create returns 201.
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id?: string };
      expect(typeof body.id).toBe('string');
    },
  );

  // -------------------------------------------------------------------------
  // c2 — New sessions have NO auto-seeded system message.
  //
  // FAILS today: per #629, the controller appends a 'system' role message
  // with "Task context\nTitle: <title>\n\n<notes>" after insert. GET
  // /agent-sessions/:id/messages returns at least 1 system message.
  //
  // PASSES after fix: the #629 seeding block is removed. GET messages
  // returns []. Task context is added client-side as a composer draft
  // instead.
  // -------------------------------------------------------------------------

  it(
    'issue-653-c2: new session with valid agentId has zero auto-seeded ' +
      'system messages (#629 backend path is removed)',
    async () => {
      const res = await fetch(`${baseUrl}/agent-sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          agentId: 'claude-code',
          cwd: '/tmp',
          name: 'session-with-real-agent',
          taskId,
        }),
      });

      // The session must be created successfully (no pending rejection).
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      const sessionId = body.id;

      const msgsRes = await fetch(
        `${baseUrl}/agent-sessions/${sessionId}/messages`,
        { headers: authHeaders },
      );
      expect(msgsRes.status).toBe(200);
      const { messages } = (await msgsRes.json()) as {
        messages: Array<{ role: string; strippedText: string }>;
      };

      const systemMsgs = messages.filter((m) => m.role === 'system');
      expect(systemMsgs).toHaveLength(0);
      // And specifically the #629 task-context content must not be present.
      const hasTaskContext = messages.some((m) =>
        m.strippedText.includes(TASK_TITLE),
      );
      expect(hasTaskContext).toBe(false);
    },
  );

  it(
    'issue-653-c2-prompt: promptAsync is NOT called with an auto-generated ' +
      '"I need help with:" initial prompt — that path is removed',
    async () => {
      promptAsyncSpy.mockClear();

      await fetch(`${baseUrl}/agent-sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          agentId: 'claude-code',
          cwd: '/tmp',
          name: 'no-auto-prompt',
          taskTitle: TASK_TITLE,
        }),
      });

      // Inspect every call's first prompt arg (varies by signature; check all).
      const autoPromptCalls = promptAsyncSpy.mock.calls.filter((args) => {
        const flat = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        return flat.includes('I need help with:');
      });
      expect(autoPromptCalls).toHaveLength(0);
    },
  );
});
