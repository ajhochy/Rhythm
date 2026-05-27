/**
 * Acceptance-contract tests for issue #629
 * "Follow-up #623: Open Chat session not linked to originating task"
 *
 * Gap: taskId is already persisted to agent_sessions.task_id (done). But no
 * system context message is written after session creation. The user opens the
 * chat from the task-ready bubble and sees an empty transcript with no
 * indication of what task they're working on.
 *
 * Fix required:
 *   In agent_sessions_controller.create(), after repo.insert(dto), if a task
 *   was found locally (or taskTitle was provided as a fallback), call:
 *     messagesRepo.append(session.id, 'system', text, text)
 *   where text is a human-readable context block:
 *     "Task context\nTitle: <title>\n\n<notes>"  (notes paragraph omitted if null)
 *
 * The system role already exists in AgentSessionMessagesRepository.append().
 * A stored 'system' message is NEVER sent to the SDK — only session.input
 * over the WS triggers an LLM turn — so this does NOT risk bug #624
 * (model-less first turn / extra promptAsync call).
 *
 * These tests MUST fail before the fix and pass after it.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

// ---------------------------------------------------------------------------
// Track promptAsync call count so we can assert it is NOT called extra times.
// Use vi.hoisted so the spy is available inside the vi.mock factory.
// ---------------------------------------------------------------------------
const { promptAsyncSpy } = vi.hoisted(() => ({
  promptAsyncSpy: vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/opencode_engine', () => {
  let _ready = true;
  const mockClient = {
    get isReady() { return _ready; },
    set isReady(v: boolean) { _ready = v; },
    listProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-629' }),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: promptAsyncSpy,
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    ensureReady: vi.fn().mockImplementation(async () => _ready),
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

// ---------------------------------------------------------------------------
// App + DB helpers
// ---------------------------------------------------------------------------

import { createApp } from '../app';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('agent_sessions_controller — issue #629 task context seeded as system message', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;
  let taskId: string;
  const TASK_TITLE = 'Prepare Sunday bulletin';
  const TASK_NOTES = 'Include announcements from Pastor Tim and the upcoming retreat info.';

  beforeEach(async () => {
    promptAsyncSpy.mockClear();
    setDb(makeDb());

    // Create a user + auth session.
    const user = new UsersRepository().create({ name: 'Test', email: 'test629@example.com' });
    const authSession = await new SessionsRepository().createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${authSession.token}`,
      'Content-Type': 'application/json',
    };

    // Seed a task in the local SQLite tasks table so taskId resolves.
    const task = new TasksRepository().create({
      title: TASK_TITLE,
      notes: TASK_NOTES,
      ownerId: user.id,
      status: 'open',
    });
    taskId = task.id;

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
    const { opencodeClient } = await import('../services/opencode_engine');
    (opencodeClient as { isReady: boolean }).isReady = true;
  });

  // -------------------------------------------------------------------------
  // c1 — system message contains task title when taskId found in local table
  //
  // FAILS today: create() calls repo.insert(dto) and returns HTTP 201, but
  // never appends a 'system' message. messagesRepo.listBySession(id) returns [].
  //
  // PASSES after fix: after repo.insert, controller calls
  //   messagesRepo.append(session.id, 'system', text, text)
  // so listBySession returns at least one message with role='system' and
  // strippedText containing the task title.
  // -------------------------------------------------------------------------

  it('issue-629-c1: system message contains task title when taskId found in local table', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        // agent-less session (as opened by the task-ready bubble via #623)
        agentId: null,
        cwd: '/tmp',
        name: 'Test task context session',
        taskId,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const sessionId = body.id;

    // Verify via the GET messages endpoint.
    const msgsRes = await fetch(`${baseUrl}/agent-sessions/${sessionId}/messages`, {
      headers: authHeaders,
    });
    expect(msgsRes.status).toBe(200);
    const { messages } = (await msgsRes.json()) as {
      messages: Array<{ role: string; strippedText: string }>;
    };

    const systemMsgs = messages.filter((m) => m.role === 'system');
    // CONTRACT: at least one system message must exist.
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1);

    // CONTRACT: the system message must contain the task title.
    const hasTitle = systemMsgs.some((m) => m.strippedText.includes(TASK_TITLE));
    expect(hasTitle).toBe(true);
  });

  // -------------------------------------------------------------------------
  // c2 — system message contains task notes when notes are non-null
  //
  // FAILS today: no system message exists at all.
  //
  // PASSES after fix: same system message also contains the notes string.
  // -------------------------------------------------------------------------

  it('issue-629-c2: system message contains task notes when task has non-null notes', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: null,
        cwd: '/tmp',
        name: 'Task with notes session',
        taskId,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const sessionId = body.id;

    const msgsRes = await fetch(`${baseUrl}/agent-sessions/${sessionId}/messages`, {
      headers: authHeaders,
    });
    const { messages } = (await msgsRes.json()) as {
      messages: Array<{ role: string; strippedText: string }>;
    };

    const systemMsgs = messages.filter((m) => m.role === 'system');
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1);

    // CONTRACT: the system message must contain the task notes (description).
    const hasNotes = systemMsgs.some((m) => m.strippedText.includes(TASK_NOTES));
    expect(hasNotes).toBe(true);
  });

  // -------------------------------------------------------------------------
  // c3 — taskTitle fallback: system message appended even when taskId not in DB
  //
  // When the local tasks table doesn't have the taskId (e.g., it's a production
  // task ID that hasn't been synced), the controller silently nulls out task_id
  // but preserves task_title. A system message must still be appended using
  // the provided taskTitle as fallback context.
  //
  // FAILS today: no system message is appended in either code path.
  //
  // PASSES after fix: controller checks `if (task) { ... } else if (taskTitle) { ... }`
  // and appends a system message with the provided taskTitle even on FK miss.
  // -------------------------------------------------------------------------

  it('issue-629-c3: system message appended with taskTitle fallback when taskId not in local table', async () => {
    const FALLBACK_TITLE = 'Plan worship set for Christmas Eve';
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: null,
        cwd: '/tmp',
        name: 'Fallback title session',
        taskId: 'nonexistent-task-id-from-production',
        taskTitle: FALLBACK_TITLE,
      }),
    });

    // Still 201 — FK miss is graceful (existing behavior from #621).
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const sessionId = body.id;

    const msgsRes = await fetch(`${baseUrl}/agent-sessions/${sessionId}/messages`, {
      headers: authHeaders,
    });
    const { messages } = (await msgsRes.json()) as {
      messages: Array<{ role: string; strippedText: string }>;
    };

    const systemMsgs = messages.filter((m) => m.role === 'system');
    // CONTRACT: system message must exist even for FK-miss path.
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1);

    // CONTRACT: it must contain the fallback title.
    const hasFallbackTitle = systemMsgs.some((m) => m.strippedText.includes(FALLBACK_TITLE));
    expect(hasFallbackTitle).toBe(true);
  });

  // -------------------------------------------------------------------------
  // c4 — appending the system message must NOT call promptAsync again
  //
  // The 'system' role in agent_session_messages is display-only. It must never
  // trigger an extra LLM turn. For an agent-less session (agentId: null), the
  // controller returns early before ANY promptAsync call, so promptAsync call
  // count must be 0 regardless of whether the system message is appended.
  //
  // FAILS today: this test actually passes today (no system message → no extra
  // promptAsync). The purpose here is a REGRESSION GUARD — it must CONTINUE to
  // pass after the fix to confirm the system message doesn't accidentally
  // trigger a second promptAsync call.
  //
  // NOTE: for agent-less sessions, promptAsync is expected to be 0.
  //       for agent-assigned sessions (not tested here), it should be exactly 1.
  // -------------------------------------------------------------------------

  it('issue-629-c4: appending system context message does not trigger an extra promptAsync call', async () => {
    promptAsyncSpy.mockClear();

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: null,
        cwd: '/tmp',
        name: 'No extra prompt session',
        taskId,
      }),
    });

    expect(res.status).toBe(201);

    // Give a tick for any async fire-and-forget calls to settle.
    await new Promise((r) => setTimeout(r, 20));

    // CONTRACT: agent-less sessions MUST NOT call promptAsync at all.
    // The system message insertion must not introduce a second promptAsync call.
    expect(promptAsyncSpy).not.toHaveBeenCalled();
  });
});
